#!/usr/bin/env bash
# Add, rotate, and remove MikroTik spokes on the standalone WireGuard hub.
# Run as root on the VPS after vps-setup.sh. Not for the ISP Solutions overlay.
set -euo pipefail

WG_IFACE="wg0"
WG_DIR="/etc/wireguard"
WG_CONF="$WG_DIR/wg0.conf"
PEERS_DIR="$WG_DIR/peers"
REGISTRY="$WG_DIR/peers.tsv"          # name <TAB> ip <TAB> pubkey <TAB> created
LOCK="$WG_DIR/peers.lock"
WG_SUBNET_PREFIX="10.10.0"            # /24, hub = .1, peers .2–.254
WG_PORT="51820"
VPS_ENDPOINT="${VPS_ENDPOINT:-vpn.example.com}"
SERVER_PUBKEY_FILE="$WG_DIR/publickey"
KEEPALIVE=25
MIKROTIK_WG_IFACE_NAME="wg-vps"

die() { echo "$*" >&2; exit 1; }

require_root() { [[ $EUID -eq 0 ]] || die "Run as root."; }

valid_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$ ]] || die "Peer name must match [A-Za-z0-9][A-Za-z0-9_-]{0,31}"
}

valid_endpoint() {
  [[ "$VPS_ENDPOINT" != "vpn.example.com" ]] || die "Set VPS_ENDPOINT to this VPS public IP or DNS name."
  [[ "$VPS_ENDPOINT" =~ ^[A-Za-z0-9._:-]+$ ]] || die "VPS_ENDPOINT has characters that cannot go in a RouterOS script."
}

init_registry() {
  [[ -f "$REGISTRY" ]] || touch "$REGISTRY"
  chmod 600 "$REGISTRY"
}

with_lock() {
  mkdir -p "$WG_DIR"
  exec 9>"$LOCK"
  flock 9
}

peer_line() { awk -F '\t' -v name="$1" '$1 == name { print; exit }' "$REGISTRY"; }
peer_exists() { [[ -n "$(peer_line "$1")" ]]; }

next_ip() {
  local n used
  used=$(awk -F '\t' 'NF >= 2 { sub(/\/.*/, "", $2); print $2 }' "$REGISTRY")
  for n in $(seq 2 254); do
    if ! grep -Fxq "${WG_SUBNET_PREFIX}.${n}" <<<"$used"; then
      echo "${WG_SUBNET_PREFIX}.${n}"
      return 0
    fi
  done
  die "No free tunnel address left in ${WG_SUBNET_PREFIX}.0/24"
}

sync_wg() {
  if ip link show "$WG_IFACE" >/dev/null 2>&1; then
    wg syncconf "$WG_IFACE" <(wg-quick strip "$WG_CONF")
  else
    systemctl start "wg-quick@${WG_IFACE}"
  fi
}

render_rsc() {
  local name=$1 ip=$2 priv=$3 psk=$4
  local server_pub out
  server_pub=$(cat "$SERVER_PUBKEY_FILE")
  out="$PEERS_DIR/$name/mikrotik-$name.rsc"
  cat > "$out" <<EOF
# WireGuard join script for '${name}'
# Generated $(date -Is). Safe to import again. RouterOS v7:
#   /import file-name=mikrotik-${name}.rsc
# Verify:
#   /interface wireguard peers print

:do { /ip firewall filter remove [find where comment="vps-hub-${name}"] } on-error={}
:do { /ip route remove [find where comment="vps-hub-${name}"] } on-error={}
:do { /ip address remove [find where comment="vps-hub-${name}"] } on-error={}
:do { /interface wireguard peers remove [find where comment="vps-hub-${name}"] } on-error={}
:do { /interface wireguard remove [find where name="${MIKROTIK_WG_IFACE_NAME}"] } on-error={}

/interface wireguard add name=${MIKROTIK_WG_IFACE_NAME} private-key="${priv}" comment="vps-hub-${name}"

/interface wireguard peers add interface=${MIKROTIK_WG_IFACE_NAME} public-key="${server_pub}" preshared-key="${psk}" endpoint-address="${VPS_ENDPOINT}" endpoint-port=${WG_PORT} allowed-address=${WG_SUBNET_PREFIX}.0/24 persistent-keepalive=${KEEPALIVE}s comment="vps-hub-${name}"

/ip address add address=${ip}/24 interface=${MIKROTIK_WG_IFACE_NAME} comment="vps-hub-${name}"

/ip firewall filter add chain=input action=accept in-interface=${MIKROTIK_WG_IFACE_NAME} comment="vps-hub-${name}"
EOF
  chmod 600 "$out"
  echo "$out"
}

write_peer_block() {
  local name=$1 pub=$2 psk=$3 ip=$4
  {
    echo ""
    echo "# BEGIN PEER $name"
    echo "[Peer]"
    echo "PublicKey = $pub"
    echo "PresharedKey = $psk"
    echo "AllowedIPs = $ip/32"
    echo "# END PEER $name"
  } >> "$WG_CONF"
  chmod 600 "$WG_CONF"
}

remove_peer_block() {
  local name=$1 tmp
  tmp=$(mktemp)
  awk -v name="$name" '
    $0 == "# BEGIN PEER " name { skip = 1; next }
    skip && $0 == "# END PEER " name { skip = 0; next }
    !skip { print }
  ' "$WG_CONF" > "$tmp"
  cat "$tmp" > "$WG_CONF"
  rm -f "$tmp"
  chmod 600 "$WG_CONF"
}

put_registry() {
  local name=$1 ip=$2 pub=$3 created=$4 tmp
  tmp=$(mktemp)
  awk -F '\t' -v name="$name" -v ip="$ip" -v pub="$pub" -v created="$created" '
    BEGIN { OFS = "\t"; found = 0 }
    $1 == name { print name, ip, pub, created; found = 1; next }
    NF { print }
    END { if (!found) print name, ip, pub, created }
  ' "$REGISTRY" > "$tmp"
  cat "$tmp" > "$REGISTRY"
  rm -f "$tmp"
  chmod 600 "$REGISTRY"
}

drop_registry() {
  local name=$1 tmp
  tmp=$(mktemp)
  awk -F '\t' -v name="$name" 'BEGIN { OFS = "\t" } $1 != name && NF { print }' "$REGISTRY" > "$tmp"
  cat "$tmp" > "$REGISTRY"
  rm -f "$tmp"
  chmod 600 "$REGISTRY"
}

add_peer() {
  local name=$1
  require_root
  valid_name "$name"
  valid_endpoint
  [[ -f "$WG_CONF" && -f "$SERVER_PUBKEY_FILE" ]] || die "Hub is not bootstrapped. Run vps-setup.sh first."
  with_lock
  init_registry
  peer_exists "$name" && die "Peer '$name' already exists — use 'edit' or pick another name."

  local ip priv pub psk rsc
  ip=$(next_ip)
  mkdir -p "$PEERS_DIR/$name"
  chmod 700 "$PEERS_DIR/$name"
  wg genkey | tee "$PEERS_DIR/$name/privatekey" | wg pubkey > "$PEERS_DIR/$name/publickey"
  wg genpsk > "$PEERS_DIR/$name/psk"
  chmod 600 "$PEERS_DIR/$name"/*
  priv=$(cat "$PEERS_DIR/$name/privatekey")
  pub=$(cat "$PEERS_DIR/$name/publickey")
  psk=$(cat "$PEERS_DIR/$name/psk")

  write_peer_block "$name" "$pub" "$psk" "$ip"
  put_registry "$name" "$ip" "$pub" "$(date -Is)"
  if ! sync_wg; then
    remove_peer_block "$name"
    drop_registry "$name"
    die "WireGuard did not accept peer '$name'. Registry rolled back."
  fi
  rsc=$(render_rsc "$name" "$ip" "$priv" "$psk")
  echo "Added peer '$name' -> $ip"
  echo "RouterOS import script: $rsc"
}

edit_peer() {
  local name=$1
  shift || true
  require_root
  valid_name "$name"
  valid_endpoint
  with_lock
  init_registry
  peer_exists "$name" || die "No such peer: $name"
  local regen=0 arg ip priv pub psk rsc created
  for arg in "$@"; do [[ "$arg" == "--regen-keys" ]] && regen=1; done
  [[ $regen -eq 1 ]] || die "Nothing to do. Supported edit flags: --regen-keys"
  ip=$(peer_line "$name" | awk -F '\t' '{ print $2 }')
  created=$(peer_line "$name" | awk -F '\t' '{ print $4 }')
  [[ -n "$ip" ]] || die "Registry row for '$name' has no address."

  remove_peer_block "$name"
  wg genkey | tee "$PEERS_DIR/$name/privatekey" | wg pubkey > "$PEERS_DIR/$name/publickey"
  wg genpsk > "$PEERS_DIR/$name/psk"
  chmod 600 "$PEERS_DIR/$name"/*
  priv=$(cat "$PEERS_DIR/$name/privatekey")
  pub=$(cat "$PEERS_DIR/$name/publickey")
  psk=$(cat "$PEERS_DIR/$name/psk")
  write_peer_block "$name" "$pub" "$psk" "$ip"
  put_registry "$name" "$ip" "$pub" "${created:-$(date -Is)}"
  sync_wg
  rsc=$(render_rsc "$name" "$ip" "$priv" "$psk")
  echo "Rotated keys for '$name' (address unchanged: $ip)."
  echo "New RouterOS import script: $rsc"
  echo "The previous key stopped working on the hub as soon as this reload finished."
  echo "Import the new script on that MikroTik before relying on the tunnel."
}

remove_peer() {
  local name=$1
  require_root
  valid_name "$name"
  with_lock
  init_registry
  peer_exists "$name" || die "No such peer: $name"
  remove_peer_block "$name"
  drop_registry "$name"
  if [[ -d "$PEERS_DIR/$name" ]]; then
    mv "$PEERS_DIR/$name" "$PEERS_DIR/${name}.removed.$(date +%s)"
  fi
  sync_wg
  echo "Removed peer '$name' from the hub. Key material was archived, not deleted."
}

list_peers() {
  init_registry
  printf "%-18s %-14s %-46s %s\n" "NAME" "IP" "PUBKEY" "CREATED"
  awk -F '\t' 'NF >= 4 { printf "%-18s %-14s %-46s %s\n", $1, $2, $3, $4 }' "$REGISTRY"
}

show_peer() {
  local name=$1
  valid_name "$name"
  local f="$PEERS_DIR/$name/mikrotik-$name.rsc"
  [[ -f "$f" ]] || die "No .rsc on file for '$name'."
  cat "$f"
}

usage() {
  cat <<EOF
wg-manager.sh — MikroTik peers on the standalone VPS hub (10.10.0.0/24)

Usage:
  $0 add <name>                 Allocate the lowest free .2–.254, keys, and a PSK.
  $0 edit <name> --regen-keys   Replace that peer's keys now. Re-import the new .rsc.
  $0 remove <name>              Remove the peer and archive its keys.
  $0 list
  $0 show <name>                Print the RouterOS script again. It contains secrets.

Environment:
  VPS_ENDPOINT=203.0.113.10 $0 add branch1

Not for an ISP Solutions host. That overlay is 10.200.0.0/24 on wg-ispsolutions
and is managed from the application, not this script.
EOF
}

cmd="${1:-}"
shift || true
case "$cmd" in
  add)    add_peer "${1:-}" ;;
  edit)   edit_peer "${1:-}" "${2:-}" ;;
  remove) remove_peer "${1:-}" ;;
  list)   list_peers ;;
  show)   show_peer "${1:-}" ;;
  *) usage; exit 1 ;;
esac

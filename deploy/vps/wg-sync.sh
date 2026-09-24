#!/bin/bash
# Apply Postgres-wanted WireGuard peers onto the host hub.
# Safe to run every few seconds. Does not rewrite the hub private key.
set -euo pipefail
IFACE="${WG_INTERFACE:-wg-ispsolutions}"
LEGACY="${WG_INTERFACE_LEGACY:-wg-gridline}"
WANTED="${ISPSOLUTIONS_WG_DIR:-/opt/ispsolutions/wg}/wanted.json"
DUMP="${ISPSOLUTIONS_WG_DUMP:-${ISPSOLUTIONS_WG_DIR:-/opt/ispsolutions/wg}/wg.dump}"
mkdir -p "$(dirname "$DUMP")" "$(dirname "$WANTED")"
if ! command -v wg >/dev/null 2>&1; then
  exit 0
fi
# Rename the old hub interface in place. Do not wg-quick down it.
if ip link show "$LEGACY" >/dev/null 2>&1 && ! ip link show "$IFACE" >/dev/null 2>&1; then
  ip link set dev "$LEGACY" name "$IFACE" || true
fi
if [[ -f "/etc/wireguard/${LEGACY}.conf" ]]; then
  systemctl disable "wg-quick@${LEGACY}" >/dev/null 2>&1 || true
  if [[ ! -f "/etc/wireguard/${IFACE}.conf" ]]; then
    mv "/etc/wireguard/${LEGACY}.conf" "/etc/wireguard/${IFACE}.conf"
  else
    rm -f "/etc/wireguard/${LEGACY}.conf"
  fi
fi
if [[ -f "/etc/wireguard/${IFACE}.conf" ]]; then
  systemctl enable "wg-quick@${IFACE}" >/dev/null 2>&1 || true
fi
if ! ip link show "$IFACE" >/dev/null 2>&1; then
  exit 0
fi
# The app runs in Docker. RouterOS API accepts the hub address only, so forwarded
# checks must be rewritten onto this interface before Docker's own masquerade.
if command -v iptables >/dev/null 2>&1; then
  NET="${WG_NETWORK:-10.200.0.0/24}"
  HUB="${WG_HUB_ADDRESS:-10.200.0.1}"
  ip -4 addr show dev "$IFACE" | grep -q "${HUB}/" || ip addr add "${HUB}/24" dev "$IFACE" || true
  sysctl -w net.ipv4.ip_forward=1 >/dev/null || true
  sysctl -w net.ipv4.conf.all.rp_filter=2 >/dev/null || true
  sysctl -w "net.ipv4.conf.${IFACE}.rp_filter=0" >/dev/null || true
  iptables -C INPUT -i "$IFACE" -s "$NET" -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -i "$IFACE" -s "$NET" -j ACCEPT || true
  iptables -t nat -C POSTROUTING -o "$IFACE" -d "$NET" -j SNAT --to-source "$HUB" 2>/dev/null \
    || iptables -t nat -I POSTROUTING 1 -o "$IFACE" -d "$NET" -j SNAT --to-source "$HUB" || true
  iptables -C INPUT -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
    || iptables -I INPUT 1 -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
  iptables -C OUTPUT -o "$IFACE" -p tcp -d "$NET" --dport 8728 -j ACCEPT 2>/dev/null \
    || iptables -I OUTPUT 1 -o "$IFACE" -p tcp -d "$NET" --dport 8728 -j ACCEPT || true
  iptables -C DOCKER-USER -o "$IFACE" -j ACCEPT 2>/dev/null \
    || iptables -I DOCKER-USER 1 -o "$IFACE" -j ACCEPT 2>/dev/null || true
  iptables -C DOCKER-USER -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
    || iptables -I DOCKER-USER 1 -i "$IFACE" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null || true
  for br in $(ip -o link show | awk -F': ' '/: br-|: docker0/ {print $2}' | cut -d@ -f1); do
    iptables -C FORWARD -i "$br" -o "$IFACE" -j ACCEPT 2>/dev/null || iptables -I FORWARD 1 -i "$br" -o "$IFACE" -j ACCEPT || true
    iptables -C FORWARD -i "$IFACE" -o "$br" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT 2>/dev/null \
      || iptables -I FORWARD 1 -i "$IFACE" -o "$br" -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT || true
  done
fi
if [[ -f "$WANTED" ]] && command -v python3 >/dev/null 2>&1; then
  WANTED="$WANTED" IFACE="$IFACE" python3 - <<'PY'
import json, os, subprocess
from pathlib import Path
wanted_path = Path(os.environ["WANTED"])
iface = os.environ["IFACE"]
try:
    data = json.loads(wanted_path.read_text())
except Exception:
    data = {}
for peer in data.get("peers") or []:
    pub = str(peer.get("publicKey") or "").strip()
    ips = str(peer.get("allowedIps") or "").strip()
    if not pub or not ips:
        continue
    subprocess.run(["wg", "set", iface, "peer", pub, "allowed-ips", ips], check=False)
subprocess.run(["wg-quick", "save", iface], check=False)
PY
fi
wg show "$IFACE" dump >"$DUMP" 2>/dev/null || true
chmod 640 "$DUMP" 2>/dev/null || true

#!/usr/bin/env bash
# One-time WireGuard hub bootstrap. Idempotent. Run as root on the VPS.
# This is a standalone hub (10.10.0.0/24, interface wg0).
# Do not run it on an ISP Solutions host that already uses wg-ispsolutions / 10.200.0.0/24.
set -euo pipefail

WG_IFACE="wg0"
WG_DIR="/etc/wireguard"
WG_PORT="51820"
WG_SUBNET="10.10.0.1/24"

if [[ $EUID -ne 0 ]]; then
  echo "Run as root (sudo $0)"; exit 1
fi

echo "==> Installing WireGuard tools"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y wireguard qrencode curl
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y wireguard-tools qrencode curl
elif command -v yum >/dev/null 2>&1; then
  yum install -y epel-release
  yum install -y wireguard-tools qrencode curl
else
  echo "Unsupported distro — install wireguard-tools manually and re-run."; exit 1
fi

umask 077
mkdir -p "$WG_DIR/peers"
chmod 700 "$WG_DIR" "$WG_DIR/peers"

echo "==> Generating hub keypair (if missing)"
if [[ ! -f "$WG_DIR/privatekey" ]]; then
  wg genkey | tee "$WG_DIR/privatekey" | wg pubkey > "$WG_DIR/publickey"
  chmod 600 "$WG_DIR/privatekey" "$WG_DIR/publickey"
fi
SERVER_PRIV=$(cat "$WG_DIR/privatekey")

echo "==> Writing $WG_DIR/wg0.conf (if missing)"
if [[ ! -f "$WG_DIR/wg0.conf" ]]; then
  cat > "$WG_DIR/wg0.conf" <<EOF
[Interface]
Address = $WG_SUBNET
ListenPort = $WG_PORT
PrivateKey = $SERVER_PRIV
SaveConfig = false

# --- peers are appended below by wg-manager.sh, one block per MikroTik ---
EOF
  chmod 600 "$WG_DIR/wg0.conf"
fi

echo "==> Enabling IPv4 forwarding"
printf '%s\n' 'net.ipv4.ip_forward=1' >/etc/sysctl.d/99-wireguard.conf
sysctl --system >/dev/null

echo "==> Opening UDP $WG_PORT and overlay forwarding (if ufw is present)"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$WG_PORT"/udp || true
  # Spoke-to-spoke uses the hub as a router. Without this, ufw's default
  # FORWARD DROP blackholes traffic that arrives on wg0.
  ufw route allow in on "$WG_IFACE" || true
  ufw route allow out on "$WG_IFACE" || true
fi

echo "==> Enabling wg-quick@$WG_IFACE"
systemctl enable "wg-quick@$WG_IFACE" >/dev/null
if ip link show "$WG_IFACE" >/dev/null 2>&1; then
  wg syncconf "$WG_IFACE" <(wg-quick strip "$WG_DIR/wg0.conf")
else
  systemctl start "wg-quick@$WG_IFACE"
fi

echo
echo "================= HUB READY ================="
echo "Server public key : $(cat "$WG_DIR/publickey")"
echo "Listen port        : $WG_PORT/udp"
PUB_IP=$(curl -4 -fsS --max-time 5 ifconfig.me || echo "<could-not-detect-set-manually>")
echo "Detected public IP : $PUB_IP"
echo "==============================================="
echo "Set VPS_ENDPOINT=$PUB_IP (or a DNS name) before the first wg-manager.sh add."
echo "Do not point that name through an HTTP proxy. WireGuard is UDP $WG_PORT."

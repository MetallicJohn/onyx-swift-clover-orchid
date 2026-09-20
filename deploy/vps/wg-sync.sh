#!/bin/bash
# Apply Postgres-wanted WireGuard peers onto the host hub.
# Safe to run every few seconds. Does not rewrite the hub private key.
set -euo pipefail
IFACE="${WG_INTERFACE:-wg-ispsolutions}"
WANTED="${ISPSOLUTIONS_WG_DIR:-/var/lib/ispsolutions/wg}/wanted.json"
DUMP="${ISPSOLUTIONS_WG_DUMP:-/run/ispsolutions/wg.dump}"
mkdir -p "$(dirname "$DUMP")" /var/lib/ispsolutions/wg
if ! command -v wg >/dev/null 2>&1; then
  exit 0
fi
if ! ip link show "$IFACE" >/dev/null 2>&1; then
  exit 0
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

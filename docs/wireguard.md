# WireGuard

Keys are X25519 (`crypto.generateKeyPairSync('x25519')`). Public key is 32 raw bytes, standard base64. Private keys are sealed (`enc:v1:`) in `routers.wg_private_ref` / `wireguard_peers.private_key_sealed`. Never sent to the browser.

`wg_status` starts `pending`. `connected` is set only after agent heartbeat/pull.

Do not treat `Buffer.from(name+token)` as a key — that path was removed.

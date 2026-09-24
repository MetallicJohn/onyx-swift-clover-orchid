#!/usr/bin/env node
/**
 * Host-network TCP dialer for RouterOS API.
 * The app container connects to a Unix socket. This process dials 10.200.0.x:8728
 * from the VPS, so the router sees source 10.200.0.1. Docker bridge addresses are rejected.
 */
import { connect, createServer } from "node:net";
import { chmodSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

export function overlayDialAllowed(host, port, env = process.env) {
  const p = Number(port);
  if (!Number.isInteger(p) || p < 1 || p > 65535) return false;
  if (env.DIAL_ANY === "1") return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(host || ""));
  const match = /^10\.200\.0\.(\d{1,3})$/.exec(String(host || "").trim());
  if (!match || p !== 8728) return false;
  const last = Number(match[1]);
  return last >= 2 && last <= 254;
}

function start() {
  const sockPath = (process.env.DIAL_SOCK || "/opt/ispsolutions/wg/overlay-dial.sock").trim();
  mkdirSync(dirname(sockPath), { recursive: true });
  try {
    unlinkSync(sockPath);
  } catch {
    /* first start */
  }
  const server = createServer((client) => {
    let buf = Buffer.alloc(0);
    let opened = false;
    const fail = (message) => {
      if (!client.destroyed) client.end(`ERR ${String(message || "dial failed").slice(0, 180)}\n`);
    };
    function onData(chunk) {
      if (opened) return;
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        if (buf.length > 80) client.destroy();
        return;
      }
      const line = buf.subarray(0, nl).toString("utf8").trim();
      const rest = buf.subarray(nl + 1);
      const parts = line.split(" ");
      client.off("data", onData);
      if (parts.length !== 3 || parts[0] !== "ISPDIAL" || !overlayDialAllowed(parts[1], parts[2])) {
        fail("denied");
        return;
      }
      opened = true;
      const upstream = connect({ host: parts[1], port: Number(parts[2]) });
      upstream.setTimeout(8000);
      upstream.once("timeout", () => {
        upstream.destroy();
        fail("timeout");
      });
      upstream.once("error", (err) => {
        if (!client.destroyed) fail(err.message);
      });
      upstream.once("connect", () => {
        upstream.setTimeout(0);
        if (client.destroyed) {
          upstream.destroy();
          return;
        }
        client.write("OK\n");
        if (rest.length) upstream.write(rest);
        client.pipe(upstream);
        upstream.pipe(client);
      });
    }
    client.on("data", onData);
    client.on("error", () => {});
  });
  server.on("error", (err) => {
    console.error(`[overlay-dial] ${err.message}`);
    process.exit(1);
  });
  server.listen(sockPath, () => {
    try {
      chmodSync(sockPath, 0o660);
    } catch {
      /* volume may not support chmod */
    }
    console.log(`[overlay-dial] listening ${sockPath}`);
  });
}

const isMain = process.argv[1]?.endsWith("overlay-dial.mjs");
if (isMain) start();

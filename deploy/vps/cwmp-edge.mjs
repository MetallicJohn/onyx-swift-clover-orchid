#!/usr/bin/env node
/**
 * TR-069 edge: one TCP listener per ISP port, all forwarded to the shared GenieACS CWMP
 * (genieacs:7547). NBI stays internal. Reloads the port map without restarting GenieACS.
 */
import net from "node:net";

const TARGET = process.env.GENIEACS_CWMP_URL || "http://genieacs:7547";
const INTERNAL = (process.env.GRIDLINE_INTERNAL_URL || "http://web:3000").replace(/\/+$/, "");
const TOKEN = process.env.ACS_EDGE_TOKEN || "";
const REFRESH_MS = Math.max(5000, Number(process.env.ACS_EDGE_REFRESH_MS || 15_000));

function targetHostPort() {
  try {
    const u = new URL(TARGET.includes("://") ? TARGET : `http://${TARGET}`);
    return { host: u.hostname || "genieacs", port: Number(u.port || 7547) };
  } catch {
    return { host: "genieacs", port: 7547 };
  }
}

const upstream = targetHostPort();
const servers = new Map();

function log(msg, extra = {}) {
  const line = { ts: new Date().toISOString(), msg, ...extra };
  console.log(JSON.stringify(line));
}

function listenPort(port) {
  if (servers.has(port)) return;
  const server = net.createServer((client) => {
    const up = net.connect(upstream.port, upstream.host);
    client.pipe(up);
    up.pipe(client);
    const fail = () => {
      client.destroy();
      up.destroy();
    };
    client.on("error", fail);
    up.on("error", fail);
  });
  server.on("error", (err) => log("listen_error", { port, error: String(err.message || err) }));
  server.listen(port, "0.0.0.0", () => log("listen", { port, upstream: `${upstream.host}:${upstream.port}` }));
  servers.set(port, server);
}

function dropPort(port) {
  const server = servers.get(port);
  if (!server) return;
  server.close();
  servers.delete(port);
  log("unlisten", { port });
}

async function refresh() {
  if (!TOKEN) {
    log("missing_token");
    return;
  }
  const res = await fetch(`${INTERNAL}/api/internal/acs-ports`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    log("map_error", { status: res.status });
    return;
  }
  const body = await res.json();
  const wanted = new Set((body.ports || []).map((p) => Number(p.port)).filter((p) => p > 0));
  for (const port of wanted) listenPort(port);
  for (const port of servers.keys()) {
    if (!wanted.has(port)) dropPort(port);
  }
}

async function loop() {
  for (;;) {
    try {
      await refresh();
    } catch (err) {
      log("refresh_error", { error: String(err instanceof Error ? err.message : err) });
    }
    await new Promise((r) => setTimeout(r, REFRESH_MS));
  }
}

log("start", { upstream: `${upstream.host}:${upstream.port}` });
loop();

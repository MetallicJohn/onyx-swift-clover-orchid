import net from "node:net";
import tls from "node:tls";
import { loadServiceConfig } from "./runtime-config.ts";

type MemRow = { value: string; exp: number };

const memory = new Map<string, MemRow>();

function now() {
  return Date.now();
}

function memGet(key: string) {
  const row = memory.get(key);
  if (!row) return null;
  if (row.exp && row.exp < now()) {
    memory.delete(key);
    return null;
  }
  return row.value;
}

export type RedisLike = {
  configured: boolean;
  kind: "memory" | "redis";
  ping: () => Promise<boolean>;
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string, ttlSec?: number) => Promise<void>;
  del: (key: string) => Promise<void>;
  setNx: (key: string, value: string, ttlSec?: number) => Promise<boolean>;
};

function memoryRedis(): RedisLike {
  return {
    configured: false,
    kind: "memory",
    async ping() {
      return true;
    },
    async get(key) {
      return memGet(key);
    },
    async set(key, value, ttlSec) {
      memory.set(key, { value, exp: ttlSec ? now() + ttlSec * 1000 : 0 });
    },
    async del(key) {
      memory.delete(key);
    },
    async setNx(key, value, ttlSec) {
      if (memGet(key) != null) return false;
      memory.set(key, { value, exp: ttlSec ? now() + ttlSec * 1000 : 0 });
      return true;
    },
  };
}

function parseRedisUrl(url: string) {
  const u = new URL(url);
  const password = decodeURIComponent(u.password || "") || (process.env.REDIS_PASSWORD || "").trim();
  return {
    host: u.hostname,
    port: Number(u.port || (u.protocol === "rediss:" ? 6380 : 6379)),
    password,
    tls: u.protocol === "rediss:",
    db: Number((u.pathname || "/0").replace("/", "") || 0),
  };
}

function encodeResp(args: string[]) {
  let out = `*${args.length}\r\n`;
  for (const a of args) out += `$${Buffer.byteLength(a)}\r\n${a}\r\n`;
  return out;
}

function tryDecode(buf: Buffer): { value: string | null; size: number } | null {
  if (buf.length < 3) return null;
  const text = buf.toString("utf8");
  const kind = text[0];
  if (kind === "+" || kind === "-" || kind === ":") {
    const nl = text.indexOf("\r\n");
    if (nl < 0) return null;
    const line = text.slice(1, nl);
    if (kind === "-") throw new Error(line);
    return { value: line, size: nl + 2 };
  }
  if (kind === "$") {
    const nl = text.indexOf("\r\n");
    if (nl < 0) return null;
    const len = Number(text.slice(1, nl));
    if (len < 0) return { value: null, size: nl + 2 };
    const start = nl + 2;
    const end = start + len + 2;
    if (buf.length < end) return null;
    return { value: buf.subarray(start, start + len).toString("utf8"), size: end };
  }
  throw new Error("unsupported redis reply");
}

async function redisSession(url: string, useTls: boolean, commands: string[][], timeoutMs = 3000) {
  const parsed = parseRedisUrl(url);
  const chain: string[][] = [];
  if (parsed.password) chain.push(["AUTH", parsed.password]);
  if (parsed.db) chain.push(["SELECT", String(parsed.db)]);
  chain.push(...commands);
  return new Promise<Array<string | null>>((resolve, reject) => {
    const onConnect = () => {
      sock.write(chain.map(encodeResp).join(""));
    };
    const sock =
      useTls || parsed.tls
        ? tls.connect({ host: parsed.host, port: parsed.port }, onConnect)
        : net.connect({ host: parsed.host, port: parsed.port }, onConnect);
    let buf = Buffer.alloc(0);
    const replies: Array<string | null> = [];
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("redis timeout"));
    }, timeoutMs);
    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      try {
        while (replies.length < chain.length) {
          const decoded = tryDecode(buf);
          if (!decoded) break;
          replies.push(decoded.value);
          buf = buf.subarray(decoded.size);
        }
        if (replies.length >= chain.length) {
          clearTimeout(timer);
          sock.destroy();
          resolve(replies);
        }
      } catch (err) {
        clearTimeout(timer);
        sock.destroy();
        reject(err);
      }
    });
    sock.on("error", (err: Error) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

function remoteRedis(url: string, useTls: boolean): RedisLike {
  async function cmd(args: string[]) {
    const replies = await redisSession(url, useTls, [args]);
    return replies[replies.length - 1] ?? null;
  }
  return {
    configured: true,
    kind: "redis",
    async ping() {
      try {
        const r = await cmd(["PING"]);
        return String(r || "").toUpperCase() === "PONG" || String(r || "").toUpperCase() === "OK";
      } catch {
        return false;
      }
    },
    async get(key) {
      const r = await cmd(["GET", key]);
      return r == null ? null : String(r);
    },
    async set(key, value, ttlSec) {
      if (ttlSec && ttlSec > 0) await cmd(["SETEX", key, String(ttlSec), value]);
      else await cmd(["SET", key, value]);
    },
    async del(key) {
      await cmd(["DEL", key]);
    },
    async setNx(key, value, ttlSec) {
      const r = await cmd(["SET", key, value, "NX", ...(ttlSec ? ["EX", String(ttlSec)] : [])]);
      return String(r || "").toUpperCase() === "OK";
    },
  };
}

let cached: RedisLike | null = null;
let cachedUrl = "";

export function getRedis(): RedisLike {
  const cfg = loadServiceConfig();
  const url = cfg.redisUrl;
  if (cached && cachedUrl === url) return cached;
  cachedUrl = url;
  cached = url ? remoteRedis(url, cfg.redisTls) : memoryRedis();
  return cached;
}

/** Test helper. */
export function resetRedisForTests() {
  cached = null;
  cachedUrl = "";
  memory.clear();
}

export async function redisHealth() {
  const client = getRedis();
  const ok = await client.ping();
  return { ok, kind: client.kind, configured: client.configured };
}

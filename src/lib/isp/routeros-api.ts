/**
 * RouterOS v7 binary API (TCP 8728) over the WireGuard overlay.
 * Not API-SSL. Not REST. No certificate store on the router.
 */
import { connect as netConnect, type Socket } from "node:net";
import { existsSync } from "node:fs";
import { loadServiceConfig } from "./runtime-config.ts";

export const ROUTEROS_API_PORT = 8728;

export type RosApiReply = {
  type: "done" | "trap" | "fatal" | "re" | "unknown";
  attrs: Record<string, string>;
  sentences: Array<{ type: string; attrs: Record<string, string> }>;
};

function encodeLength(len: number) {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const n = len | 0x8000;
    return Buffer.from([(n >> 8) & 0xff, n & 0xff]);
  }
  if (len < 0x200000) {
    const n = len | 0xc00000;
    return Buffer.from([(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  }
  if (len < 0x10000000) {
    const n = len | 0xe0000000;
    return Buffer.from([(n >> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  }
  return Buffer.from([0xf0, (len >> 24) & 0xff, (len >> 16) & 0xff, (len >> 8) & 0xff, len & 0xff]);
}

export function encodeWord(word: string) {
  const body = Buffer.from(word, "utf8");
  return Buffer.concat([encodeLength(body.length), body]);
}

export function encodeSentence(words: string[]) {
  return Buffer.concat([...words.map(encodeWord), encodeLength(0)]);
}

export function decodeLength(buf: Buffer, offset: number) {
  if (offset >= buf.length) return null;
  const b0 = buf[offset];
  if (b0 < 0x80) return { len: b0, size: 1 };
  if (b0 < 0xc0) {
    if (offset + 1 >= buf.length) return null;
    return { len: ((b0 & 0x7f) << 8) + buf[offset + 1], size: 2 };
  }
  if (b0 < 0xe0) {
    if (offset + 2 >= buf.length) return null;
    return { len: ((b0 & 0x3f) << 16) + (buf[offset + 1] << 8) + buf[offset + 2], size: 3 };
  }
  if (b0 < 0xf0) {
    if (offset + 3 >= buf.length) return null;
    return {
      len: ((b0 & 0x1f) << 24) + (buf[offset + 1] << 16) + (buf[offset + 2] << 8) + buf[offset + 3],
      size: 4,
    };
  }
  if (offset + 4 >= buf.length) return null;
  return {
    len: (buf[offset + 1] << 24) + (buf[offset + 2] << 16) + (buf[offset + 3] << 8) + buf[offset + 4],
    size: 5,
  };
}

export function decodeSentence(buf: Buffer) {
  const words: string[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const head = decodeLength(buf, offset);
    if (!head) break;
    offset += head.size;
    if (head.len === 0) return { words, rest: buf.subarray(offset) };
    if (offset + head.len > buf.length) break;
    words.push(buf.subarray(offset, offset + head.len).toString("utf8"));
    offset += head.len;
  }
  return { words: null as string[] | null, rest: buf };
}

function parseAttrs(words: string[]) {
  const attrs: Record<string, string> = {};
  let type = "unknown";
  for (const w of words) {
    if (w.startsWith("!")) type = w.slice(1) || "unknown";
    else if (w.startsWith("=")) {
      const eq = w.indexOf("=", 1);
      if (eq > 0) attrs[w.slice(1, eq)] = w.slice(eq + 1);
      else attrs[w.slice(1)] = "";
    }
  }
  return { type, attrs };
}

export function parseReplies(wordsList: string[][]): RosApiReply {
  const sentences = wordsList.map(parseAttrs);
  const done = sentences.find((s) => s.type === "done");
  const trap = sentences.find((s) => s.type === "trap" || s.type === "fatal");
  const type = (trap?.type || done?.type || sentences[sentences.length - 1]?.type || "unknown") as RosApiReply["type"];
  return { type, attrs: { ...(done?.attrs || {}), ...(trap?.attrs || {}) }, sentences };
}

function readSentences(socket: Socket, timeoutMs: number): Promise<string[][]> {
  return new Promise((resolve, reject) => {
    let buf: Buffer = Buffer.alloc(0);
    const collected: string[][] = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("RouterOS API timeout"));
    }, timeoutMs);
    function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        const decoded = decodeSentence(buf);
        if (!decoded.words) break;
        buf = decoded.rest;
        collected.push(decoded.words);
        const last = decoded.words[0] || "";
        if (last === "!done" || last === "!trap" || last === "!fatal") {
          cleanup();
          resolve(collected);
          return;
        }
      }
    }
    function onErr(err: Error) {
      cleanup();
      reject(err);
    }
    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onErr);
    }
    socket.on("data", onData);
    socket.on("error", onErr);
  });
}

function dialSocketPath() {
  const explicit = process.env.ISPSOLUTIONS_OVERLAY_DIAL?.trim();
  if (explicit) return explicit;
  const dir = process.env.ISPSOLUTIONS_WG_DIR?.trim();
  if (!dir) return "";
  const path = `${dir}/overlay-dial.sock`;
  return existsSync(path) ? path : "";
}

function dialerDown(err: unknown) {
  const code = err && typeof err === "object" && "code" in err ? String((err as { code?: string }).code || "") : "";
  return code === "ENOENT" || code === "EACCES" || code === "ENOTSOCK" || code === "ECONNREFUSED";
}

/** Dial through the host-network helper when it is up, so the source is 10.200.0.1. */
export function openRouterSocket(host: string, port: number, timeoutMs: number): Promise<Socket> {
  const via = dialSocketPath();
  if (!via) return connectDirect(host, port, timeoutMs);
  return connectViaDialer(via, host, port, timeoutMs).catch((err) => {
    if (process.env.ISPSOLUTIONS_OVERLAY_DIAL_REQUIRED === "1" || !dialerDown(err)) throw err;
    return connectDirect(host, port, timeoutMs);
  });
}

function connectDirect(host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect({ host, port }, () => resolve(socket));
    socket.setTimeout(timeoutMs);
    socket.once("error", reject);
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error("RouterOS API timeout"));
    });
  });
}

function connectViaDialer(sockPath: string, host: string, port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = netConnect(sockPath);
    let buf = Buffer.alloc(0);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error("RouterOS API timeout"));
    }, timeoutMs);
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      reject(err);
    };
    socket.once("error", fail);
    socket.once("connect", () => {
      socket.write(`ISPDIAL ${host} ${port}\n`);
    });
    socket.on("data", function onData(chunk: Buffer) {
      buf = Buffer.concat([buf, chunk]);
      const nl = buf.indexOf(0x0a);
      if (nl < 0) return;
      const line = buf.subarray(0, nl).toString("utf8").trim();
      const rest = buf.subarray(nl + 1);
      socket.off("data", onData);
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.off("error", fail);
      if (line !== "OK") {
        socket.destroy();
        const message = line.replace(/^ERR\s*/, "") || "overlay dial failed";
        reject(new Error(message === "timeout" ? "RouterOS API timeout" : message));
        return;
      }
      if (rest.length) socket.unshift(rest);
      socket.setTimeout(timeoutMs);
      resolve(socket);
    });
  });
}

export async function routerosApiCommand(
  opts: { host: string; user: string; password: string; port?: number; timeoutMs?: number },
  words: string[],
): Promise<RosApiReply> {
  const host = (opts.host || "").replace(/\/\d+$/, "").trim();
  if (!host) throw new Error("Router overlay address is required");
  const port = opts.port && opts.port > 0 ? opts.port : ROUTEROS_API_PORT;
  let timeout = opts.timeoutMs;
  if (timeout == null) {
    try {
      timeout = loadServiceConfig().mikrotikTimeoutMs;
    } catch {
      timeout = 4000;
    }
  }
  const socket = await openRouterSocket(host, port, timeout);
  try {
    socket.write(encodeSentence(["/login", `=name=${opts.user}`, `=password=${opts.password}`]));
    const login = parseReplies(await readSentences(socket, timeout));
    if (login.type === "trap" || login.type === "fatal") {
      throw new Error(login.attrs.message || "RouterOS API login failed");
    }
    socket.write(encodeSentence(words));
    return parseReplies(await readSentences(socket, timeout));
  } finally {
    socket.destroy();
  }
}

export function identityQuery() {
  return ["/system/identity/print"];
}

export function resourceQuery() {
  return ["/system/resource/print"];
}

export function routerboardQuery() {
  return ["/system/routerboard/print"];
}

export function attr(reply: RosApiReply, key: string) {
  for (const s of reply.sentences) {
    if (s.attrs[key]) return s.attrs[key];
  }
  return reply.attrs[key] || "";
}

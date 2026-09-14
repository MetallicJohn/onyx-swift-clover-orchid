import net from "node:net";
import tls from "node:tls";

export type ProbeStatus = "ok" | "error" | "not_configured" | "stale" | "degraded";

export type Probe = {
  status: ProbeStatus;
  detail?: string;
  latencyMs?: number;
};

export async function tcpProbe(host: string, port: number, timeoutMs = 3000): Promise<Probe> {
  const h = (host || "").trim();
  const p = Number(port);
  if (!h || !Number.isFinite(p) || p < 1) return { status: "not_configured" };
  const started = Date.now();
  return new Promise((resolve) => {
    const sock = net.connect({ host: h, port: p });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ status: "error", detail: "timeout", latencyMs: Date.now() - started });
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ status: "ok", latencyMs: Date.now() - started });
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "error", detail: err.message, latencyMs: Date.now() - started });
    });
  });
}

export async function tlsProbe(host: string, port: number, timeoutMs = 3000): Promise<Probe> {
  const h = (host || "").trim();
  const p = Number(port);
  if (!h || !Number.isFinite(p) || p < 1) return { status: "not_configured" };
  const started = Date.now();
  return new Promise((resolve) => {
    const sock = tls.connect({ host: h, port: p, servername: h, rejectUnauthorized: false });
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ status: "error", detail: "timeout", latencyMs: Date.now() - started });
    }, timeoutMs);
    sock.once("secureConnect", () => {
      clearTimeout(timer);
      sock.destroy();
      resolve({ status: "ok", latencyMs: Date.now() - started });
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      resolve({ status: "error", detail: err.message, latencyMs: Date.now() - started });
    });
  });
}

export function parseHostPort(url: string, fallbackPort: number) {
  const raw = (url || "").trim();
  if (!raw) return { host: "", port: fallbackPort };
  try {
    const withScheme = raw.includes("://") ? raw : `tcp://${raw}`;
    const u = new URL(withScheme);
    return { host: u.hostname, port: Number(u.port || fallbackPort) };
  } catch {
    return { host: "", port: fallbackPort };
  }
}

export async function httpProbe(url: string, timeoutMs = 4000, headers: Record<string, string> = {}): Promise<Probe> {
  const target = (url || "").trim();
  if (!target) return { status: "not_configured" };
  const started = Date.now();
  try {
    const res = await fetch(target, { method: "GET", headers, signal: AbortSignal.timeout(timeoutMs) });
    return {
      status: res.ok ? "ok" : "error",
      detail: res.ok ? undefined : `HTTP ${res.status}`,
      latencyMs: Date.now() - started,
    };
  } catch (err) {
    return {
      status: "error",
      detail: err instanceof Error ? err.message : String(err),
      latencyMs: Date.now() - started,
    };
  }
}

/** Safe retries for idempotent probes only — never billing, payments, or provisioning. */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 2);
  const delayMs = Math.max(0, opts.delayMs ?? 150);
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (i < attempts - 1 && delayMs) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw last;
}

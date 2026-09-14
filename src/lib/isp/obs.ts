const SECRET_KEY = /secret|password|token|passkey|api[_-]?key|private|authorization/i;

export type LogFields = {
  service?: string;
  env?: string;
  requestId?: string;
  correlationId?: string;
  tenantId?: string;
  operation?: string;
  durationMs?: number;
  result?: string;
  error?: string;
  category?: string;
  [key: string]: unknown;
};

function redact(value: unknown): unknown {
  if (value == null) return value;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v);
    }
    return out;
  }
  return value;
}

export function logEvent(level: "info" | "warn" | "error", msg: string, fields: LogFields = {}) {
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    service: fields.service || process.env.ROLE || "ispsolutions-web",
    env: process.env.APP_ENV || process.env.NODE_ENV || "",
    ...(redact(fields) as LogFields),
  };
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export function withDuration<T>(operation: string, fn: () => Promise<T>, extra: LogFields = {}) {
  const started = Date.now();
  return fn()
    .then((result) => {
      logEvent("info", operation, { ...extra, operation, durationMs: Date.now() - started, result: "ok" });
      return result;
    })
    .catch((err) => {
      logEvent("error", operation, {
        ...extra,
        operation,
        durationMs: Date.now() - started,
        result: "error",
        error: err instanceof Error ? err.message : String(err),
        category: "dependency",
      });
      throw err;
    });
}

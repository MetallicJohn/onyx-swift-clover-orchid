import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";

const globalSeal = globalThis as typeof globalThis & { __gridlineSealSecret__?: string };

function configuredSecret() {
  const fromEnv = (process.env.APP_SECRET || process.env.BETTER_AUTH_SECRET || "").trim();
  return fromEnv || "";
}

function keyBytes() {
  const configured = configuredSecret();
  if (configured) return createHash("sha256").update(configured).digest();
  const persistent = Boolean(process.env.DATABASE_URL?.trim());
  if (persistent || process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET or BETTER_AUTH_SECRET is required");
  }
  // Preview only (no DATABASE_URL, not production): random per process. Never a published default.
  globalSeal.__gridlineSealSecret__ ??= randomBytes(32).toString("hex");
  return createHash("sha256").update(globalSeal.__gridlineSealSecret__).digest();
}

export function seal(plain: string) {
  if (!plain) return "";
  if (plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString("base64");
}

export function open(stored: string) {
  if (!stored) return "";
  if (!stored.startsWith(PREFIX)) return stored;
  const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const data = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function hint(stored: string) {
  const plain = open(stored);
  if (!plain) return "";
  if (plain.length <= 4) return "••••";
  return `••••${plain.slice(-4)}`;
}

export function redact(value: string) {
  if (!value) return "";
  return hint(value.startsWith(PREFIX) ? value : seal(value)) || "••••";
}

export function looksLikeSecret(key: string) {
  return /secret|password|token|passkey|api[_-]?key|private/i.test(key);
}

export function redactRecord(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === "string" && looksLikeSecret(k)) out[k] = hint(v) || "••••";
    else out[k] = v;
  }
  return out;
}

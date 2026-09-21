import { nid } from "../utils.ts";

const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = LETTERS + DIGITS;
export const PPPOE_USERNAME_IN_USE = "PPPoE username is already in use.";
export const PPPOE_PASSWORD_MIN = 8;
export const PPPOE_PASSWORD_MAX = 64;
const AMBIGUOUS = /[0OIl1]/;

/** RouterOS / RADIUS-safe username. Allows dots so "John Mwangi" → john.mwangi. */
export function sanitizePppoeUsername(raw: string) {
  return String(raw || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/[._-]{2,}/g, ".")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 32);
}

export function pppoeUsernameFromName(name: string) {
  const parts = String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return sanitizePppoeUsername(parts.join("."));
}

export function generatePppoePassword() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const chars = [...bytes].map((b, i) => {
    if (i === 0) return LETTERS[b % LETTERS.length];
    if (i === 1) return DIGITS[b % DIGITS.length];
    return ALL[b % ALL.length];
  });
  return chars.join("");
}

export function passwordHasAmbiguousChars(password: string) {
  return AMBIGUOUS.test(String(password || ""));
}

export function validatePppoePassword(password: string) {
  const p = String(password || "");
  if (p.length < PPPOE_PASSWORD_MIN) return `PPPoE password must be at least ${PPPOE_PASSWORD_MIN} characters`;
  if (p.length > PPPOE_PASSWORD_MAX) return "PPPoE password is too long";
  return "";
}

export function validatePppoeUsername(username: string) {
  const raw = String(username || "").trim();
  if (!raw) return "Enter a PPPoE username";
  if (!sanitizePppoeUsername(raw)) return "Username format is invalid";
  return "";
}

export function suggestPppoeUsername(input: {
  accountNumber?: string | null;
  phone?: string | null;
  name?: string | null;
  serviceId: string;
}) {
  const fromName = pppoeUsernameFromName(input.name || "");
  const fromAccount = sanitizePppoeUsername(input.accountNumber || "");
  const fromPhone = sanitizePppoeUsername(input.phone || "");
  return fromName || fromAccount || fromPhone || `u${input.serviceId.replace(/[^a-z0-9]/gi, "").slice(-8) || nid("u").slice(-8)}`;
}

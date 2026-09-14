import { nid } from "../utils.ts";
import { hint, open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = LETTERS + DIGITS;

export function sanitizePppoeUsername(raw: string) {
  return String(raw || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 24);
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

export function suggestPppoeUsername(input: {
  accountNumber?: string | null;
  phone?: string | null;
  name?: string | null;
  serviceId: string;
}) {
  const fromAccount = sanitizePppoeUsername(input.accountNumber || "");
  const fromPhone = sanitizePppoeUsername(input.phone || "");
  const fromName = sanitizePppoeUsername(input.name || "");
  return fromAccount || fromPhone || fromName || `u${input.serviceId.replace(/[^a-z0-9]/gi, "").slice(-8) || nid("u").slice(-8)}`;
}

export async function usernameTaken(sql: Sql, tenantId: string, username: string, exceptServiceId = "") {
  const [rad] = await sql<{ id: string }>`
    select id from radius_accounts
    where tenant_id = ${tenantId} and username = ${username}
      and service_id <> ${exceptServiceId || ""}
      and service_id in (select id from services where tenant_id = ${tenantId} and deleted_at is null)
    limit 1`;
  if (rad) return true;
  const [svc] = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and username = ${username}
      and id <> ${exceptServiceId || ""} and deleted_at is null
    limit 1`;
  return Boolean(svc);
}

export async function allocatePppoeUsername(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  preferred: string,
) {
  const base = sanitizePppoeUsername(preferred) || `u${serviceId.slice(-8)}`;
  if (!(await usernameTaken(sql, tenantId, base, serviceId))) return base;
  for (let n = 2; n <= 40; n += 1) {
    const candidate = `${base.slice(0, 20)}${n}`;
    if (!(await usernameTaken(sql, tenantId, candidate, serviceId))) return candidate;
  }
  throw new Error("Duplicate PPPoE username");
}

export function revealRadiusPassword(stored: string) {
  return open(stored);
}

export function storeRadiusPassword(plain: string) {
  return seal(plain);
}

export function radiusPasswordHint(stored: string) {
  return hint(stored);
}

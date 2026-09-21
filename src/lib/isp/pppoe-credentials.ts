import { hint, open, seal } from "./secrets.ts";
import {
  PPPOE_PASSWORD_MAX,
  PPPOE_PASSWORD_MIN,
  PPPOE_USERNAME_IN_USE,
  generatePppoePassword,
  passwordHasAmbiguousChars,
  pppoeUsernameFromName,
  sanitizePppoeUsername,
  suggestPppoeUsername,
  validatePppoePassword,
  validatePppoeUsername,
} from "./pppoe-format.ts";

export {
  PPPOE_PASSWORD_MAX,
  PPPOE_PASSWORD_MIN,
  PPPOE_USERNAME_IN_USE,
  generatePppoePassword,
  passwordHasAmbiguousChars,
  pppoeUsernameFromName,
  sanitizePppoeUsername,
  suggestPppoeUsername,
  validatePppoePassword,
  validatePppoeUsername,
};

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function usernameTaken(sql: Sql, tenantId: string, username: string, exceptServiceId = "") {
  const needle = sanitizePppoeUsername(username);
  if (!needle) return false;
  const [rad] = await sql<{ id: string }>`
    select id from radius_accounts
    where tenant_id = ${tenantId} and username = ${needle}
      and service_id <> ${exceptServiceId || ""}
      and service_id in (select id from services where tenant_id = ${tenantId} and deleted_at is null)
    limit 1`;
  if (rad) return true;
  const [svc] = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and username = ${needle}
      and id <> ${exceptServiceId || ""} and deleted_at is null
    limit 1`;
  return Boolean(svc);
}

export async function allocatePppoeUsername(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  preferred: string,
  skip = "",
) {
  const base = sanitizePppoeUsername(preferred) || `u${(serviceId || "user").replace(/[^a-z0-9]/gi, "").slice(-8) || "user"}`;
  const skipNorm = sanitizePppoeUsername(skip);
  async function free(candidate: string) {
    if (skipNorm && candidate === skipNorm) return false;
    return !(await usernameTaken(sql, tenantId, candidate, serviceId));
  }
  if (await free(base)) return base;
  for (let n = 2; n <= 40; n += 1) {
    const candidate = `${base.slice(0, 28)}${n}`;
    if (await free(candidate)) return candidate;
  }
  throw new Error("Duplicate PPPoE username");
}

export async function assertPppoeUsernameAvailable(
  sql: Sql,
  tenantId: string,
  username: string,
  exceptServiceId = "",
) {
  const format = validatePppoeUsername(username);
  if (format) throw new Error(format);
  const sanitized = sanitizePppoeUsername(username);
  if (await usernameTaken(sql, tenantId, sanitized, exceptServiceId)) {
    throw new Error(PPPOE_USERNAME_IN_USE);
  }
  return sanitized;
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

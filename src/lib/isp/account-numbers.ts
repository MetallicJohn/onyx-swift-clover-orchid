import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const ACCOUNT_SEPARATORS = ["", "-", "/"] as const;
export type AccountSeparator = (typeof ACCOUNT_SEPARATORS)[number];

export type AccountNumberSettings = {
  tenant_id: string;
  enabled: boolean;
  prefix: string;
  suffix: string;
  separator: AccountSeparator;
  start_n: number;
  next_n: number;
  digits: number;
  allow_manual: boolean;
  updated_at: string | null;
};

export type AccountNumberPatch = Partial<
  Omit<AccountNumberSettings, "tenant_id" | "updated_at">
>;

const MAX_N = 99_999_999;

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function defaultPrefix(slug: string) {
  return slug.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toUpperCase() || "CUS";
}

export function normalizeToken(raw: string, max = 12) {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
}

export function normalizeSeparator(raw: string): AccountSeparator {
  if (raw === "/" || raw === "-") return raw;
  return "";
}

export function normalizeAccountNumber(raw: string) {
  return (raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9\-/]/g, "")
    .slice(0, 32);
}

export function formatAccountNumber(opts: {
  prefix: string;
  suffix?: string;
  separator?: string;
  n: number;
  digits: number;
}) {
  const prefix = normalizeToken(opts.prefix);
  const suffix = normalizeToken(opts.suffix || "");
  const sep = normalizeSeparator(opts.separator || "");
  const digits = clampInt(opts.digits, 1, 8, 4);
  const n = clampInt(opts.n, 0, MAX_N, 0);
  return `${prefix}${sep}${String(n).padStart(digits, "0")}${suffix}`;
}

export function defaultsForSlug(slug: string, tenantId = ""): AccountNumberSettings {
  const prefix = defaultPrefix(slug);
  return {
    tenant_id: tenantId,
    enabled: false,
    prefix,
    suffix: "",
    separator: "",
    start_n: 1000,
    next_n: 1000,
    digits: 4,
    allow_manual: false,
    updated_at: null,
  };
}

function parseRow(row: Record<string, unknown> | undefined, fallback: AccountNumberSettings): AccountNumberSettings {
  if (!row) return fallback;
  return {
    tenant_id: String(row.tenant_id || fallback.tenant_id),
    enabled: Boolean(row.enabled),
    prefix: normalizeToken(String(row.prefix ?? fallback.prefix)),
    suffix: normalizeToken(String(row.suffix ?? "")),
    separator: normalizeSeparator(String(row.separator ?? "")),
    start_n: clampInt(row.start_n, 0, MAX_N, fallback.start_n),
    next_n: clampInt(row.next_n, 0, MAX_N, fallback.next_n),
    digits: clampInt(row.digits, 1, 8, fallback.digits),
    allow_manual: Boolean(row.allow_manual),
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function getAccountNumberSettings(sql: Sql, tenantId: string, slug = ""): Promise<AccountNumberSettings> {
  const fallback = defaultsForSlug(slug, tenantId);
  const [row] = await sql<Record<string, unknown>>`
    select tenant_id, enabled, prefix, suffix, separator, start_n, next_n, digits, allow_manual,
           updated_at::text as updated_at
    from customer_account_settings where tenant_id = ${tenantId}`;
  return parseRow(row, fallback);
}

export async function saveAccountNumberSettings(
  sql: Sql,
  tenantId: string,
  slug: string,
  patch: AccountNumberPatch,
): Promise<AccountNumberSettings> {
  const current = await getAccountNumberSettings(sql, tenantId, slug);
  const prefix = patch.prefix !== undefined ? normalizeToken(patch.prefix) : current.prefix;
  const suffix = patch.suffix !== undefined ? normalizeToken(patch.suffix) : current.suffix;
  const separator = patch.separator !== undefined ? normalizeSeparator(patch.separator) : current.separator;
  const startN = patch.start_n !== undefined ? clampInt(patch.start_n, 0, MAX_N, current.start_n) : current.start_n;
  const digits = patch.digits !== undefined ? clampInt(patch.digits, 1, 8, current.digits) : current.digits;
  const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled;
  const allowManual = patch.allow_manual !== undefined ? Boolean(patch.allow_manual) : current.allow_manual;
  let nextN = patch.next_n !== undefined ? clampInt(patch.next_n, 0, MAX_N, current.next_n) : current.next_n;
  if (nextN < startN) nextN = startN;
  if (enabled && !prefix) throw new Error("Prefix is required when automatic numbering is on.");

  await sql`
    insert into customer_account_settings
      (tenant_id, enabled, prefix, suffix, separator, start_n, next_n, digits, allow_manual, updated_at)
    values (
      ${tenantId}, ${enabled}, ${prefix}, ${suffix}, ${separator}, ${startN}, ${nextN}, ${digits}, ${allowManual}, now()
    )
    on conflict (tenant_id) do update set
      enabled = excluded.enabled,
      prefix = excluded.prefix,
      suffix = excluded.suffix,
      separator = excluded.separator,
      start_n = excluded.start_n,
      next_n = excluded.next_n,
      digits = excluded.digits,
      allow_manual = excluded.allow_manual,
      updated_at = now()`;
  return getAccountNumberSettings(sql, tenantId, slug);
}

export async function resetAccountNumberSettings(sql: Sql, tenantId: string, slug: string) {
  return saveAccountNumberSettings(sql, tenantId, slug, defaultsForSlug(slug, tenantId));
}

async function taken(sql: Sql, tenantId: string, value: string, exceptId = "") {
  if (!value) return false;
  const [hit] = exceptId
    ? await sql<{ id: string }>`
        select id from customers
        where tenant_id = ${tenantId} and account_number = ${value} and id <> ${exceptId}
        limit 1`
    : await sql<{ id: string }>`
        select id from customers
        where tenant_id = ${tenantId} and account_number = ${value}
        limit 1`;
  return Boolean(hit);
}

export async function assertUniqueAccountNumber(sql: Sql, tenantId: string, value: string, exceptId = "") {
  const number = normalizeAccountNumber(value);
  if (!number) return "";
  if (await taken(sql, tenantId, number, exceptId)) {
    throw new Error(`Account number ${number} is already assigned.`);
  }
  return number;
}

async function takeNextInteger(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    n: number;
    prefix: string;
    suffix: string;
    separator: string;
    digits: number;
  }>`
    update customer_account_settings
    set next_n = next_n + 1, updated_at = now()
    where tenant_id = ${tenantId}
    returning next_n - 1 as n, prefix, suffix, separator, digits`;
  return row ?? null;
}

/** Allocate the next unique number. Concurrent creates increment next_n atomically. */
export async function allocateAccountNumber(
  sql: Sql,
  tenantId: string,
  requested?: string | null,
): Promise<string> {
  const settings = await getAccountNumberSettings(sql, tenantId);
  const manual = normalizeAccountNumber(requested || "");

  if (!settings.enabled) {
    if (!manual) return "";
    if (!settings.allow_manual) throw new Error("Manual account numbers are turned off for this ISP.");
    return assertUniqueAccountNumber(sql, tenantId, manual);
  }

  if (manual && settings.allow_manual) {
    return assertUniqueAccountNumber(sql, tenantId, manual);
  }

  if (!settings.prefix) throw new Error("Set a prefix in Settings → Account numbers.");

  for (let i = 0; i < 64; i += 1) {
    const row = await takeNextInteger(sql, tenantId);
    if (!row) throw new Error("Set a prefix in Settings → Account numbers.");
    const formatted = formatAccountNumber({
      prefix: row.prefix,
      suffix: row.suffix,
      separator: row.separator,
      n: row.n,
      digits: row.digits,
    });
    if (!(await taken(sql, tenantId, formatted))) return formatted;
  }
  throw new Error("Could not allocate a unique account number. Check the sequence in Settings.");
}

export async function changeCustomerAccountNumber(
  sql: Sql,
  opts: { tenantId: string; customerId: string; next: string; allowManual: boolean },
) {
  const [row] = await sql<{ id: string; account_number: string }>`
    select id, account_number from customers where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("Customer not found");
  const previous = row.account_number || "";
  const next = normalizeAccountNumber(opts.next);
  if (next === previous) return { previous, next };
  if (!opts.allowManual) {
    throw new Error("Manual editing of account numbers is turned off. Enable it in Settings → Account numbers.");
  }
  const unique = await assertUniqueAccountNumber(sql, opts.tenantId, next, opts.customerId);
  await sql`update customers set account_number = ${unique} where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  return { previous, next: unique };
}

export async function previewNextAccountNumber(sql: Sql, tenantId: string, slug = "") {
  const settings = await getAccountNumberSettings(sql, tenantId, slug);
  let n = settings.next_n;
  for (let i = 0; i < 32; i += 1) {
    const formatted = formatAccountNumber({ ...settings, n });
    if (!(await taken(sql, tenantId, formatted))) {
      return { ...settings, preview: formatted, example: formatted };
    }
    n += 1;
  }
  return { ...settings, preview: formatAccountNumber({ ...settings, n: settings.next_n }), example: formatAccountNumber({ ...settings, n: settings.next_n }) };
}

export async function auditAccountChange(
  sql: Sql,
  opts: { tenantId: string; userId: string; action: string; entityId: string; details?: string },
) {
  await sql`
    insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (
      ${nid("aud")}, ${opts.tenantId}, ${opts.userId}, ${opts.action}, 'customer', ${opts.entityId}, ${opts.details || ""}
    )`;
}

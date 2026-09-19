import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const ACCOUNT_SEPARATORS = ["", "-", "/"] as const;
export type AccountSeparator = (typeof ACCOUNT_SEPARATORS)[number];

export const ACCOUNT_SCHEMES = ["random", "sequence"] as const;
export type AccountScheme = (typeof ACCOUNT_SCHEMES)[number];

/** Letters that look like digits (I→1, O→0, L→1). Never used in random codes. */
export const AMBIGUOUS_ACCOUNT_LETTERS = "ILO";
export const ACCOUNT_RANDOM_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
export const ACCOUNT_RANDOM_DIGITS = "0123456789";
export const ACCOUNT_RANDOM_ALPHABET = `${ACCOUNT_RANDOM_LETTERS}${ACCOUNT_RANDOM_DIGITS}`;
export const RANDOM_ACCOUNT_LENGTH = 5;

export type AccountNumberSettings = {
  tenant_id: string;
  enabled: boolean;
  scheme: AccountScheme;
  prefix: string;
  suffix: string;
  separator: AccountSeparator;
  start_n: number;
  next_n: number;
  digits: number;
  allow_manual: boolean;
  prefix_permanent: boolean;
  suffix_permanent: boolean;
  next_prefix_n: number;
  next_suffix_n: number;
  updated_at: string | null;
};

export type AccountNumberPatch = Partial<
  Omit<AccountNumberSettings, "tenant_id" | "updated_at">
>;

export type SequenceKind = "number" | "prefix" | "suffix" | "random";

const MAX_N = 99_999_999;

function clampInt(n: unknown, min: number, max: number, fallback: number) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

export function normalizeScheme(raw: unknown, fallback: AccountScheme = "sequence"): AccountScheme {
  const v = String(raw || "").toLowerCase();
  if (v === "random" || v === "sequence") return v;
  return fallback;
}

function randomInt(max: number) {
  if (max <= 1) return 0;
  const cap = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  let n = 0;
  do {
    crypto.getRandomValues(buf);
    n = buf[0]!;
  } while (n >= cap);
  return n % max;
}

export function randomAccountNumber(length = RANDOM_ACCOUNT_LENGTH) {
  const len = clampInt(length, 4, 8, RANDOM_ACCOUNT_LENGTH);
  const chars: string[] = [
    ACCOUNT_RANDOM_LETTERS[randomInt(ACCOUNT_RANDOM_LETTERS.length)]!,
    ACCOUNT_RANDOM_DIGITS[randomInt(ACCOUNT_RANDOM_DIGITS.length)]!,
  ];
  while (chars.length < len) {
    chars.push(ACCOUNT_RANDOM_ALPHABET[randomInt(ACCOUNT_RANDOM_ALPHABET.length)]!);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    const tmp = chars[i]!;
    chars[i] = chars[j]!;
    chars[j] = tmp;
  }
  return chars.join("");
}

export function isRandomAccountNumber(raw: string) {
  const s = normalizeAccountNumber(raw);
  if (s.length !== RANDOM_ACCOUNT_LENGTH) return false;
  if (![...s].every((ch) => ACCOUNT_RANDOM_ALPHABET.includes(ch))) return false;
  return /[A-Z]/.test(s) && /[0-9]/.test(s);
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

export function isAlphaToken(raw: string) {
  return /^[A-Z]+$/.test(raw);
}

export function isDigitToken(raw: string) {
  return /^[0-9]+$/.test(raw);
}

export function isIncrementingToken(raw: string) {
  return isAlphaToken(raw) || isDigitToken(raw);
}

/** 0 = A, 25 = Z, 26 = AA */
export function alphaToIndex(raw: string) {
  const s = normalizeToken(raw);
  if (!isAlphaToken(s)) return 0;
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, n - 1);
}

export function indexToAlpha(index: number) {
  let x = clampInt(index, 0, MAX_N, 0) + 1;
  let out = "";
  while (x > 0) {
    const rem = (x - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out || "A";
}

export function tokenIndex(raw: string) {
  const s = normalizeToken(raw);
  if (isAlphaToken(s)) return alphaToIndex(s);
  if (isDigitToken(s)) return clampInt(s, 0, MAX_N, 0);
  return 0;
}

export function tokenFromIndex(pattern: string, index: number) {
  const s = normalizeToken(pattern);
  if (isAlphaToken(s)) return indexToAlpha(index);
  if (isDigitToken(s)) return String(clampInt(index, 0, MAX_N, 0)).padStart(s.length, "0");
  return s;
}

export function sequenceKind(s: {
  scheme?: AccountScheme | string;
  prefix: string;
  suffix: string;
  prefix_permanent: boolean;
  suffix_permanent: boolean;
}): SequenceKind {
  if (normalizeScheme(s.scheme, "sequence") === "random") return "random";
  if (!s.suffix_permanent && isIncrementingToken(normalizeToken(s.suffix))) return "suffix";
  if (!s.prefix_permanent && isIncrementingToken(normalizeToken(s.prefix))) return "prefix";
  return "number";
}

export function formatFromSettings(
  s: {
    scheme?: AccountScheme | string;
    prefix: string;
    suffix: string;
    separator?: string;
    start_n: number;
    next_n: number;
    digits: number;
    prefix_permanent: boolean;
    suffix_permanent: boolean;
    next_prefix_n: number;
    next_suffix_n: number;
  },
  offset = 0,
  cursor?: "start" | "next",
) {
  const kind = sequenceKind(s);
  if (kind === "random") return randomAccountNumber();
  if (kind === "suffix") {
    const start = tokenIndex(s.suffix);
    const base = cursor === "next" ? Math.max(s.next_suffix_n, start) : start;
    return formatAccountNumber({
      prefix: s.prefix,
      suffix: tokenFromIndex(s.suffix, base + offset),
      separator: s.separator,
      n: s.start_n,
      digits: s.digits,
    });
  }
  if (kind === "prefix") {
    const start = tokenIndex(s.prefix);
    const base = cursor === "next" ? Math.max(s.next_prefix_n, start) : start;
    return formatAccountNumber({
      prefix: tokenFromIndex(s.prefix, base + offset),
      suffix: s.suffix,
      separator: s.separator,
      n: s.start_n,
      digits: s.digits,
    });
  }
  const n = cursor === "next" ? s.next_n + offset : s.start_n + offset;
  return formatAccountNumber({ ...s, n });
}

export function defaultsForSlug(slug: string, tenantId = ""): AccountNumberSettings {
  const prefix = defaultPrefix(slug);
  return {
    tenant_id: tenantId,
    enabled: true,
    scheme: "random",
    prefix,
    suffix: "",
    separator: "",
    start_n: 1000,
    next_n: 1000,
    digits: 4,
    allow_manual: false,
    prefix_permanent: true,
    suffix_permanent: true,
    next_prefix_n: tokenIndex(prefix),
    next_suffix_n: 0,
    updated_at: null,
  };
}

function parseRow(row: Record<string, unknown> | undefined, fallback: AccountNumberSettings): AccountNumberSettings {
  if (!row) return fallback;
  return {
    tenant_id: String(row.tenant_id || fallback.tenant_id),
    enabled: Boolean(row.enabled),
    scheme: normalizeScheme(row.scheme, "sequence"),
    prefix: normalizeToken(String(row.prefix ?? fallback.prefix)),
    suffix: normalizeToken(String(row.suffix ?? "")),
    separator: normalizeSeparator(String(row.separator ?? "")),
    start_n: clampInt(row.start_n, 0, MAX_N, fallback.start_n),
    next_n: clampInt(row.next_n, 0, MAX_N, fallback.next_n),
    digits: clampInt(row.digits, 1, 8, fallback.digits),
    allow_manual: Boolean(row.allow_manual),
    prefix_permanent: row.prefix_permanent === undefined ? true : Boolean(row.prefix_permanent),
    suffix_permanent: row.suffix_permanent === undefined ? true : Boolean(row.suffix_permanent),
    next_prefix_n: clampInt(row.next_prefix_n, 0, MAX_N, fallback.next_prefix_n),
    next_suffix_n: clampInt(row.next_suffix_n, 0, MAX_N, fallback.next_suffix_n),
    updated_at: row.updated_at ? String(row.updated_at) : null,
  };
}

export async function getAccountNumberSettings(sql: Sql, tenantId: string, slug = ""): Promise<AccountNumberSettings> {
  const fallback = defaultsForSlug(slug, tenantId);
  const [row] = await sql<Record<string, unknown>>`
    select tenant_id, enabled, scheme, prefix, suffix, separator, start_n, next_n, digits, allow_manual,
           prefix_permanent, suffix_permanent, next_prefix_n, next_suffix_n,
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
  const scheme = patch.scheme !== undefined ? normalizeScheme(patch.scheme) : current.scheme;
  const allowManual = patch.allow_manual !== undefined ? Boolean(patch.allow_manual) : current.allow_manual;
  const prefixPermanent = patch.prefix_permanent !== undefined ? Boolean(patch.prefix_permanent) : current.prefix_permanent;
  const suffixPermanent = patch.suffix_permanent !== undefined ? Boolean(patch.suffix_permanent) : current.suffix_permanent;
  let nextN = patch.next_n !== undefined ? clampInt(patch.next_n, 0, MAX_N, current.next_n) : current.next_n;
  if (nextN < startN) nextN = startN;
  let nextPrefixN =
    patch.next_prefix_n !== undefined
      ? clampInt(patch.next_prefix_n, 0, MAX_N, current.next_prefix_n)
      : patch.prefix !== undefined
        ? tokenIndex(prefix)
        : current.next_prefix_n;
  let nextSuffixN =
    patch.next_suffix_n !== undefined
      ? clampInt(patch.next_suffix_n, 0, MAX_N, current.next_suffix_n)
      : patch.suffix !== undefined
        ? tokenIndex(suffix)
        : current.next_suffix_n;
  if (isIncrementingToken(prefix) && nextPrefixN < tokenIndex(prefix)) nextPrefixN = tokenIndex(prefix);
  if (isIncrementingToken(suffix) && nextSuffixN < tokenIndex(suffix)) nextSuffixN = tokenIndex(suffix);
  const sequential = scheme === "sequence";
  if (enabled && sequential && !prefix) throw new Error("Prefix is required when automatic numbering is on.");
  if (enabled && sequential && !prefixPermanent && !isIncrementingToken(prefix)) {
    throw new Error("A changing prefix must be letters (A, B, C) or digits.");
  }
  if (enabled && sequential && !suffixPermanent && !suffix) {
    throw new Error("Set a letter suffix (A, B, C) to increment, or keep the suffix permanent.");
  }
  if (enabled && sequential && !suffixPermanent && suffix && !isIncrementingToken(suffix)) {
    throw new Error("A changing suffix must be letters (A, B, C) or digits.");
  }

  await sql`
    insert into customer_account_settings
      (tenant_id, enabled, scheme, prefix, suffix, separator, start_n, next_n, digits, allow_manual,
       prefix_permanent, suffix_permanent, next_prefix_n, next_suffix_n, updated_at)
    values (
      ${tenantId}, ${enabled}, ${scheme}, ${prefix}, ${suffix}, ${separator}, ${startN}, ${nextN}, ${digits}, ${allowManual},
      ${prefixPermanent}, ${suffixPermanent}, ${nextPrefixN}, ${nextSuffixN}, now()
    )
    on conflict (tenant_id) do update set
      enabled = excluded.enabled,
      scheme = excluded.scheme,
      prefix = excluded.prefix,
      suffix = excluded.suffix,
      separator = excluded.separator,
      start_n = excluded.start_n,
      next_n = excluded.next_n,
      digits = excluded.digits,
      allow_manual = excluded.allow_manual,
      prefix_permanent = excluded.prefix_permanent,
      suffix_permanent = excluded.suffix_permanent,
      next_prefix_n = excluded.next_prefix_n,
      next_suffix_n = excluded.next_suffix_n,
      updated_at = now()`;
  return getAccountNumberSettings(sql, tenantId, slug);
}

export async function resetAccountNumberSettings(sql: Sql, tenantId: string, slug: string) {
  return saveAccountNumberSettings(sql, tenantId, slug, defaultsForSlug(slug, tenantId));
}

async function taken(
  sql: Sql,
  tenantId: string,
  value: string,
  except: { customerId?: string; serviceId?: string } = {},
) {
  if (!value) return false;
  const customerId = except.customerId || "";
  const serviceId = except.serviceId || "";
  const [cus] = customerId
    ? await sql<{ id: string }>`
        select id from customers
        where tenant_id = ${tenantId} and account_number = ${value} and id <> ${customerId}
        limit 1`
    : await sql<{ id: string }>`
        select id from customers
        where tenant_id = ${tenantId} and account_number = ${value}
        limit 1`;
  if (cus) return true;
  const [svc] = serviceId
    ? await sql<{ id: string }>`
        select id from services
        where tenant_id = ${tenantId} and account_number = ${value} and id <> ${serviceId}
        limit 1`
    : await sql<{ id: string }>`
        select id from services
        where tenant_id = ${tenantId} and account_number = ${value}
        limit 1`;
  return Boolean(svc);
}

function exceptFrom(except: { customerId?: string; serviceId?: string } | string = "") {
  if (typeof except === "string") return { customerId: except, serviceId: "" };
  return { customerId: except.customerId || "", serviceId: except.serviceId || "" };
}

export async function assertUniqueAccountNumber(
  sql: Sql,
  tenantId: string,
  value: string,
  except: { customerId?: string; serviceId?: string } | string = "",
) {
  const number = normalizeAccountNumber(value);
  if (!number) return "";
  if (await taken(sql, tenantId, number, exceptFrom(except))) {
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
    start_n: number;
    prefix_permanent: boolean;
    suffix_permanent: boolean;
  }>`
    update customer_account_settings
    set next_n = next_n + 1, updated_at = now()
    where tenant_id = ${tenantId}
    returning next_n - 1 as n, prefix, suffix, separator, digits, start_n, prefix_permanent, suffix_permanent`;
  return row ?? null;
}

async function takeNextPrefix(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    n: number;
    prefix: string;
    suffix: string;
    separator: string;
    digits: number;
    start_n: number;
  }>`
    update customer_account_settings
    set next_prefix_n = next_prefix_n + 1, updated_at = now()
    where tenant_id = ${tenantId}
    returning next_prefix_n - 1 as n, prefix, suffix, separator, digits, start_n`;
  return row ?? null;
}

async function takeNextSuffix(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    n: number;
    prefix: string;
    suffix: string;
    separator: string;
    digits: number;
    start_n: number;
  }>`
    update customer_account_settings
    set next_suffix_n = next_suffix_n + 1, updated_at = now()
    where tenant_id = ${tenantId}
    returning next_suffix_n - 1 as n, prefix, suffix, separator, digits, start_n`;
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

  const kind = sequenceKind(settings);
  if (kind === "random") {
    for (let i = 0; i < 64; i += 1) {
      const formatted = randomAccountNumber();
      if (!(await taken(sql, tenantId, formatted))) return formatted;
    }
    throw new Error("Could not allocate a unique account number. Check the sequence in Settings.");
  }

  if (!settings.prefix) throw new Error("Set a prefix for service account numbers.");

  for (let i = 0; i < 64; i += 1) {
    let formatted = "";
    if (kind === "suffix") {
      const row = await takeNextSuffix(sql, tenantId);
      if (!row) throw new Error("Set a prefix for service account numbers.");
      formatted = formatAccountNumber({
        prefix: row.prefix,
        suffix: tokenFromIndex(row.suffix, row.n),
        separator: row.separator,
        n: row.start_n,
        digits: row.digits,
      });
    } else if (kind === "prefix") {
      const row = await takeNextPrefix(sql, tenantId);
      if (!row) throw new Error("Set a prefix for service account numbers.");
      formatted = formatAccountNumber({
        prefix: tokenFromIndex(row.prefix, row.n),
        suffix: row.suffix,
        separator: row.separator,
        n: row.start_n,
        digits: row.digits,
      });
    } else {
      const row = await takeNextInteger(sql, tenantId);
      if (!row) throw new Error("Set a prefix for service account numbers.");
      formatted = formatAccountNumber({
        prefix: row.prefix,
        suffix: row.suffix,
        separator: row.separator,
        n: row.n,
        digits: row.digits,
      });
    }
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
    throw new Error("Manual editing of account numbers is turned off.");
  }
  const unique = await assertUniqueAccountNumber(sql, opts.tenantId, next, { customerId: opts.customerId });
  await sql`update customers set account_number = ${unique} where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  return { previous, next: unique };
}

export async function changeServiceAccountNumber(
  sql: Sql,
  opts: { tenantId: string; serviceId: string; next: string; allowManual: boolean },
) {
  const [row] = await sql<{ id: string; account_number: string; deleted_at: string | null }>`
    select id, coalesce(account_number,'') as account_number, deleted_at::text as deleted_at
    from services where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("Service not found");
  if (row.deleted_at) throw new Error("Restore this service before changing its account number.");
  const previous = row.account_number || "";
  const next = normalizeAccountNumber(opts.next);
  if (next === previous) return { previous, next };
  if (!opts.allowManual) {
    throw new Error("Manual editing of account numbers is turned off.");
  }
  const unique = await assertUniqueAccountNumber(sql, opts.tenantId, next, { serviceId: opts.serviceId });
  await sql`update services set account_number = ${unique} where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  return { previous, next: unique };
}

export async function ensureServiceAccountNumber(sql: Sql, tenantId: string, serviceId: string, requested?: string | null) {
  const [row] = await sql<{ account_number: string }>`
    select coalesce(account_number,'') as account_number
    from services where id = ${serviceId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Service not found");
  if (row.account_number) return row.account_number;
  const number = await allocateAccountNumber(sql, tenantId, requested);
  if (!number) return "";
  await sql`update services set account_number = ${number} where id = ${serviceId} and tenant_id = ${tenantId}`;
  return number;
}

export async function backfillServiceAccountNumbers(sql: Sql, tenantId: string) {
  const rows = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and coalesce(account_number,'') = ''
    order by created_at, id`;
  let n = 0;
  for (const row of rows) {
    await ensureServiceAccountNumber(sql, tenantId, row.id);
    n += 1;
  }
  return n;
}

export async function previewNextAccountNumber(sql: Sql, tenantId: string, slug = "") {
  const settings = await getAccountNumberSettings(sql, tenantId, slug);
  const kind = sequenceKind(settings);
  if (kind === "random") {
    const samples = [randomAccountNumber(), randomAccountNumber(), randomAccountNumber()];
    return {
      ...settings,
      preview: samples[0],
      example: samples[0],
      sequence: kind,
      example_start: samples[0],
      example_next: samples[1],
      example_third: samples[2],
    };
  }
  for (let i = 0; i < 32; i += 1) {
    const formatted = formatFromSettings(settings, i, "next");
    if (!(await taken(sql, tenantId, formatted))) {
      return {
        ...settings,
        preview: formatted,
        example: formatted,
        sequence: kind,
        example_start: formatFromSettings(settings, 0, "start"),
        example_next: formatFromSettings(settings, 1, "start"),
        example_third: formatFromSettings(settings, 2, "start"),
      };
    }
  }
  const fallback = formatFromSettings(settings, 0, "next");
  return {
    ...settings,
    preview: fallback,
    example: fallback,
    sequence: kind,
    example_start: formatFromSettings(settings, 0, "start"),
    example_next: formatFromSettings(settings, 1, "start"),
    example_third: formatFromSettings(settings, 2, "start"),
  };
}

export async function auditAccountChange(
  sql: Sql,
  opts: { tenantId: string; userId: string; action: string; entityId: string; details?: string; entityType?: string },
) {
  await sql`
    insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (
      ${nid("aud")}, ${opts.tenantId}, ${opts.userId}, ${opts.action}, ${opts.entityType || "customer"}, ${opts.entityId}, ${opts.details || ""}
    )`;
}

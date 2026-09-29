import { nid } from "../utils.ts";
import {
  codeToken,
  isReserved,
  normalizeAccountMode,
  normalizeAssignWhen,
  normalizeCharset,
  normalizeReset,
  normalizeScope,
  parseCodeMap,
  presetPattern,
  renderPattern,
  resolveCode,
  sequenceScopeKey,
  strictAccountNumber,
  stringifyCodeMap,
  usesPatternMode,
  validateAccountValue,
  parsePattern,
  normalizeReservation,
  DEFAULT_SERVICE_CODES,
  DEFAULT_TYPE_CODES,
  type AccountCharset,
  type AccountMode,
  type AssignWhen,
  type RenderContext,
  type ReserveRule,
  type ResetPolicy,
  type SequenceScope,
} from "./account-pattern.ts";


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
  mode: AccountMode;
  pattern: string;
  assign_on: AssignWhen;
  seq_scope: SequenceScope;
  increment_by: number;
  reset_policy: ResetPolicy;
  min_length: number;
  max_length: number;
  charset: AccountCharset;
  type_codes: string;
  service_codes: string;
  branch_codes: string;
  area_codes: string;
  default_branch: string;
  config_version: number;
  import_preserve: boolean;
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
    mode: "legacy",
    pattern: "",
    assign_on: "service",
    seq_scope: "tenant",
    increment_by: 1,
    reset_policy: "never",
    min_length: 1,
    max_length: 32,
    charset: "alnum",
    type_codes: "",
    service_codes: "",
    branch_codes: "",
    area_codes: "",
    default_branch: "",
    config_version: 1,
    import_preserve: true,
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
    mode: normalizeAccountMode(row.mode ?? fallback.mode),
    pattern: String(row.pattern ?? fallback.pattern).slice(0, 180),
    assign_on: normalizeAssignWhen(row.assign_on ?? fallback.assign_on),
    seq_scope: normalizeScope(row.seq_scope ?? fallback.seq_scope),
    increment_by: clampInt(row.increment_by, 1, 100, fallback.increment_by),
    reset_policy: normalizeReset(row.reset_policy ?? fallback.reset_policy),
    min_length: clampInt(row.min_length, 1, 32, fallback.min_length),
    max_length: clampInt(row.max_length, 1, 32, fallback.max_length),
    charset: normalizeCharset(row.charset ?? fallback.charset),
    type_codes: String(row.type_codes ?? ""),
    service_codes: String(row.service_codes ?? ""),
    branch_codes: String(row.branch_codes ?? ""),
    area_codes: String(row.area_codes ?? ""),
    default_branch: codeToken(String(row.default_branch ?? ""), 8),
    config_version: clampInt(row.config_version, 1, 100000, fallback.config_version),
    import_preserve: row.import_preserve === undefined ? true : Boolean(row.import_preserve),
  };
}

export async function getAccountNumberSettings(sql: Sql, tenantId: string, slug = ""): Promise<AccountNumberSettings> {
  const fallback = defaultsForSlug(slug, tenantId);
  const [row] = await sql<Record<string, unknown>>`
    select tenant_id, enabled, scheme, prefix, suffix, separator, start_n, next_n, digits, allow_manual,
           prefix_permanent, suffix_permanent, next_prefix_n, next_suffix_n,
           updated_at::text as updated_at,
           mode, pattern, assign_on, seq_scope, increment_by, reset_policy, min_length, max_length, charset,
           type_codes, service_codes, branch_codes, area_codes, default_branch, config_version, import_preserve
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
  const mode = patch.mode !== undefined ? normalizeAccountMode(patch.mode) : current.mode;
  const patternRaw = patch.pattern !== undefined ? String(patch.pattern).trim().slice(0, 180) : current.pattern;
  const assignOn = patch.assign_on !== undefined ? normalizeAssignWhen(patch.assign_on) : current.assign_on;
  const seqScope = patch.seq_scope !== undefined ? normalizeScope(patch.seq_scope) : current.seq_scope;
  const incrementBy = patch.increment_by !== undefined ? clampInt(patch.increment_by, 1, 100, current.increment_by) : current.increment_by;
  const resetPolicy = patch.reset_policy !== undefined ? normalizeReset(patch.reset_policy) : current.reset_policy;
  let minLength = patch.min_length !== undefined ? clampInt(patch.min_length, 1, 32, current.min_length) : current.min_length;
  let maxLength = patch.max_length !== undefined ? clampInt(patch.max_length, 1, 32, current.max_length) : current.max_length;
  if (maxLength < minLength) maxLength = minLength;
  if (minLength > maxLength) minLength = maxLength;
  const charset = patch.charset !== undefined ? normalizeCharset(patch.charset) : current.charset;
  const typeCodes = patch.type_codes !== undefined ? stringifyCodeMap(parseCodeMap(patch.type_codes)) : current.type_codes;
  const serviceCodes = patch.service_codes !== undefined ? stringifyCodeMap(parseCodeMap(patch.service_codes)) : current.service_codes;
  const branchCodes = patch.branch_codes !== undefined ? stringifyCodeMap(parseCodeMap(patch.branch_codes)) : current.branch_codes;
  const areaCodes = patch.area_codes !== undefined ? stringifyCodeMap(parseCodeMap(patch.area_codes)) : current.area_codes;
  const defaultBranch = patch.default_branch !== undefined ? codeToken(patch.default_branch, 8) : current.default_branch;
  const importPreserve = patch.import_preserve !== undefined ? Boolean(patch.import_preserve) : current.import_preserve;
  const pattern = patternRaw || presetPattern(mode, { prefix, separator, digits, suffix });
  const patternMode = usesPatternMode(mode);
  const sequential = scheme === "sequence" && !patternMode;
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
  if (enabled && patternMode && mode !== "manual" && mode !== "import") {
    const parsed = parsePattern(pattern);
    if (parsed.errors.length) throw new Error(parsed.errors[0]);
  }
  const signature = [
    current.mode, current.pattern, current.prefix, current.separator, current.digits, current.suffix,
    current.seq_scope, current.reset_policy, current.increment_by, current.assign_on,
  ].join("|");
  const nextSignature = [mode, pattern, prefix, separator, digits, suffix, seqScope, resetPolicy, incrementBy, assignOn].join("|");
  const configVersion = signature === nextSignature ? current.config_version : current.config_version + (current.updated_at ? 1 : 0);

  await sql`
    insert into customer_account_settings
      (tenant_id, enabled, scheme, prefix, suffix, separator, start_n, next_n, digits, allow_manual,
       prefix_permanent, suffix_permanent, next_prefix_n, next_suffix_n, updated_at,
       mode, pattern, assign_on, seq_scope, increment_by, reset_policy, min_length, max_length, charset,
       type_codes, service_codes, branch_codes, area_codes, default_branch, config_version, import_preserve)
    values (
      ${tenantId}, ${enabled}, ${scheme}, ${prefix}, ${suffix}, ${separator}, ${startN}, ${nextN}, ${digits}, ${allowManual},
      ${prefixPermanent}, ${suffixPermanent}, ${nextPrefixN}, ${nextSuffixN}, now(),
      ${mode}, ${pattern}, ${assignOn}, ${seqScope}, ${incrementBy}, ${resetPolicy}, ${minLength}, ${maxLength}, ${charset},
      ${typeCodes === "{}" ? "" : typeCodes}, ${serviceCodes === "{}" ? "" : serviceCodes},
      ${branchCodes === "{}" ? "" : branchCodes}, ${areaCodes === "{}" ? "" : areaCodes},
      ${defaultBranch}, ${Math.max(1, configVersion)}, ${importPreserve}
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
      updated_at = now(),
      mode = excluded.mode,
      pattern = excluded.pattern,
      assign_on = excluded.assign_on,
      seq_scope = excluded.seq_scope,
      increment_by = excluded.increment_by,
      reset_policy = excluded.reset_policy,
      min_length = excluded.min_length,
      max_length = excluded.max_length,
      charset = excluded.charset,
      type_codes = excluded.type_codes,
      service_codes = excluded.service_codes,
      branch_codes = excluded.branch_codes,
      area_codes = excluded.area_codes,
      default_branch = excluded.default_branch,
      config_version = excluded.config_version,
      import_preserve = excluded.import_preserve`;
  if (signature !== nextSignature) {
    const saved = await getAccountNumberSettings(sql, tenantId, slug);
    await sql`
      insert into account_number_versions (id, tenant_id, version, mode, pattern, snapshot, actor_id)
      values (
        ${nid("anv")}, ${tenantId}, ${saved.config_version}, ${saved.mode}, ${saved.pattern},
        ${JSON.stringify({
          mode: saved.mode,
          pattern: saved.pattern,
          prefix: saved.prefix,
          separator: saved.separator,
          digits: saved.digits,
          scope: saved.seq_scope,
          reset: saved.reset_policy,
          assign_on: saved.assign_on,
        })},
        ${"system"}
      )
      on conflict (tenant_id, version) do nothing`;
  }
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
        where tenant_id = ${tenantId} and upper(account_number) = ${value} and id <> ${customerId}
        limit 1`
    : await sql<{ id: string }>`
        select id from customers
        where tenant_id = ${tenantId} and upper(account_number) = ${value}
        limit 1`;
  if (cus) return true;
  const [svc] = serviceId
    ? await sql<{ id: string }>`
        select id from services
        where tenant_id = ${tenantId} and upper(account_number) = ${value} and id <> ${serviceId}
        limit 1`
    : await sql<{ id: string }>`
        select id from services
        where tenant_id = ${tenantId} and upper(account_number) = ${value}
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

/** Allocate the next unique number. Concurrent creates increment the sequence atomically. */
export type AllocateContext = {
  customerType?: string;
  serviceType?: string;
  branch?: string;
  area?: string;
  customerCode?: string;
  source?: "automatic" | "manual" | "import";
  reason?: string;
  actorId?: string;
  entityType?: "service" | "customer";
  entityId?: string;
  when?: Date;
};

function sequenceOrigin(settings: AccountNumberSettings) {
  if ((settings.mode === "prefix" || settings.mode === "sequential" || settings.mode === "pattern") && settings.seq_scope === "tenant") {
    return Math.max(settings.start_n, settings.next_n);
  }
  return settings.start_n;
}

function patternText(settings: AccountNumberSettings) {
  return (settings.pattern || presetPattern(settings.mode, settings)).trim();
}

function lookupMapped(map: Record<string, string>, raw: string) {
  const named = resolveCode(map, raw, {});
  if (named) return named;
  const token = codeToken(raw, 8);
  if (!token) return "";
  for (const code of Object.values(map)) {
    if (code === token) return code;
  }
  return "";
}

function patternRand(length: number, alpha: boolean) {
  const alphabet = alpha ? ACCOUNT_RANDOM_ALPHABET : ACCOUNT_RANDOM_DIGITS;
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)]!;
  return out;
}

function codesFor(settings: AccountNumberSettings, ctx: AllocateContext) {
  const types = { ...DEFAULT_TYPE_CODES, ...parseCodeMap(settings.type_codes) };
  const services = { ...DEFAULT_SERVICE_CODES, ...parseCodeMap(settings.service_codes) };
  const branches = parseCodeMap(settings.branch_codes);
  const areas = parseCodeMap(settings.area_codes);
  const branch = lookupMapped(branches, ctx.branch || "") || lookupMapped(branches, ctx.area || "") || settings.default_branch;
  const area = lookupMapped(areas, ctx.area || "") || lookupMapped(areas, ctx.branch || "");
  return {
    prefix: settings.prefix,
    typeCode: resolveCode({ ...types }, ctx.customerType || "", DEFAULT_TYPE_CODES),
    branchCode: branch,
    areaCode: area,
    serviceCode: resolveCode(services, ctx.serviceType || "", DEFAULT_SERVICE_CODES),
    customerId: codeToken(ctx.customerCode || "", 16),
    separator: settings.separator,
    when: ctx.when,
  } satisfies RenderContext;
}

function sampleContext(settings: AccountNumberSettings): RenderContext {
  const branches = parseCodeMap(settings.branch_codes);
  const areas = parseCodeMap(settings.area_codes);
  return codesFor(settings, {
    customerType: "individual",
    serviceType: "pppoe",
    branch: settings.default_branch || Object.values(branches)[0] || "",
    area: Object.values(areas)[0] || "",
    customerCode: "1001",
  });
}

async function loadReservations(sql: Sql, tenantId: string): Promise<ReserveRule[]> {
  const rows = await sql<{ kind: string; value: string; value_end: string }>`
    select kind, value, value_end from account_number_reservations where tenant_id = ${tenantId} order by created_at`;
  return rows.map((row) => ({
    kind: row.kind === "range" || row.kind === "prefix" ? row.kind : "number",
    value: row.value,
    valueEnd: row.value_end,
  }));
}

async function recordAssignment(
  sql: Sql,
  settings: AccountNumberSettings,
  ctx: AllocateContext,
  accountNumber: string,
  previous = "",
  source: "automatic" | "manual" | "import" = "automatic",
) {
  await sql`
    insert into account_number_history
      (id, tenant_id, entity_type, entity_id, account_number, previous_number, source, mode, pattern, config_version, actor_id, reason)
    values (
      ${nid("anh")}, ${settings.tenant_id}, ${ctx.entityType || "service"}, ${ctx.entityId || ""},
      ${accountNumber}, ${previous}, ${source}, ${settings.mode}, ${patternText(settings)}, ${settings.config_version},
      ${ctx.actorId || "system"}, ${(ctx.reason || "").slice(0, 240)}
    )`;
  if (previous && previous !== accountNumber) {
    await sql`
      insert into account_number_aliases (tenant_id, alias, account_number, entity_type, entity_id)
      values (${settings.tenant_id}, ${previous}, ${accountNumber}, ${ctx.entityType || "service"}, ${ctx.entityId || ""})
      on conflict (tenant_id, alias) do update set
        account_number = excluded.account_number,
        entity_type = excluded.entity_type,
        entity_id = excluded.entity_id`;
  }
}

async function takeScopedSequence(sql: Sql, tenantId: string, key: string, start: number, increment: number) {
  const [row] = await sql<{ n: number }>`
    insert into account_sequences (tenant_id, scope_key, next_n)
    values (${tenantId}, ${key}, ${start + increment})
    on conflict (tenant_id, scope_key)
    do update set next_n = account_sequences.next_n + ${increment}, updated_at = now()
    returning next_n - ${increment} as n`;
  return row?.n ?? null;
}

async function allocateFromPattern(
  sql: Sql,
  tenantId: string,
  settings: AccountNumberSettings,
  requested: string,
  ctx: AllocateContext,
) {
  const source = ctx.source || (requested ? "manual" : "automatic");
  const rules = await loadReservations(sql, tenantId);
  const keepSupplied =
    Boolean(requested) && settings.import_preserve && (source === "import" || settings.mode === "import");
  const allowTyped = Boolean(requested) && settings.allow_manual;
  const manualMode = Boolean(requested) && settings.mode === "manual";
  if (keepSupplied || allowTyped || manualMode) {
    const checked = validateAccountValue(requested, {
      minLength: settings.min_length,
      maxLength: settings.max_length,
      charset: settings.charset,
      check: patternText(settings).includes("{CHECK}"),
    });
    if (checked.errors.length) throw new Error(checked.errors[0]);
    if (isReserved(checked.value, rules)) throw new Error(`${checked.value} is reserved and cannot be assigned`);
    const unique = await assertUniqueAccountNumber(sql, tenantId, checked.value, {
      customerId: ctx.entityType === "customer" ? ctx.entityId : "",
      serviceId: ctx.entityType === "service" ? ctx.entityId : "",
    });
    await recordAssignment(sql, settings, ctx, unique, "", source === "automatic" ? "manual" : source);
    return unique;
  }
  if (!settings.enabled || settings.mode === "manual") return "";
  const pattern = patternText(settings);
  if (!pattern) return "";
  const base = codesFor(settings, ctx);
  const probe = renderPattern(pattern, { ...base, seq: sequenceOrigin(settings) });
  if (probe.errors.length) throw new Error(probe.errors[0]);
  const scopeKey = sequenceScopeKey({
    scope: settings.seq_scope,
    reset: settings.reset_policy,
    branch: base.branchCode,
    typeCode: base.typeCode,
    serviceCode: base.serviceCode,
    areaCode: base.areaCode,
    prefix: settings.prefix,
    when: ctx.when,
  });
  for (let i = 0; i < 64; i += 1) {
    const n = await takeScopedSequence(sql, tenantId, scopeKey, sequenceOrigin(settings), settings.increment_by);
    if (n == null) break;
    const rendered = renderPattern(pattern, { ...base, seq: n, rand: patternRand });
    if (rendered.errors.length) throw new Error(rendered.errors[0]);
    const checked = validateAccountValue(rendered.value, {
      minLength: settings.min_length,
      maxLength: settings.max_length,
      charset: settings.charset,
      check: pattern.includes("{CHECK}"),
    });
    if (checked.errors.length) throw new Error(checked.errors[0]);
    if (isReserved(checked.value, rules)) continue;
    if (await taken(sql, tenantId, checked.value)) continue;
    await recordAssignment(sql, settings, ctx, checked.value, "", "automatic");
    return checked.value;
  }
  throw new Error("Could not allocate a unique account number. Check the sequence in Settings.");
}

export async function allocateAccountNumber(
  sql: Sql,
  tenantId: string,
  requested?: string | null,
  ctx: AllocateContext = {},
): Promise<string> {
  const settings = await getAccountNumberSettings(sql, tenantId);
  const manual = normalizeAccountNumber(requested || "");
  if (usesPatternMode(settings.mode)) {
    return allocateFromPattern(sql, tenantId, settings, manual, ctx);
  }

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
  opts: { tenantId: string; customerId: string; next: string; allowManual: boolean; actorId?: string; reason?: string },
) {
  const [row] = await sql<{ id: string; account_number: string }>`
    select id, account_number from customers where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("Customer not found");
  const previous = row.account_number || "";
  const settings = await getAccountNumberSettings(sql, opts.tenantId);
  const checked = usesPatternMode(settings.mode)
    ? validateAccountValue(opts.next, {
        minLength: settings.min_length,
        maxLength: settings.max_length,
        charset: settings.charset,
        check: patternText(settings).includes("{CHECK}"),
      })
    : { value: normalizeAccountNumber(opts.next), errors: [] as string[] };
  if (checked.errors.length) throw new Error(checked.errors[0]);
  const next = checked.value || normalizeAccountNumber(opts.next);
  if (next === previous) return { previous, next };
  if (!opts.allowManual) {
    throw new Error("Manual editing of account numbers is turned off.");
  }
  if (isReserved(next, await loadReservations(sql, opts.tenantId))) {
    throw new Error(`${next} is reserved and cannot be assigned`);
  }
  const unique = await assertUniqueAccountNumber(sql, opts.tenantId, next, { customerId: opts.customerId });
  await sql`update customers set account_number = ${unique} where id = ${opts.customerId} and tenant_id = ${opts.tenantId}`;
  await recordAssignment(
    sql,
    settings,
    { entityType: "customer", entityId: opts.customerId, actorId: opts.actorId, reason: opts.reason },
    unique,
    previous,
    "manual",
  );
  return { previous, next: unique };
}

export async function changeServiceAccountNumber(
  sql: Sql,
  opts: { tenantId: string; serviceId: string; next: string; allowManual: boolean; actorId?: string; reason?: string },
) {
  const [row] = await sql<{ id: string; account_number: string; deleted_at: string | null }>`
    select id, coalesce(account_number,'') as account_number, deleted_at::text as deleted_at
    from services where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("Service not found");
  if (row.deleted_at) throw new Error("Restore this service before changing its account number.");
  const settings = await getAccountNumberSettings(sql, opts.tenantId);
  const checked = usesPatternMode(settings.mode)
    ? validateAccountValue(opts.next, {
        minLength: settings.min_length,
        maxLength: settings.max_length,
        charset: settings.charset,
        check: patternText(settings).includes("{CHECK}"),
      })
    : { value: normalizeAccountNumber(opts.next), errors: [] as string[] };
  if (checked.errors.length) throw new Error(checked.errors[0]);
  const previous = row.account_number || "";
  const next = checked.value || normalizeAccountNumber(opts.next);
  if (next === previous) return { previous, next };
  if (!opts.allowManual) {
    throw new Error("Manual editing of account numbers is turned off.");
  }
  if (isReserved(next, await loadReservations(sql, opts.tenantId))) {
    throw new Error(`${next} is reserved and cannot be assigned`);
  }
  const unique = await assertUniqueAccountNumber(sql, opts.tenantId, next, { serviceId: opts.serviceId });
  await sql`update services set account_number = ${unique} where id = ${opts.serviceId} and tenant_id = ${opts.tenantId}`;
  await recordAssignment(
    sql,
    settings,
    { entityType: "service", entityId: opts.serviceId, actorId: opts.actorId, reason: opts.reason },
    unique,
    previous,
    "manual",
  );
  return { previous, next: unique };
}

export async function ensureServiceAccountNumber(sql: Sql, tenantId: string, serviceId: string, requested?: string | null) {
  const [row] = await sql<{ account_number: string }>`
    select coalesce(account_number,'') as account_number
    from services where id = ${serviceId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Service not found");
  if (row.account_number) return row.account_number;
  const [info] = await sql<{ access_method: string; type: string; address: string; customer_code: string }>`
    select coalesce(s.access_method,'') as access_method, coalesce(c.type,'') as type,
           coalesce(c.address,'') as address, coalesce(c.account_number,'') as customer_code
    from services s
    left join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
    where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  const number = await allocateAccountNumber(sql, tenantId, requested, {
    customerType: info?.type || "",
    serviceType: info?.access_method || "",
    area: info?.address || "",
    customerCode: info?.customer_code || "",
    entityType: "service",
    entityId: serviceId,
    source: requested ? "import" : "automatic",
  });
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
  if (usesPatternMode(settings.mode)) {
    const pattern = patternText(settings);
    const sample = sampleContext(settings);
    const at = (offset: number) => {
      if (!pattern || settings.mode === "manual") return settings.mode === "manual" ? "Manual" : "Import";
      const rendered = renderPattern(pattern, { ...sample, seq: sequenceOrigin(settings) + offset * settings.increment_by });
      return rendered.errors[0] || rendered.value;
    };
    const rules = await loadReservations(sql, tenantId);
    let preview = at(0);
    for (let i = 0; i < 8; i += 1) {
      const candidate = at(i);
      if (!candidate || candidate.includes(" ")) continue;
      if (isReserved(candidate, rules)) continue;
      if (await taken(sql, tenantId, candidate)) continue;
      preview = candidate;
      break;
    }
    return {
      ...settings,
      preview,
      example: preview,
      sequence: settings.mode,
      example_start: at(0),
      example_next: at(1),
      example_third: at(2),
    };
  }
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

export async function listAccountReservations(sql: Sql, tenantId: string) {
  return sql<{ id: string; kind: string; value: string; value_end: string }>`
    select id, kind, value, value_end from account_number_reservations
    where tenant_id = ${tenantId} order by created_at desc limit 40`;
}

export async function addAccountReservation(
  sql: Sql,
  tenantId: string,
  actorId: string,
  input: { kind: "number" | "range" | "prefix"; value: string; valueEnd?: string },
) {
  const kind = input.kind === "range" || input.kind === "prefix" ? input.kind : "number";
  const parsed = normalizeReservation(kind, input.value, input.valueEnd || "");
  if (parsed.error || !parsed.value.replace(/\*/g, "")) throw new Error(parsed.error || "Enter a value to reserve");
  const id = nid("anr");
  await sql`
    insert into account_number_reservations (id, tenant_id, kind, value, value_end, created_by)
    values (${id}, ${tenantId}, ${kind}, ${parsed.value}, ${parsed.valueEnd}, ${actorId || ""})`;
  return { id };
}

export async function removeAccountReservation(sql: Sql, tenantId: string, id: string) {
  await sql`delete from account_number_reservations where tenant_id = ${tenantId} and id = ${id}`;
}

export async function linkLegacyAccountNumber(
  sql: Sql,
  opts: { tenantId: string; alias: string; accountNumber: string; entityType?: string; entityId?: string; actorId?: string; reason?: string },
) {
  const alias = strictAccountNumber(opts.alias);
  const current = strictAccountNumber(opts.accountNumber);
  if (alias.error) throw new Error(alias.error);
  if (current.error) throw new Error(current.error);
  if (alias.value === current.value) throw new Error("The legacy number and the current number are the same");
  await sql`
    insert into account_number_aliases (tenant_id, alias, account_number, entity_type, entity_id)
    values (${opts.tenantId}, ${alias.value}, ${current.value}, ${opts.entityType || "service"}, ${opts.entityId || ""})
    on conflict (tenant_id, alias) do update set
      account_number = excluded.account_number,
      entity_type = excluded.entity_type,
      entity_id = excluded.entity_id`;
  const settings = await getAccountNumberSettings(sql, opts.tenantId);
  await recordAssignment(
    sql,
    settings,
    { entityType: opts.entityType === "customer" ? "customer" : "service", entityId: opts.entityId, actorId: opts.actorId, reason: opts.reason || "Legacy number linked" },
    current.value,
    alias.value,
    "import",
  );
  return { alias: alias.value, accountNumber: current.value };
}

export async function listAccountHistory(sql: Sql, tenantId: string) {
  return sql<{
    id: string;
    account_number: string;
    previous_number: string;
    source: string;
    mode: string;
    pattern: string;
    config_version: number;
    reason: string;
    created_at: string;
  }>`
    select id, account_number, previous_number, source, mode, pattern, config_version, reason, created_at::text as created_at
    from account_number_history where tenant_id = ${tenantId}
    order by created_at desc limit 12`;
}

export async function listAccountVersions(sql: Sql, tenantId: string) {
  return sql<{ version: number; mode: string; pattern: string; created_at: string }>`
    select version, mode, pattern, created_at::text as created_at
    from account_number_versions where tenant_id = ${tenantId}
    order by version desc limit 8`;
}

/** Preview future numbers without moving the sequence. */
export async function testAccountNumbers(sql: Sql, tenantId: string, count = 3) {
  const settings = await getAccountNumberSettings(sql, tenantId);
  const [before] = await sql<{ n: number }>`select count(*)::int as n from account_sequences where tenant_id = ${tenantId}`;
  const rules = await loadReservations(sql, tenantId);
  const total = Math.min(5, Math.max(1, count));
  const pattern = patternText(settings);
  const sample = sampleContext(settings);
  const patterned = usesPatternMode(settings.mode) && settings.mode !== "manual";
  const samples = [];
  for (let i = 0; i < total; i += 1) {
    let value = "";
    let error = "";
    if (settings.mode === "manual") {
      error = "Manual assignment does not draw from the sequence";
    } else if (patterned && pattern) {
      const rendered = renderPattern(pattern, {
        ...sample,
        seq: sequenceOrigin(settings) + i * settings.increment_by,
      });
      value = rendered.value;
      error = rendered.errors[0] || "";
    } else if (patterned) {
      error = "Import keeps a supplied number and does not draw from the sequence";
    } else if (sequenceKind(settings) === "random") {
      value = randomAccountNumber();
    } else {
      value = formatFromSettings(settings, i, "next");
    }
    const reserved = Boolean(value) && isReserved(value, rules);
    const duplicate = Boolean(value) && (await taken(sql, tenantId, value));
    samples.push({
      value: error || value,
      length: value.length,
      reserved,
      duplicate,
      valid: Boolean(value) && !error && !reserved && !duplicate,
    });
  }
  const [after] = await sql<{ n: number }>`select count(*)::int as n from account_sequences where tenant_id = ${tenantId}`;
  const [seq] = await sql<{ next_n: number }>`
    select next_n from account_sequences where tenant_id = ${tenantId} order by scope_key limit 1`;
  const next = samples.find((row) => row.valid)?.value || samples[0]?.value || "";
  return {
    samples,
    next,
    length: next.length,
    sequence: seq?.next_n ?? null,
    sequence_rows: after?.n ?? 0,
    unchanged: (before?.n ?? 0) === (after?.n ?? 0),
    mode: settings.mode,
    pattern,
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

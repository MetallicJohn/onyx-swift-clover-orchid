/** Visual account-number patterns. Pure: no database and no I/O. */

export const ACCOUNT_MODES = [
  "legacy",
  "random",
  "sequential",
  "prefix",
  "type",
  "branch",
  "period",
  "pattern",
  "manual",
  "import",
] as const;
export type AccountMode = (typeof ACCOUNT_MODES)[number];

export const ASSIGN_WHEN = ["service", "customer"] as const;
export type AssignWhen = (typeof ASSIGN_WHEN)[number];

export const SEQUENCE_SCOPES = ["tenant", "branch", "type", "service", "location", "prefix", "year", "year_branch"] as const;
export type SequenceScope = (typeof SEQUENCE_SCOPES)[number];

export const RESET_POLICIES = ["never", "year", "month", "year_branch", "month_branch"] as const;
export type ResetPolicy = (typeof RESET_POLICIES)[number];

export const ACCOUNT_CHARSETS = ["numeric", "alnum", "upper"] as const;
export type AccountCharset = (typeof ACCOUNT_CHARSETS)[number];

export const DEFAULT_TYPE_CODES: Record<string, string> = {
  individual: "RES",
  business: "BUS",
  corporate: "CORP",
  reseller: "RSL",
  institution: "INS",
};

export const DEFAULT_SERVICE_CODES: Record<string, string> = {
  pppoe: "PP",
  static: "ST",
  hotspot: "HS",
  dhcp: "DH",
};

export type PatternPart =
  | { kind: "text"; value: string }
  | { kind: "prefix" }
  | { kind: "seq"; digits: number }
  | { kind: "customer" }
  | { kind: "type" }
  | { kind: "branch" }
  | { kind: "area" }
  | { kind: "service" }
  | { kind: "year" }
  | { kind: "yy" }
  | { kind: "month" }
  | { kind: "day" }
  | { kind: "rand"; length: number; alpha: boolean }
  | { kind: "check" }
  | { kind: "sep" };

export type RenderContext = {
  prefix?: string;
  typeCode?: string;
  branchCode?: string;
  areaCode?: string;
  serviceCode?: string;
  customerId?: string;
  seq?: number;
  when?: Date;
  separator?: string;
  rand?: (length: number, alpha: boolean) => string;
};

export type ReserveRule = { kind: "number" | "range" | "prefix"; value: string; valueEnd?: string };

const TOKEN = /\{([A-Z]+)(?::([A-Z0-9]+))?\}|([^{}]+)/gi;

export function normalizeAccountMode(raw: unknown): AccountMode {
  const v = String(raw || "").toLowerCase();
  return (ACCOUNT_MODES as readonly string[]).includes(v) ? (v as AccountMode) : "legacy";
}

export function normalizeScope(raw: unknown): SequenceScope {
  const v = String(raw || "").toLowerCase();
  return (SEQUENCE_SCOPES as readonly string[]).includes(v) ? (v as SequenceScope) : "tenant";
}

export function normalizeReset(raw: unknown): ResetPolicy {
  const v = String(raw || "").toLowerCase();
  return (RESET_POLICIES as readonly string[]).includes(v) ? (v as ResetPolicy) : "never";
}

export function normalizeCharset(raw: unknown): AccountCharset {
  const v = String(raw || "").toLowerCase();
  return (ACCOUNT_CHARSETS as readonly string[]).includes(v) ? (v as AccountCharset) : "alnum";
}

export function normalizeAssignWhen(raw: unknown): AssignWhen {
  return String(raw || "") === "customer" ? "customer" : "service";
}

export function codeToken(raw: string, max = 8) {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, max);
}

export function parseCodeMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const code = codeToken(String(value));
      const name = key.trim().toLowerCase();
      if (name && code) out[name] = code;
    }
    return out;
  } catch {
    return {};
  }
}

export function stringifyCodeMap(map: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(map)) {
    const code = codeToken(value);
    if (code) out[key.trim().toLowerCase()] = code;
  }
  return JSON.stringify(out);
}

export function resolveCode(map: Record<string, string>, key: string, fallback: Record<string, string> = {}) {
  const name = key.trim().toLowerCase();
  if (!name) return "";
  return map[name] || fallback[name] || "";
}

function clampDigits(raw: string | undefined, fallback: number) {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(8, Math.max(1, n));
}

export function parsePattern(pattern: string): { parts: PatternPart[]; errors: string[] } {
  const errors: string[] = [];
  const parts: PatternPart[] = [];
  const source = pattern.trim();
  if (!source) return { parts, errors: ["Add at least one pattern component"] };
  if (/[{][^{}]*[{]|[}][^{]*[}]/.test(source) || (source.match(/\{/g) || []).length !== (source.match(/\}/g) || []).length) {
    return { parts, errors: ["Pattern has an unfinished component"] };
  }
  TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN.exec(source))) {
    if (match[3]) {
      const literal = match[3].toUpperCase().replace(/\s+/g, "");
      if (!literal) continue;
      if (!/^[A-Z0-9\-/]+$/.test(literal)) {
        errors.push("Fixed text can only use letters, numbers, hyphens, and slashes");
        continue;
      }
      parts.push({ kind: "text", value: literal });
      continue;
    }
    const token = (match[1] || "").toUpperCase();
    const arg = match[2] || "";
    if (token === "TEXT") {
      const value = codeToken(arg, 12);
      if (!value) errors.push("Fixed text needs letters or numbers");
      else parts.push({ kind: "text", value });
    } else if (token === "PREFIX") parts.push({ kind: "prefix" });
    else if (token === "SEQ") parts.push({ kind: "seq", digits: clampDigits(arg, 6) });
    else if (token === "CUSTOMER") parts.push({ kind: "customer" });
    else if (token === "TYPE") parts.push({ kind: "type" });
    else if (token === "BRANCH") parts.push({ kind: "branch" });
    else if (token === "AREA") parts.push({ kind: "area" });
    else if (token === "SERVICE") parts.push({ kind: "service" });
    else if (token === "YEAR") parts.push({ kind: "year" });
    else if (token === "YY") parts.push({ kind: "yy" });
    else if (token === "MONTH") parts.push({ kind: "month" });
    else if (token === "DAY") parts.push({ kind: "day" });
    else if (token === "RAND") parts.push({ kind: "rand", length: clampDigits(arg, 4), alpha: false });
    else if (token === "RANDX") parts.push({ kind: "rand", length: clampDigits(arg, 4), alpha: true });
    else if (token === "CHECK") parts.push({ kind: "check" });
    else if (token === "SEP") parts.push({ kind: "sep" });
    else errors.push(`Unknown component {${token}}`);
  }
  if (!parts.length && !errors.length) errors.push("Add at least one pattern component");
  if (!parts.some((part) => part.kind === "seq" || part.kind === "rand" || part.kind === "customer")) {
    errors.push("Include a sequence, a customer ID, or random characters so numbers can differ");
  }
  return { parts, errors };
}

export function compilePattern(parts: PatternPart[]) {
  return parts
    .map((part) => {
      if (part.kind === "text") return part.value;
      if (part.kind === "prefix") return "{PREFIX}";
      if (part.kind === "seq") return `{SEQ:${part.digits}}`;
      if (part.kind === "customer") return "{CUSTOMER}";
      if (part.kind === "type") return "{TYPE}";
      if (part.kind === "branch") return "{BRANCH}";
      if (part.kind === "area") return "{AREA}";
      if (part.kind === "service") return "{SERVICE}";
      if (part.kind === "year") return "{YEAR}";
      if (part.kind === "yy") return "{YY}";
      if (part.kind === "month") return "{MONTH}";
      if (part.kind === "day") return "{DAY}";
      if (part.kind === "rand") return part.alpha ? `{RANDX:${part.length}}` : `{RAND:${part.length}}`;
      if (part.kind === "check") return "{CHECK}";
      return "{SEP}";
    })
    .join("");
}

export function partLabel(part: PatternPart) {
  if (part.kind === "text") return part.value;
  if (part.kind === "prefix") return "Prefix";
  if (part.kind === "seq") return `Sequence (${part.digits})`;
  if (part.kind === "customer") return "Customer ID";
  if (part.kind === "type") return "Customer type";
  if (part.kind === "branch") return "Branch";
  if (part.kind === "area") return "Area";
  if (part.kind === "service") return "Service type";
  if (part.kind === "year") return "Year";
  if (part.kind === "yy") return "Year (2)";
  if (part.kind === "month") return "Month";
  if (part.kind === "day") return "Day";
  if (part.kind === "rand") return part.alpha ? `Random letters (${part.length})` : `Random digits (${part.length})`;
  if (part.kind === "check") return "Check digit";
  return "Separator";
}

export function presetPattern(mode: string, opts: { prefix?: string; separator?: string; digits?: number; suffix?: string }) {
  const digits = clampDigits(String(opts.digits || 6), 6);
  const sep = opts.separator === "/" || opts.separator === "-" ? opts.separator : "";
  const prefix = codeToken(opts.prefix || "", 12);
  const suffix = codeToken(opts.suffix || "", 12);
  const seq = `{SEQ:${digits}}`;
  if (mode === "sequential") return seq;
  if (mode === "prefix") return `${prefix ? "{PREFIX}" : ""}${sep ? "{SEP}" : ""}${seq}${suffix}`;
  if (mode === "type") return `{TYPE}-{SEQ:${digits}}`;
  if (mode === "branch") return `{BRANCH}-{SEQ:${digits}}`;
  if (mode === "period") return `{YEAR}-{SEQ:${digits}}`;
  return "";
}

export function nairobiParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  const year = get("year");
  return { year, yy: year.slice(-2), month: get("month"), day: get("day") };
}

const RAND_LETTERS = "ABCDEFGHJKMNPQRSTUVWXYZ";
const RAND_DIGITS = "0123456789";

function sampleRand(length: number, alpha: boolean) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alpha ? (i % 2 === 0 ? RAND_LETTERS[i % RAND_LETTERS.length] : RAND_DIGITS[i % 10]) : RAND_DIGITS[i % 10];
  }
  return out;
}

export function luhnCheckDigit(payload: string) {
  const digits = payload.replace(/\D/g, "");
  let sum = 0;
  let doubleIt = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return String((10 - (sum % 10)) % 10);
}

export function renderPattern(pattern: string, ctx: RenderContext): { value: string; errors: string[] } {
  const parsed = parsePattern(pattern);
  if (parsed.errors.length) return { value: "", errors: parsed.errors };
  const when = nairobiParts(ctx.when || new Date());
  const errors: string[] = [];
  let value = "";
  for (const part of parsed.parts) {
    if (part.kind === "text") value += part.value;
    else if (part.kind === "sep") value += ctx.separator === "/" || ctx.separator === "-" ? ctx.separator : "";
    else if (part.kind === "prefix") {
      const prefix = codeToken(ctx.prefix || "", 12);
      if (!prefix) errors.push("Set a prefix before this pattern can be used");
      value += prefix;
    } else if (part.kind === "seq") {
      const n = Math.max(0, Math.floor(Number(ctx.seq) || 0));
      const body = String(n);
      if (body.length > part.digits) errors.push(`Sequence ${body} no longer fits in ${part.digits} digits`);
      value += body.padStart(part.digits, "0");
    } else if (part.kind === "customer") {
      const id = codeToken(ctx.customerId || "", 16);
      if (!id) errors.push("Customer ID is not available for this number");
      value += id;
    } else if (part.kind === "type") {
      const code = codeToken(ctx.typeCode || "", 8);
      if (!code) errors.push("Set a customer-type code before using customer type in the pattern");
      value += code;
    } else if (part.kind === "branch") {
      const code = codeToken(ctx.branchCode || "", 8);
      if (!code) errors.push("Set a branch code before using branch in the pattern");
      value += code;
    } else if (part.kind === "area") {
      const code = codeToken(ctx.areaCode || "", 8);
      if (!code) errors.push("Set an area code before using location in the pattern");
      value += code;
    } else if (part.kind === "service") {
      const code = codeToken(ctx.serviceCode || "", 8);
      if (!code) errors.push("Set a service-type code before using service type in the pattern");
      value += code;
    } else if (part.kind === "year") value += when.year;
    else if (part.kind === "yy") value += when.yy;
    else if (part.kind === "month") value += when.month;
    else if (part.kind === "day") value += when.day;
    else if (part.kind === "rand") value += (ctx.rand || sampleRand)(part.length, part.alpha);
    else if (part.kind === "check") value += luhnCheckDigit(value);
  }
  return { value, errors };
}

export function strictAccountNumber(raw: string) {
  const trimmed = (raw || "").trim();
  if (!trimmed) return { value: "", error: "Enter an account number" };
  if (/\s/.test(trimmed)) return { value: "", error: "Account numbers cannot contain spaces" };
  const value = trimmed.toUpperCase();
  if (value.length > 32) return { value: "", error: "Account numbers are limited to 32 characters" };
  if (!/^[A-Z0-9\-/]+$/.test(value)) {
    return { value: "", error: "Only letters, numbers, hyphens, and slashes are allowed" };
  }
  return { value, error: "" };
}

export function validateAccountValue(
  raw: string,
  rules: { minLength: number; maxLength: number; charset: AccountCharset; check?: boolean },
) {
  const parsed = strictAccountNumber(raw);
  if (parsed.error) return { value: "", errors: [parsed.error] };
  const value = parsed.value;
  const errors: string[] = [];
  const body = value.replace(/[-/]/g, "");
  if (value.length < rules.minLength) errors.push(`Account number must be at least ${rules.minLength} characters`);
  if (value.length > rules.maxLength) errors.push(`Account number must be at most ${rules.maxLength} characters`);
  if (rules.charset === "numeric" && !/^[0-9\-/]+$/.test(value)) errors.push("This format allows numbers only");
  if (rules.charset === "upper" && !/[A-Z]/.test(body)) errors.push("This format expects letters as well as numbers");
  if (rules.check) {
    const payload = value.slice(0, -1);
    const digit = value.slice(-1);
    if (!/^[0-9]$/.test(digit) || luhnCheckDigit(payload) !== digit) errors.push("Check digit does not match");
  }
  return { value, errors };
}

export function normalizeReservation(kind: "number" | "range" | "prefix", value: string, valueEnd = "") {
  if (kind === "prefix") {
    const body = value.trim().toUpperCase().replace(/\s+/g, "").replace(/\*+$/, "");
    if (!body || !/^[A-Z0-9\-/]+$/.test(body)) {
      return { value: "", valueEnd: "", error: "Reserved prefixes can use letters, numbers, hyphens, and slashes" };
    }
    return { value: `${body}*`, valueEnd: "", error: "" };
  }
  const start = strictAccountNumber(value);
  if (start.error) return { value: "", valueEnd: "", error: start.error };
  if (kind === "range") {
    const end = strictAccountNumber(valueEnd);
    if (end.error) return { value: "", valueEnd: "", error: end.error };
    if (!/^[0-9]+$/.test(start.value) || !/^[0-9]+$/.test(end.value)) {
      return { value: "", valueEnd: "", error: "Number ranges must be digits only" };
    }
    return { value: start.value, valueEnd: end.value, error: "" };
  }
  return { value: start.value, valueEnd: "", error: "" };
}

export function isReserved(value: string, rules: ReserveRule[]) {
  const number = strictAccountNumber(value).value;
  if (!number) return false;
  for (const rule of rules) {
    const raw = (rule.value || "").trim().toUpperCase().replace(/\s+/g, "");
    if (!raw) continue;
    if (rule.kind === "prefix" || raw.endsWith("*")) {
      const prefix = raw.replace(/\*+$/, "").replace(/[^A-Z0-9\-/]/g, "");
      if (prefix && number.startsWith(prefix)) return true;
      continue;
    }
    const start = strictAccountNumber(raw).value;
    if (!start) continue;
    if (rule.kind === "range") {
      const end = strictAccountNumber(rule.valueEnd || "").value;
      if (/^[0-9]+$/.test(number) && /^[0-9]+$/.test(start) && /^[0-9]+$/.test(end)) {
        const n = Number(number);
        const a = Number(start);
        const b = Number(end);
        if (n >= Math.min(a, b) && n <= Math.max(a, b)) return true;
      }
      continue;
    }
    if (number === start) return true;
  }
  return false;
}

export function periodStamp(policy: ResetPolicy, when = new Date(), branch = "") {
  const parts = nairobiParts(when);
  const branchCode = codeToken(branch, 8);
  if (policy === "year") return `y:${parts.year}`;
  if (policy === "month") return `m:${parts.year}${parts.month}`;
  if (policy === "year_branch") return `y:${parts.year}:b:${branchCode || "_"}`;
  if (policy === "month_branch") return `m:${parts.year}${parts.month}:b:${branchCode || "_"}`;
  return "";
}

export function sequenceScopeKey(input: {
  scope: SequenceScope;
  reset: ResetPolicy;
  branch?: string;
  typeCode?: string;
  serviceCode?: string;
  areaCode?: string;
  prefix?: string;
  when?: Date;
}) {
  const branch = codeToken(input.branch || "", 8);
  const typeCode = codeToken(input.typeCode || "", 8);
  const serviceCode = codeToken(input.serviceCode || "", 8);
  const area = codeToken(input.areaCode || "", 8);
  const prefix = codeToken(input.prefix || "", 12);
  let scope = "tenant";
  if (input.scope === "branch") scope = `branch:${branch || "_"}`;
  else if (input.scope === "type") scope = `type:${typeCode || "_"}`;
  else if (input.scope === "service") scope = `service:${serviceCode || "_"}`;
  else if (input.scope === "location") scope = `area:${area || "_"}`;
  else if (input.scope === "prefix") scope = `prefix:${prefix || "_"}`;
  else if (input.scope === "year") scope = `year:${nairobiParts(input.when).year}`;
  else if (input.scope === "year_branch") scope = `year:${nairobiParts(input.when).year}:branch:${branch || "_"}`;
  const period = periodStamp(input.reset, input.when, branch);
  return period ? `${scope}:${period}` : scope;
}

export function usesPatternMode(mode: string) {
  return mode === "sequential" || mode === "prefix" || mode === "type" || mode === "branch" || mode === "period" || mode === "pattern" || mode === "manual" || mode === "import";
}

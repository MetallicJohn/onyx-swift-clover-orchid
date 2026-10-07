import { hasPermission, type Permission } from "./rbac.ts";
import { creditCustomerPayment } from "./incoming-payments.ts";
import { apiPaymentMethodLabel, apiPaymentStatusLabel } from "./api-payment-format.ts";
import { loadBrand } from "./documents.ts";
import { formatMoney } from "./document-format.ts";
import { renderApiPaymentsPdf } from "./pdf/api-payments.ts";
import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type ApiPaymentRange = "today" | "yesterday" | "week" | "month" | "all" | "custom";
export type ApiPaymentStatusFilter = "all" | "unmatched" | "matched" | "processed" | "processing_failed";

const RANGES = new Set<ApiPaymentRange>(["today", "yesterday", "week", "month", "all", "custom"]);
const STATUSES = new Set<ApiPaymentStatusFilter>(["all", "unmatched", "matched", "processed", "processing_failed"]);
const SIZES = new Set([25, 50, 100, 250]);

export type ApiPaymentQuery = {
  range?: string;
  status?: string;
  channel?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  size?: number;
  now?: Date;
};

export function parseApiPaymentQuery(input: ApiPaymentQuery = {}) {
  const range = RANGES.has(input.range as ApiPaymentRange) ? (input.range as ApiPaymentRange) : "month";
  const status = STATUSES.has(input.status as ApiPaymentStatusFilter) ? (input.status as ApiPaymentStatusFilter) : "all";
  const size = SIZES.has(Number(input.size)) ? Number(input.size) : 25;
  const page = Math.max(1, Math.floor(Number(input.page) || 1));
  const channel = String(input.channel || "all").slice(0, 40);
  const q = String(input.q || "").trim().slice(0, 80);
  const from = ymd(input.from);
  const to = ymd(input.to);
  return { range, status, channel, q, from, to, page, size };
}

function ymd(value: unknown) {
  const s = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function nairobiDay(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  const weekday = get("weekday") as "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
  return { year: Number(get("year")), month: Number(get("month")), day: Number(get("day")), weekday };
}

function isoDay(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+03:00`;
}

function addDays(year: number, month: number, day: number, delta: number) {
  const t = Date.parse(isoDay(year, month, day)) + delta * 86400_000;
  const d = nairobiDay(new Date(t));
  return { year: d.year, month: d.month, day: d.day };
}

function span(start: { year: number; month: number; day: number }, end: { year: number; month: number; day: number }) {
  return { start: isoDay(start.year, start.month, start.day), end: isoDay(end.year, end.month, end.day) };
}

export function apiPaymentWindows(now = new Date()) {
  const today = nairobiDay(now);
  const yesterday = addDays(today.year, today.month, today.day, -1);
  const tomorrow = addDays(today.year, today.month, today.day, 1);
  const weekIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }[today.weekday];
  const weekStart = addDays(today.year, today.month, today.day, -weekIndex);
  const nextWeek = addDays(weekStart.year, weekStart.month, weekStart.day, 7);
  const prevWeek = addDays(weekStart.year, weekStart.month, weekStart.day, -7);
  const monthStart = { year: today.year, month: today.month, day: 1 };
  const nextMonth = today.month === 12 ? { year: today.year + 1, month: 1, day: 1 } : { year: today.year, month: today.month + 1, day: 1 };
  const prevMonth = today.month === 1 ? { year: today.year - 1, month: 12, day: 1 } : { year: today.year, month: today.month - 1, day: 1 };
  return {
    today: span(today, tomorrow),
    previousDay: span(yesterday, today),
    week: span(weekStart, nextWeek),
    previousWeek: span(prevWeek, weekStart),
    month: span(monthStart, nextMonth),
    previousMonth: span(prevMonth, monthStart),
  };
}

export function apiPaymentDelta(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function boundsFor(query: ReturnType<typeof parseApiPaymentQuery>, now: Date) {
  if (query.range === "all") return null;
  if (query.range === "custom") {
    if (!query.from || !query.to) return null;
    const start = Date.parse(`${query.from}T00:00:00+03:00`);
    const endDay = Date.parse(`${query.to}T00:00:00+03:00`);
    if (!Number.isFinite(start) || !Number.isFinite(endDay)) return null;
    const end = new Date(Math.max(start, endDay) + 86400_000).toISOString();
    const from = new Date(Math.min(start, endDay)).toISOString();
    return { start: from, end };
  }
  const windows = apiPaymentWindows(now);
  if (query.range === "today") return windows.today;
  if (query.range === "yesterday") return windows.previousDay;
  if (query.range === "week") return windows.week;
  return windows.month;
}

function likeTerm(q: string) {
  return `%${q.replace(/[%_\\]/g, "")}%`;
}

type Filter = { sql: Sql; tenantId: string; query: ReturnType<typeof parseApiPaymentQuery>; now: Date };

async function filtered(args: Filter, extraStatus = true) {
  const { sql, tenantId, query, now } = args;
  const window = boundsFor(query, now);
  const like = query.q ? likeTerm(query.q) : "";
  const amount = query.q.replace(/\D/g, "");
  const channel = query.channel !== "all" ? query.channel : "";
  const statusSql =
    !extraStatus || query.status === "all"
      ? ""
      : query.status === "unmatched"
        ? "unmatched"
        : query.status === "processing_failed"
          ? "processing_failed"
          : query.status === "processed"
            ? "processed"
            : "matched";
  return { window, like, amount, channel, statusSql, sql, tenantId };
}

function statusPredicate(statusSql: string) {
  if (statusSql === "unmatched") return "p.status = 'unmatched'";
  if (statusSql === "processing_failed") return "p.status = 'processing_failed'";
  if (statusSql === "processed") return "p.status in ('matched','assigned')";
  if (statusSql === "matched") return "p.status in ('matched','assigned','processing_failed')";
  return "true";
}

export type ApiPaymentRow = {
  id: string;
  provider: string;
  channel: string;
  trans_id: string;
  bill_ref: string;
  msisdn: string;
  payer_name: string;
  amount_kes: number;
  trans_time: string;
  status: string;
  failure_reason: string;
  customer_id: string | null;
  customer_name: string | null;
  service_id: string | null;
  service_name: string | null;
  service_account: string | null;
  payment_id: string | null;
};

async function selectRows(args: Filter, limit: number, offset: number) {
  const f = await filtered(args);
  const status = statusPredicate(f.statusSql);
  const rows = await f.sql.query<ApiPaymentRow>(
    `select p.id, p.provider, p.channel, p.trans_id, p.bill_ref, p.msisdn, p.payer_name, p.amount_kes,
            p.trans_time::text as trans_time, p.status, coalesce(p.failure_reason,'') as failure_reason,
            p.customer_id, c.name as customer_name, p.service_id,
            coalesce(nullif(s.name,''), pk.name) as service_name,
            coalesce(s.account_number,'') as service_account, p.payment_id
     from incoming_payments p
     left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
     left join services s on s.id = p.service_id and s.tenant_id = p.tenant_id
     left join packages pk on pk.id = s.package_id
     where p.tenant_id = $1
       and ($2::timestamptz is null or p.trans_time >= $2::timestamptz)
       and ($3::timestamptz is null or p.trans_time < $3::timestamptz)
       and ($4::text = '' or (p.provider || ':' || p.channel) = $4 or p.channel = $4)
       and ${status}
       and ($5::text = '' or p.trans_id ilike $5 or p.bill_ref ilike $5 or p.payer_name ilike $5
            or p.msisdn ilike $5 or coalesce(c.name,'') ilike $5 or ($6::text <> '' and p.amount_kes::text = $6))
     order by p.trans_time desc, p.id desc
     limit $7 offset $8`,
    [f.tenantId, f.window?.start || null, f.window?.end || null, f.channel, f.like, f.amount, limit, offset],
  );
  const [count] = await f.sql.query<{ n: number }>(
    `select count(*)::int as n
     from incoming_payments p
     left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
     where p.tenant_id = $1
       and ($2::timestamptz is null or p.trans_time >= $2::timestamptz)
       and ($3::timestamptz is null or p.trans_time < $3::timestamptz)
       and ($4::text = '' or (p.provider || ':' || p.channel) = $4 or p.channel = $4)
       and ${status}
       and ($5::text = '' or p.trans_id ilike $5 or p.bill_ref ilike $5 or p.payer_name ilike $5
            or p.msisdn ilike $5 or coalesce(c.name,'') ilike $5 or ($6::text <> '' and p.amount_kes::text = $6))`,
    [f.tenantId, f.window?.start || null, f.window?.end || null, f.channel, f.like, f.amount],
  );
  return { rows, total: count?.n || 0 };
}

async function sumWindow(sql: Sql, tenantId: string, start: string, end: string) {
  const [row] = await sql.query<{ amount: number; n: number }>(
    `select coalesce(sum(amount_kes),0)::int as amount, count(*)::int as n
     from incoming_payments
     where tenant_id = $1 and status <> 'reversed' and trans_time >= $2::timestamptz and trans_time < $3::timestamptz`,
    [tenantId, start, end],
  );
  return { amount: row?.amount || 0, count: row?.n || 0 };
}

export async function loadApiPayments(sql: Sql, tenantId: string, input: ApiPaymentQuery = {}) {
  const query = parseApiPaymentQuery(input);
  const now = input.now || new Date();
  const windows = apiPaymentWindows(now);
  const page = await selectRows({ sql, tenantId, query, now }, query.size, (query.page - 1) * query.size);
  const [today, previousDay, week, previousWeek, month, previousMonth] = await Promise.all([
    sumWindow(sql, tenantId, windows.today.start, windows.today.end),
    sumWindow(sql, tenantId, windows.previousDay.start, windows.previousDay.end),
    sumWindow(sql, tenantId, windows.week.start, windows.week.end),
    sumWindow(sql, tenantId, windows.previousWeek.start, windows.previousWeek.end),
    sumWindow(sql, tenantId, windows.month.start, windows.month.end),
    sumWindow(sql, tenantId, windows.previousMonth.start, windows.previousMonth.end),
  ]);
  const reconWindow = boundsFor({ ...query, status: "all" }, now);
  const [recon] = await sql.query<{
    received: number;
    matched: number;
    unmatched: number;
    processed: number;
    failed: number;
    n_received: number;
    n_unmatched: number;
    n_processed: number;
    n_failed: number;
  }>(
    `select
        coalesce(sum(amount_kes) filter (where status <> 'reversed'),0)::int as received,
        coalesce(sum(amount_kes) filter (where status in ('matched','assigned','processing_failed')),0)::int as matched,
        coalesce(sum(amount_kes) filter (where status = 'unmatched'),0)::int as unmatched,
        coalesce(sum(amount_kes) filter (where status in ('matched','assigned')),0)::int as processed,
        coalesce(sum(amount_kes) filter (where status = 'processing_failed'),0)::int as failed,
        count(*) filter (where status <> 'reversed')::int as n_received,
        count(*) filter (where status = 'unmatched')::int as n_unmatched,
        count(*) filter (where status in ('matched','assigned'))::int as n_processed,
        count(*) filter (where status = 'processing_failed')::int as n_failed
     from incoming_payments
     where tenant_id = $1
       and ($2::timestamptz is null or trans_time >= $2::timestamptz)
       and ($3::timestamptz is null or trans_time < $3::timestamptz)`,
    [tenantId, reconWindow?.start || null, reconWindow?.end || null],
  );
  const methods = await sql.query<{ provider: string; channel: string; amount: number; n: number }>(
    `select provider, channel, coalesce(sum(amount_kes),0)::int as amount, count(*)::int as n
     from incoming_payments
     where tenant_id = $1 and status <> 'reversed'
       and ($2::timestamptz is null or trans_time >= $2::timestamptz)
       and ($3::timestamptz is null or trans_time < $3::timestamptz)
     group by provider, channel
     order by amount desc, provider, channel`,
    [tenantId, reconWindow?.start || null, reconWindow?.end || null],
  );
  const queuePreview = await sql.query<ApiPaymentRow>(
    `select p.id, p.provider, p.channel, p.trans_id, p.bill_ref, p.msisdn, p.payer_name, p.amount_kes,
            p.trans_time::text as trans_time, p.status, coalesce(p.failure_reason,'') as failure_reason,
            p.customer_id, c.name as customer_name, p.service_id,
            coalesce(nullif(s.name,''), pk.name) as service_name,
            coalesce(s.account_number,'') as service_account, p.payment_id
     from incoming_payments p
     left join customers c on c.id = p.customer_id and c.tenant_id = p.tenant_id
     left join services s on s.id = p.service_id and s.tenant_id = p.tenant_id
     left join packages pk on pk.id = s.package_id
     where p.tenant_id = $1 and p.status = 'unmatched'
     order by p.trans_time asc, p.id asc
     limit 5`,
    [tenantId],
  );
  const [queue] = await sql.query<{ n: number; amount: number }>(
    `select count(*)::int as n, coalesce(sum(amount_kes),0)::int as amount
     from incoming_payments where tenant_id = $1 and status = 'unmatched'`,
    [tenantId],
  );
  const [ever] = await sql.query<{ n: number }>(
    `select count(*)::int as n from incoming_payments where tenant_id = $1`,
    [tenantId],
  );
  const methodOptions = await sql.query<{ provider: string; channel: string }>(
    `select distinct provider, channel from incoming_payments where tenant_id = $1 order by provider, channel`,
    [tenantId],
  );
  const card = (current: { amount: number; count: number }, previous: { amount: number; count: number }) => ({
    amount: current.amount,
    count: current.count,
    delta: apiPaymentDelta(current.amount, previous.amount),
  });
  return {
    rows: page.rows,
    total: page.total,
    page: query.page,
    size: query.size,
    query,
    cards: {
      today: card(today, previousDay),
      week: card(week, previousWeek),
      month: card(month, previousMonth),
    },
    reconciliation: {
      received: recon?.received || 0,
      matched: recon?.matched || 0,
      unmatched: recon?.unmatched || 0,
      processed: recon?.processed || 0,
      failed: recon?.failed || 0,
      nReceived: recon?.n_received || 0,
      nUnmatched: recon?.n_unmatched || 0,
      nProcessed: recon?.n_processed || 0,
      nFailed: recon?.n_failed || 0,
    },
    queue: { count: queue?.n || 0, amount: queue?.amount || 0 },
    queuePreview,
    hasAny: (ever?.n || 0) > 0,
    methods,
    methodOptions,
  };
}

export async function searchApiPaymentAccounts(sql: Sql, tenantId: string, q: string) {
  const term = q.trim().slice(0, 80);
  if (term.length < 2) return [];
  const like = likeTerm(term);
  const compact = term.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return sql.query<{
    customer_id: string;
    name: string;
    phone: string;
    account_number: string;
    service_id: string | null;
    service_account: string;
    username: string;
    service_name: string | null;
    package_name: string | null;
    status: string | null;
    period_end: string | null;
  }>(
    `select c.id as customer_id, c.name, c.phone, coalesce(c.account_number,'') as account_number,
            s.id as service_id, coalesce(s.account_number,'') as service_account, coalesce(s.username,'') as username,
            coalesce(nullif(s.name,''), p.name) as service_name, p.name as package_name, s.status,
            s.period_end::text as period_end
     from customers c
     left join services s on s.customer_id = c.id and s.tenant_id = c.tenant_id and s.deleted_at is null and s.status <> 'terminated'
     left join packages p on p.id = s.package_id
     where c.tenant_id = $1 and c.deleted_at is null
       and (
         c.name ilike $2 or c.phone ilike $2 or c.account_number ilike $2
         or coalesce(s.account_number,'') ilike $2 or coalesce(s.username,'') ilike $2
         or s.id = $3
         or ($4 <> '' and upper(regexp_replace(coalesce(s.account_number, c.account_number, ''), '[^A-Za-z0-9]', '', 'g')) = $4)
       )
     order by c.name
     limit 12`,
    [tenantId, like, term, compact],
  );
}

export async function retryApiPayment(
  sql: Sql,
  opts: { tenantId: string; ispName: string; userId: string; id: string },
) {
  const [row] = await sql<{
    id: string;
    status: string;
    customer_id: string | null;
    service_id: string | null;
    trans_id: string;
    amount_kes: number;
    provider: string;
    payment_id: string | null;
  }>`select id, status, customer_id, service_id, trans_id, amount_kes, provider, payment_id
     from incoming_payments where id = ${opts.id} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("API payment not found");
  if (row.status !== "processing_failed") throw new Error("Only a failed payment can be retried");
  if (!row.customer_id) throw new Error("Match the account before retrying");
  const pay = await creditCustomerPayment(sql, {
    tenantId: opts.tenantId,
    ispName: opts.ispName,
    customerId: row.customer_id,
    serviceId: row.service_id || undefined,
    reference: row.trans_id,
    amountKes: row.amount_kes,
    provider: row.provider,
  });
  await sql`update incoming_payments set status = 'assigned', payment_id = ${pay.id}, failure_reason = '',
    processed_at = now(), processed_by = ${opts.userId}, match_method = coalesce(nullif(match_method,''), 'retry')
    where id = ${row.id} and tenant_id = ${opts.tenantId}`;
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${opts.tenantId}, ${opts.userId}, 'api_payment.retried', 'incoming_payment', ${row.id},
      ${JSON.stringify({ transaction: row.trans_id, payment_id: pay.id, duplicate: pay.duplicate }).slice(0, 4000)})`;
  return { id: row.id, payment_id: pay.id, duplicate: pay.duplicate };
}

const SECRET = /password|secret|passkey|token|authorization|credential|consumer|key/i;

type Json = null | string | number | boolean | Json[] | { [key: string]: Json };

function redact(value: unknown): Json {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value === "object") {
    const out: { [key: string]: Json } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET.test(key) ? "[redacted]" : redact(item);
    }
    return out;
  }
  return String(value);
}

export async function loadApiPaymentPayload(sql: Sql, tenantId: string, id: string) {
  const [row] = await sql<{ payload: string; bill_ref: string; trans_id: string }>`
    select payload, bill_ref, trans_id from incoming_payments where id = ${id} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("API payment not found");
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(row.payload || "{}");
  } catch {
    parsed = { raw: row.payload.slice(0, 500) };
  }
  return { trans_id: row.trans_id, bill_ref: row.bill_ref, payload: redact(parsed) };
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function nairobiStamp(iso: string) {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return { date: "", time: "" };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(when);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}:${get("second")}` };
}

export async function exportApiPayments(sql: Sql, tenantId: string, input: ApiPaymentQuery = {}) {
  const query = parseApiPaymentQuery({ ...input, page: 1, size: 25 });
  const now = input.now || new Date();
  const cap = 5000;
  const page = await selectRows({ sql, tenantId, query, now }, cap, 0);
  const header = [
    "Date",
    "Time",
    "Provider",
    "Payment Method",
    "Transaction Code",
    "Payer Name",
    "Phone",
    "Original Account",
    "Matched Account",
    "Customer",
    "Service",
    "Amount (KES)",
    "Status",
    "Payment Reference",
    "Failure",
  ];
  const lines = [header.map(csvCell).join(",")];
  for (const row of page.rows) {
    const stamp = nairobiStamp(row.trans_time);
    lines.push(
      [
        stamp.date,
        stamp.time,
        row.provider,
        apiPaymentMethodLabel(row.provider, row.channel),
        row.trans_id,
        row.payer_name,
        row.msisdn,
        row.bill_ref,
        row.service_account || "",
        row.customer_name || "",
        row.service_name || "",
        row.amount_kes,
        apiPaymentStatusLabel(row.status),
        row.payment_id || "",
        row.failure_reason,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  const bits = [query.range, query.status === "all" ? "" : query.status, query.channel === "all" ? "" : query.channel].filter(Boolean);
  return {
    csv: `\uFEFF${lines.join("\n")}`,
    filename: `api-payments-${bits.join("-")}.csv`,
    total: page.total,
    truncated: page.total > page.rows.length,
    exported: page.rows.length,
  };
}

const PDF_CAP = 400;

function filterCaption(query: ReturnType<typeof parseApiPaymentQuery>, now: Date) {
  const windows = apiPaymentWindows(now);
  const named = {
    today: windows.today,
    yesterday: windows.previousDay,
    week: windows.week,
    month: windows.month,
  } as const;
  let period = "All dates";
  if (query.range === "custom") period = query.from && query.to ? `${query.from} to ${query.to}` : "Custom range";
  else if (query.range !== "all") {
    const window = named[query.range];
    period = `${window.start.slice(0, 10)} to ${window.end.slice(0, 10)}`;
  }
  const status =
    query.status === "all"
      ? "All statuses"
      : query.status === "processed"
        ? "Processed"
        : query.status === "matched"
          ? "Matched"
          : query.status === "processing_failed"
            ? "Processing failed"
            : "Unmatched";
  const method =
    query.channel === "all"
      ? "All methods"
      : query.channel.includes(":")
        ? apiPaymentMethodLabel(query.channel.split(":")[0] || "", query.channel.split(":").slice(1).join(":"))
        : query.channel;
  const search = query.q ? `Search ${query.q}` : "";
  return { period, filters: [status, method, search].filter(Boolean).join("  ·  ") };
}

export async function exportApiPaymentsPdf(sql: Sql, tenantId: string, input: ApiPaymentQuery = {}) {
  const query = parseApiPaymentQuery({ ...input, page: 1, size: 25 });
  const now = input.now || new Date();
  const [brand, desk, page] = await Promise.all([
    loadBrand(sql, tenantId),
    loadApiPayments(sql, tenantId, { ...input, page: 1, size: 25, now }),
    selectRows({ sql, tenantId, query, now }, PDF_CAP, 0),
  ]);
  const caption = filterCaption(query, now);
  const generated = nairobiStamp(now.toISOString());
  const pdf = await renderApiPaymentsPdf({
    brand,
    period: caption.period,
    filters: caption.filters,
    generated: `${generated.date} ${generated.time} EAT`,
    received: desk.reconciliation.received,
    processed: desk.reconciliation.processed,
    unmatched: desk.reconciliation.unmatched,
    failed: desk.reconciliation.failed,
    nReceived: desk.reconciliation.nReceived,
    nProcessed: desk.reconciliation.nProcessed,
    nUnmatched: desk.reconciliation.nUnmatched,
    nFailed: desk.reconciliation.nFailed,
    methods: desk.methods.map((method) => ({
      label: apiPaymentMethodLabel(method.provider, method.channel),
      amount: method.amount,
      n: method.n,
    })),
    rows: page.rows.map((row) => {
      const stamp = nairobiStamp(row.trans_time);
      const [year, month, day] = stamp.date.split("-");
      return {
        when: stamp.date ? `${day}/${month}/${year} ${stamp.time.slice(0, 5)}` : "",
        transaction: row.trans_id,
        method: apiPaymentMethodLabel(row.provider, row.channel),
        account: row.service_account || row.bill_ref || "",
        customer: row.customer_name || "",
        amount: formatMoney(row.amount_kes, brand.currency),
        status: apiPaymentStatusLabel(row.status),
      };
    }),
    total: page.total,
    truncated: page.total > page.rows.length,
  });
  const bits = [query.range, query.status === "all" ? "" : query.status, query.channel === "all" ? "" : query.channel].filter(Boolean);
  return {
    filename: `api-payments-${bits.join("-")}.pdf`,
    pdf,
    total: page.total,
    truncated: page.total > page.rows.length,
    exported: page.rows.length,
  };
}

export function apiPaymentPermission(role: string, action: "view" | "match" | "retry" | "export" | "payload") {
  const allow = (permission: Permission) => hasPermission(role, permission);
  if (action === "view") return allow("payments.read") || allow("billing.api_payments.view");
  if (action === "match") return allow("payments.reconcile") || allow("billing.api_payments.match");
  if (action === "retry") return allow("payments.reconcile") || allow("billing.api_payments.retry");
  if (action === "export") return allow("payments.manage") || allow("billing.api_payments.export");
  return allow("payments.reconcile") || allow("billing.api_payments.retry");
}

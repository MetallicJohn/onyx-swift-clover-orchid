type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const MAX_N = 99_999_999;
const DEFAULT_START = 1;

export type CustomerIdSettings = {
  tenant_id: string;
  start_n: number;
  next_n: number;
  configured: boolean;
  issued: boolean;
  locked: boolean;
  next_preview: string;
  updated_at: string | null;
};

function clampStart(n: unknown, fallback = DEFAULT_START) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_N, Math.max(DEFAULT_START, v));
}

export function formatCustomerId(n: number) {
  return String(clampStart(n));
}

export function normalizeCustomerId(raw: string) {
  const s = (raw || "").trim();
  if (!/^[0-9]+$/.test(s)) return "";
  const n = Number(s);
  if (!Number.isFinite(n) || n < 1) return "";
  return String(Math.floor(n));
}

async function countIssued(sql: Sql, tenantId: string) {
  const [row] = await sql<{ n: number }>`
    select count(*)::int as n
    from customers
    where tenant_id = ${tenantId} and coalesce(account_number, '') <> ''`;
  return row?.n ?? 0;
}

export async function customerIdsIssued(sql: Sql, tenantId: string) {
  return (await countIssued(sql, tenantId)) > 0;
}

async function customerIdTaken(sql: Sql, tenantId: string, value: string) {
  if (!value) return false;
  const [row] = await sql<{ id: string }>`
    select id from customers
    where tenant_id = ${tenantId} and account_number = ${value}
    limit 1`;
  return Boolean(row);
}

async function loadRow(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    tenant_id: string;
    start_n: number;
    next_n: number;
    configured: boolean;
    updated_at: string | null;
  }>`
    select tenant_id, start_n, next_n, configured, updated_at::text as updated_at
    from customer_id_settings where tenant_id = ${tenantId}`;
  return row ?? null;
}

async function ensureRow(sql: Sql, tenantId: string) {
  await sql`
    insert into customer_id_settings (tenant_id, start_n, next_n, configured, updated_at)
    values (${tenantId}, ${DEFAULT_START}, ${DEFAULT_START}, false, now())
    on conflict (tenant_id) do nothing`;
}

async function previewFrom(sql: Sql, tenantId: string, startAt: number) {
  let n = clampStart(startAt);
  for (let i = 0; i < 10_000; i += 1) {
    const formatted = formatCustomerId(n);
    if (!(await customerIdTaken(sql, tenantId, formatted))) return formatted;
    n += 1;
    if (n > MAX_N) break;
  }
  return formatCustomerId(startAt);
}

export async function getCustomerIdSettings(sql: Sql, tenantId: string): Promise<CustomerIdSettings> {
  const issued = await customerIdsIssued(sql, tenantId);
  const row = await loadRow(sql, tenantId);
  const startN = row ? clampStart(row.start_n) : DEFAULT_START;
  const nextN = row ? clampStart(row.next_n, startN) : DEFAULT_START;
  const configured = Boolean(row?.configured) || issued;
  return {
    tenant_id: tenantId,
    start_n: startN,
    next_n: nextN,
    configured,
    issued,
    locked: issued,
    next_preview: await previewFrom(sql, tenantId, nextN),
    updated_at: row?.updated_at ?? null,
  };
}

export async function saveCustomerIdStart(sql: Sql, tenantId: string, startRaw: unknown): Promise<CustomerIdSettings> {
  const issued = await customerIdsIssued(sql, tenantId);
  if (issued) {
    throw new Error("IDs have already been issued. The starting number cannot be changed.");
  }
  const startN = clampStart(startRaw);
  await sql`
    insert into customer_id_settings (tenant_id, start_n, next_n, configured, updated_at)
    values (${tenantId}, ${startN}, ${startN}, true, now())
    on conflict (tenant_id) do update set
      start_n = excluded.start_n,
      next_n = excluded.start_n,
      configured = true,
      updated_at = now()`;
  const saved = await getCustomerIdSettings(sql, tenantId);
  if (saved.locked || saved.start_n !== startN) {
    throw new Error("IDs have already been issued. The starting number cannot be changed.");
  }
  return saved;
}

async function takeNext(sql: Sql, tenantId: string) {
  const [row] = await sql<{ n: number }>`
    update customer_id_settings
    set next_n = next_n + 1, configured = true, updated_at = now()
    where tenant_id = ${tenantId}
    returning next_n - 1 as n`;
  return row?.n ?? null;
}

/** Allocate the next unique numeric customer ID. Concurrent creates increment next_n atomically. */
export async function allocateCustomerId(sql: Sql, tenantId: string): Promise<string> {
  await ensureRow(sql, tenantId);
  for (let i = 0; i < 10_000; i += 1) {
    const n = await takeNext(sql, tenantId);
    if (n == null) throw new Error("Could not allocate ID.");
    const formatted = formatCustomerId(n);
    if (!(await customerIdTaken(sql, tenantId, formatted))) return formatted;
  }
  throw new Error("Could not allocate a unique ID.");
}

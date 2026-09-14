type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const RETENTION_KPIS = [
  { id: "churn", kpi: "Monthly churn", measure: "% of active customers who leave" },
  { id: "renewal", kpi: "Renewal rate", measure: "% of customers who renew" },
  { id: "reactivation", kpi: "Reactivation rate", measure: "% of disconnected customers who return" },
  { id: "csat", kpi: "Customer satisfaction", measure: "Survey score / CSAT" },
  { id: "complaints", kpi: "Complaint resolution", measure: "Time to resolve and repeat complaints" },
  { id: "referrals", kpi: "Referral customers", measure: "New customers from existing customers" },
] as const;

export type RetentionKpiId = (typeof RETENTION_KPIS)[number]["id"];

export type RetentionTone = "ok" | "warn" | "danger" | "muted";

export type RetentionSnapshot = {
  month: string;
  churn: { start: number; left: number; rate: number | null };
  renewal: { due: number; renewed: number; rate: number | null };
  reactivation: { disconnected: number; returned: number; rate: number | null };
  csat: { collected: false };
  complaints: { open: number; closed: number; repeats: number };
  referrals: { converted: number; newCustomers: number; rate: number | null };
};

export type RetentionKpiRow = {
  id: RetentionKpiId;
  kpi: string;
  measure: string;
  value: string;
  detail: string;
  tone: RetentionTone;
};

const LIVE = new Set(["active", "grace", "pending", "suspended"]);

export function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return numerator / denominator;
}

export function formatPct(rate: number | null): string {
  if (rate == null || Number.isNaN(rate)) return "—";
  const pct = rate * 100;
  const digits = pct > 0 && pct < 1 ? 1 : pct % 1 === 0 ? 0 : 1;
  return `${pct.toFixed(digits)}%`;
}

function ofCount(part: number, whole: number, empty: string) {
  if (whole <= 0) return empty;
  return `${part} of ${whole}`;
}

export function emptyRetention(now = new Date()): RetentionSnapshot {
  return {
    month: now.toISOString().slice(0, 7),
    churn: { start: 0, left: 0, rate: null },
    renewal: { due: 0, renewed: 0, rate: null },
    reactivation: { disconnected: 0, returned: 0, rate: null },
    csat: { collected: false },
    complaints: { open: 0, closed: 0, repeats: 0 },
    referrals: { converted: 0, newCustomers: 0, rate: null },
  };
}

export function presentRetention(snap: RetentionSnapshot): RetentionKpiRow[] {
  return RETENTION_KPIS.map((def) => {
    if (def.id === "churn") {
      return {
        ...def,
        value: formatPct(snap.churn.rate),
        detail: ofCount(snap.churn.left, snap.churn.start, "No start-of-month book yet"),
        tone: toneChurn(snap.churn.rate),
      };
    }
    if (def.id === "renewal") {
      return {
        ...def,
        value: formatPct(snap.renewal.rate),
        detail: ofCount(snap.renewal.renewed, snap.renewal.due, "No invoices due this month"),
        tone: toneRenewal(snap.renewal.rate),
      };
    }
    if (def.id === "reactivation") {
      const whole = snap.reactivation.disconnected + snap.reactivation.returned;
      return {
        ...def,
        value: formatPct(snap.reactivation.rate),
        detail: ofCount(snap.reactivation.returned, whole, "No disconnected accounts this month"),
        tone: "muted",
      };
    }
    if (def.id === "csat") {
      return {
        ...def,
        value: "Not collected",
        detail: "No survey score on file",
        tone: "muted",
      };
    }
    if (def.id === "complaints") {
      const total = snap.complaints.open + snap.complaints.closed;
      return {
        ...def,
        value: total === 0 ? "—" : `${snap.complaints.closed} closed · ${snap.complaints.open} open`,
        detail:
          total === 0
            ? "No tickets this month"
            : snap.complaints.repeats
              ? `${snap.complaints.repeats} repeat${snap.complaints.repeats === 1 ? "" : "s"}`
              : "No repeat complaints",
        tone: snap.complaints.repeats > 0 ? "warn" : total === 0 ? "muted" : "ok",
      };
    }
    return {
      ...def,
      value: formatPct(snap.referrals.rate) === "—" && snap.referrals.converted === 0
        ? "—"
        : snap.referrals.newCustomers > 0
          ? formatPct(snap.referrals.rate)
          : String(snap.referrals.converted),
      detail:
        snap.referrals.newCustomers > 0
          ? `${snap.referrals.converted} of ${snap.referrals.newCustomers} new this month`
          : snap.referrals.converted
            ? `${snap.referrals.converted} converted`
            : "No referral conversions this month",
      tone: snap.referrals.converted > 0 ? "ok" : "muted",
    };
  });
}

function toneChurn(rate: number | null): RetentionTone {
  if (rate == null) return "muted";
  if (rate <= 0.05) return "ok";
  if (rate <= 0.1) return "warn";
  return "danger";
}

function toneRenewal(rate: number | null): RetentionTone {
  if (rate == null) return "muted";
  if (rate >= 0.9) return "ok";
  if (rate >= 0.75) return "warn";
  return "danger";
}

function monthStartIso(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

function customerLeft(
  row: { status: string; deleted_at: string | null; live: number; services: number },
) {
  if (row.deleted_at) return true;
  if (row.status === "inactive") return true;
  return row.services > 0 && row.live === 0;
}

function customerDisconnected(row: { status: string; live: number; access: number }) {
  if (row.status === "inactive") return true;
  return row.access > 0 && row.live === 0;
}

export async function loadRetentionKpis(sql: Sql, tenantId: string, now = new Date()): Promise<RetentionSnapshot> {
  const monthStart = monthStartIso(now);
  const month = monthStart.slice(0, 7);

  const customers = await sql<{
    id: string;
    status: string;
    created_at: string;
    deleted_at: string | null;
  }>`select id, status, created_at::text as created_at, deleted_at::text as deleted_at
     from customers where tenant_id = ${tenantId}`;

  const services = await sql<{ customer_id: string; status: string; deleted_at: string | null }>`
    select customer_id, status, deleted_at::text as deleted_at
    from services where tenant_id = ${tenantId}`;

  const liveBy = new Map<string, { live: number; access: number; services: number }>();
  for (const s of services) {
    const cur = liveBy.get(s.customer_id) ?? { live: 0, access: 0, services: 0 };
    if (!s.deleted_at) {
      cur.services += 1;
      if (LIVE.has(s.status)) cur.access += 1;
      if (s.status === "active" || s.status === "grace" || s.status === "pending") cur.live += 1;
    }
    liveBy.set(s.customer_id, cur);
  }

  let start = 0;
  let left = 0;
  let disconnected = 0;
  let newCustomers = 0;
  for (const c of customers) {
    const svc = liveBy.get(c.id) ?? { live: 0, access: 0, services: 0 };
    const created = Date.parse(c.created_at);
    const deleted = c.deleted_at ? Date.parse(c.deleted_at) : null;
    const monthT = Date.parse(monthStart);
    if (created >= monthT && !c.deleted_at) newCustomers += 1;
    const inStartBook = created < monthT && (deleted == null || deleted >= monthT);
    if (inStartBook) {
      start += 1;
      if (customerLeft({ status: c.status, deleted_at: c.deleted_at, live: svc.access, services: svc.services })) {
        left += 1;
      }
    }
    if (!c.deleted_at && customerDisconnected({ status: c.status, live: svc.live, access: svc.services })) {
      disconnected += 1;
    }
  }

  const dueRows = await sql<{ customer_id: string; status: string }>`
    select customer_id, status from invoices
    where tenant_id = ${tenantId}
      and due_date >= ${monthStart.slice(0, 10)}::date
      and due_date < (${monthStart.slice(0, 10)}::date + interval '1 month')`;
  const dueIds = new Set(dueRows.map((r) => r.customer_id));
  const paidDue = new Set(dueRows.filter((r) => r.status === "paid").map((r) => r.customer_id));
  const pays = await sql<{ customer_id: string }>`
    select distinct customer_id from payments
    where tenant_id = ${tenantId} and status = 'confirmed' and paid_at >= ${monthStart}::timestamptz`;
  for (const p of pays) {
    if (dueIds.has(p.customer_id)) paidDue.add(p.customer_id);
  }

  const restored = await sql<{ customer_id: string }>`
    select distinct customer_id from notification_logs
    where tenant_id = ${tenantId}
      and event_code = 'service.restored'
      and created_at >= ${monthStart}::timestamptz
      and customer_id is not null`;
  const returnedIds = new Set(restored.map((r) => r.customer_id).filter(Boolean));
  const returned = returnedIds.size;
  // Restored customers are usually active again — keep them in the denominator.
  const reactivationDen = disconnected + [...returnedIds].filter((id) => {
    const c = customers.find((row) => row.id === id);
    if (!c || c.deleted_at) return false;
    const svc = liveBy.get(id) ?? { live: 0, access: 0, services: 0 };
    return !customerDisconnected({ status: c.status, live: svc.live, access: svc.services });
  }).length;

  const tickets = await sql<{ customer_id: string | null; status: string }>`
    select customer_id, status from tickets
    where tenant_id = ${tenantId} and created_at >= ${monthStart}::timestamptz`;
  let open = 0;
  let closed = 0;
  const byCustomer = new Map<string, number>();
  for (const t of tickets) {
    if (t.status === "closed" || t.status === "resolved") closed += 1;
    else open += 1;
    if (t.customer_id) byCustomer.set(t.customer_id, (byCustomer.get(t.customer_id) ?? 0) + 1);
  }
  const repeats = [...byCustomer.values()].filter((n) => n >= 2).length;

  const [ref] = await sql<{ n: number }>`
    select count(*)::int as n from referrals
    where tenant_id = ${tenantId} and status = 'converted' and created_at >= ${monthStart}::timestamptz`;

  return {
    month,
    churn: { start, left, rate: ratio(left, start) },
    renewal: { due: dueIds.size, renewed: paidDue.size, rate: ratio(paidDue.size, dueIds.size) },
    reactivation: { disconnected, returned, rate: ratio(returned, Math.max(reactivationDen, returned)) },
    csat: { collected: false },
    complaints: { open, closed, repeats },
    referrals: {
      converted: ref?.n ?? 0,
      newCustomers,
      rate: ratio(ref?.n ?? 0, newCustomers),
    },
  };
}

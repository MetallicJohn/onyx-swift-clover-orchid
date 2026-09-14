import { intervalDays, moneyRound } from "./billing.ts";
import { loadRetentionKpis, ratio, formatPct } from "./retention.ts";
import { kes } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const CLV_METRICS = [
  { id: "predicted", metric: "Predicted CLV", measure: "This-month ARPU ÷ monthly churn" },
  { id: "arpu", metric: "This-month ARPU", measure: "Confirmed collections / active customers" },
  { id: "listArpu", metric: "List ARPU", measure: "Average live package price per month" },
  { id: "tenure", metric: "Expected tenure", measure: "1 / monthly churn" },
  { id: "realizedAvg", metric: "Average realized LTV", measure: "Mean confirmed collections per paying customer" },
  { id: "realizedMedian", metric: "Median realized LTV", measure: "Median confirmed collections per paying customer" },
  { id: "margin", metric: "Gross margin & CAC", measure: "Contribution margin and acquisition cost" },
] as const;

export type ClvMetricId = (typeof CLV_METRICS)[number]["id"];
export type ClvTone = "ok" | "warn" | "danger" | "muted";

const LIVE = new Set(["active", "grace", "pending"]);

export type ClvPackageRow = {
  packageId: string;
  name: string;
  live: number;
  monthlyKes: number;
  collectedMonthKes: number;
  predictedClvKes: number | null;
};

export type ClvCustomerRow = {
  id: string;
  name: string;
  status: string;
  packageName: string;
  collectedKes: number;
  months: number | null;
};

export type ClvSnapshot = {
  month: string;
  activeCustomers: number;
  payingCustomers: number;
  customers: number;
  collectedKes: number;
  collectedMonthKes: number;
  arpu: number | null;
  listArpu: number | null;
  churnRate: number | null;
  expectedTenureMonths: number | null;
  observedLeaverMonths: number | null;
  predictedClvKes: number | null;
  realizedAvgKes: number | null;
  realizedMedianKes: number | null;
  byPackage: ClvPackageRow[];
  topCustomers: ClvCustomerRow[];
};

export type ClvKpiRow = {
  id: ClvMetricId;
  metric: string;
  measure: string;
  value: string;
  detail: string;
  tone: ClvTone;
};

export function expectedTenureMonths(churnRate: number | null): number | null {
  if (churnRate == null || churnRate <= 0 || Number.isNaN(churnRate)) return null;
  return 1 / churnRate;
}

export function predictedClvKes(arpu: number | null, churnRate: number | null): number | null {
  if (arpu == null || churnRate == null || churnRate <= 0 || Number.isNaN(arpu) || Number.isNaN(churnRate)) {
    return null;
  }
  return moneyRound(arpu / churnRate);
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? null;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

export function monthlyPriceKes(priceKes: number, billingInterval: string) {
  const days = intervalDays(billingInterval);
  if (days <= 0) return moneyRound(priceKes);
  return moneyRound(priceKes * (30 / days));
}

export function formatMonths(n: number | null): string {
  if (n == null || Number.isNaN(n)) return "—";
  const digits = n >= 10 && n % 1 === 0 ? 0 : 1;
  return `${n.toFixed(digits)} mo`;
}

export function formatKesOrDash(amount: number | null): string {
  if (amount == null || Number.isNaN(amount)) return "—";
  return kes(Math.round(amount));
}

function monthsBetween(fromIso: string, to: Date) {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return null;
  const days = (to.getTime() - from) / 86400_000;
  if (days < 0) return 0;
  return days / 30;
}

export function emptyClv(now = new Date()): ClvSnapshot {
  return {
    month: now.toISOString().slice(0, 7),
    activeCustomers: 0,
    payingCustomers: 0,
    customers: 0,
    collectedKes: 0,
    collectedMonthKes: 0,
    arpu: null,
    listArpu: null,
    churnRate: null,
    expectedTenureMonths: null,
    observedLeaverMonths: null,
    predictedClvKes: null,
    realizedAvgKes: null,
    realizedMedianKes: null,
    byPackage: [],
    topCustomers: [],
  };
}

export function presentClv(snap: ClvSnapshot): ClvKpiRow[] {
  return CLV_METRICS.map((def) => {
    if (def.id === "predicted") {
      return {
        ...def,
        value: formatKesOrDash(snap.predictedClvKes),
        detail: predictedDetail(snap),
        tone: snap.predictedClvKes == null ? "muted" : "ok",
      };
    }
    if (def.id === "arpu") {
      return {
        ...def,
        value: formatKesOrDash(snap.arpu),
        detail:
          snap.activeCustomers <= 0
            ? "No active customers"
            : `${formatKesOrDash(snap.collectedMonthKes)} from ${snap.activeCustomers} active`,
        tone: snap.arpu == null ? "muted" : "ok",
      };
    }
    if (def.id === "listArpu") {
      return {
        ...def,
        value: formatKesOrDash(snap.listArpu),
        detail: snap.listArpu == null ? "No live packages" : "Sum of live monthly prices / customers on a live service",
        tone: snap.listArpu == null ? "muted" : "ok",
      };
    }
    if (def.id === "tenure") {
      return {
        ...def,
        value: formatMonths(snap.expectedTenureMonths),
        detail: tenureDetail(snap),
        tone: tenureTone(snap.expectedTenureMonths),
      };
    }
    if (def.id === "realizedAvg") {
      return {
        ...def,
        value: formatKesOrDash(snap.realizedAvgKes),
        detail:
          snap.payingCustomers <= 0
            ? "No confirmed payments yet"
            : `${snap.payingCustomers} paying · ${formatKesOrDash(snap.collectedKes)} collected`,
        tone: snap.realizedAvgKes == null ? "muted" : "ok",
      };
    }
    if (def.id === "realizedMedian") {
      return {
        ...def,
        value: formatKesOrDash(snap.realizedMedianKes),
        detail: snap.realizedMedianKes == null ? "No confirmed payments yet" : "Less pulled by a few large accounts",
        tone: snap.realizedMedianKes == null ? "muted" : "ok",
      };
    }
    return {
      ...def,
      value: "Not collected",
      detail: "Bandwidth cost and acquisition spend are not on this book",
      tone: "muted",
    };
  });
}

function predictedDetail(snap: ClvSnapshot) {
  if (snap.activeCustomers <= 0) return "No active customers";
  if (snap.churnRate == null) return "No start-of-month book yet";
  if (snap.churnRate <= 0) return "No churn this month — cannot project lifespan";
  return `${formatKesOrDash(snap.arpu)} ÷ ${formatPct(snap.churnRate)} churn`;
}

function tenureDetail(snap: ClvSnapshot) {
  if (snap.churnRate == null) return "No start-of-month book yet";
  if (snap.churnRate <= 0) return "No churn this month — cannot project lifespan";
  if (snap.observedLeaverMonths != null) {
    return `Leavers averaged ${formatMonths(snap.observedLeaverMonths)} on the book`;
  }
  return "From this month’s churn on the start-of-month book";
}

function tenureTone(months: number | null): ClvTone {
  if (months == null) return "muted";
  if (months < 6) return "warn";
  return "ok";
}

export async function loadClv(
  sql: Sql,
  tenantId: string,
  opts?: { now?: Date; churnRate?: number | null },
): Promise<ClvSnapshot> {
  const now = opts?.now ?? new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
  const month = monthStart.slice(0, 7);
  const monthT = Date.parse(monthStart);

  let churnRate = opts?.churnRate;
  if (churnRate === undefined) {
    const retention = await loadRetentionKpis(sql, tenantId, now);
    churnRate = retention.churn.rate;
  }

  const customers = await sql<{
    id: string;
    name: string;
    status: string;
    created_at: string;
    deleted_at: string | null;
  }>`select id, name, status, created_at::text as created_at, deleted_at::text as deleted_at
     from customers where tenant_id = ${tenantId}`;

  const services = await sql<{
    customer_id: string;
    status: string;
    deleted_at: string | null;
    package_id: string;
    package_name: string;
    price_kes: number;
    billing_interval: string;
  }>`select s.customer_id, s.status, s.deleted_at::text as deleted_at,
            p.id as package_id, p.name as package_name, p.price_kes, p.billing_interval
     from services s
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId}`;

  const payments = await sql<{ customer_id: string; amount_kes: number; paid_at: string }>`
    select customer_id, amount_kes, paid_at::text as paid_at
    from payments
    where tenant_id = ${tenantId} and status = 'confirmed'`;

  const collectedBy = new Map<string, number>();
  const monthBy = new Map<string, number>();
  let collectedKes = 0;
  let collectedMonthKes = 0;
  for (const p of payments) {
    collectedKes += p.amount_kes;
    collectedBy.set(p.customer_id, (collectedBy.get(p.customer_id) ?? 0) + p.amount_kes);
    if (Date.parse(p.paid_at) >= monthT) {
      collectedMonthKes += p.amount_kes;
      monthBy.set(p.customer_id, (monthBy.get(p.customer_id) ?? 0) + p.amount_kes);
    }
  }

  type LivePkg = { packageId: string; name: string; monthlyKes: number };
  const liveBy = new Map<string, LivePkg[]>();
  const accessBy = new Map<string, number>();
  const serviceBy = new Map<string, number>();
  for (const s of services) {
    if (s.deleted_at) continue;
    serviceBy.set(s.customer_id, (serviceBy.get(s.customer_id) ?? 0) + 1);
    if (s.status === "active" || s.status === "grace" || s.status === "pending" || s.status === "suspended") {
      accessBy.set(s.customer_id, (accessBy.get(s.customer_id) ?? 0) + 1);
    }
    if (!LIVE.has(s.status)) continue;
    const list = liveBy.get(s.customer_id) ?? [];
    list.push({
      packageId: s.package_id,
      name: s.package_name,
      monthlyKes: monthlyPriceKes(s.price_kes, s.billing_interval),
    });
    liveBy.set(s.customer_id, list);
  }

  let activeCustomers = 0;
  let listNumerator = 0;
  let listDenom = 0;
  const leaverMonths: number[] = [];
  const pkgStats = new Map<string, ClvPackageRow>();

  for (const c of customers) {
    const live = liveBy.get(c.id) ?? [];
    if (!c.deleted_at && c.status === "active") activeCustomers += 1;
    if (!c.deleted_at && live.length > 0) {
      listNumerator += live.reduce((sum, p) => sum + p.monthlyKes, 0);
      listDenom += 1;
    }

    const left =
      Boolean(c.deleted_at) ||
      c.status === "inactive" ||
      ((serviceBy.get(c.id) ?? 0) > 0 && (accessBy.get(c.id) ?? 0) === 0);
    const created = Date.parse(c.created_at);
    if (left && !Number.isNaN(created) && created < monthT) {
      const end = c.deleted_at ? Date.parse(c.deleted_at) : now.getTime();
      const days = (end - created) / 86400_000;
      if (days >= 0) leaverMonths.push(days / 30);
    }

    if (c.deleted_at) continue;
    const primary = [...live].sort((a, b) => b.monthlyKes - a.monthlyKes)[0];
    if (!primary) continue;
    const cur = pkgStats.get(primary.packageId) ?? {
      packageId: primary.packageId,
      name: primary.name,
      live: 0,
      monthlyKes: primary.monthlyKes,
      collectedMonthKes: 0,
      predictedClvKes: null,
    };
    cur.live += 1;
    cur.collectedMonthKes += monthBy.get(c.id) ?? 0;
    pkgStats.set(primary.packageId, cur);
  }

  const realized = [...collectedBy.values()].filter((n) => n > 0);
  const payingCustomers = realized.length;

  const byPackage = [...pkgStats.values()]
    .map((row) => ({
      ...row,
      predictedClvKes: predictedClvKes(row.monthlyKes, churnRate ?? null),
    }))
    .sort((a, b) => b.live - a.live || a.name.localeCompare(b.name));

  const topCustomers: ClvCustomerRow[] = customers
    .filter((c) => (collectedBy.get(c.id) ?? 0) > 0)
    .map((c) => {
      const live = liveBy.get(c.id) ?? [];
      const primary = [...live].sort((a, b) => b.monthlyKes - a.monthlyKes)[0];
      return {
        id: c.id,
        name: c.name,
        status: c.deleted_at ? "archived" : c.status,
        packageName: primary?.name ?? "—",
        collectedKes: collectedBy.get(c.id) ?? 0,
        months: monthsBetween(c.created_at, now),
      };
    })
    .sort((a, b) => b.collectedKes - a.collectedKes)
    .slice(0, 8);

  const arpu = ratio(collectedMonthKes, activeCustomers);
  const listArpu = ratio(listNumerator, listDenom);
  const tenure = expectedTenureMonths(churnRate ?? null);
  const observed = median(leaverMonths);

  return {
    month,
    activeCustomers,
    payingCustomers,
    customers: customers.filter((c) => !c.deleted_at).length,
    collectedKes,
    collectedMonthKes,
    arpu: arpu == null ? null : moneyRound(arpu),
    listArpu: listArpu == null ? null : moneyRound(listArpu),
    churnRate: churnRate ?? null,
    expectedTenureMonths: tenure == null ? null : Math.round(tenure * 10) / 10,
    observedLeaverMonths: observed == null ? null : Math.round(observed * 10) / 10,
    predictedClvKes: predictedClvKes(arpu == null ? null : moneyRound(arpu), churnRate ?? null),
    realizedAvgKes: payingCustomers ? moneyRound(collectedKes / payingCustomers) : null,
    realizedMedianKes: median(realized) == null ? null : moneyRound(median(realized) ?? 0),
    byPackage,
    topCustomers,
  };
}


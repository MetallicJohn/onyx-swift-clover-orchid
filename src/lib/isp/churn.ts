import { remainingKes } from "./billing.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type ChurnBand = "low" | "medium" | "high" | "churned";

export type ChurnFeatures = {
  customerStatus: string;
  services: Array<{
    status: string;
    periodEnd: string | null;
    bundleUsed: number;
    bundleMb: number;
  }>;
  invoices: Array<{
    status: string;
    dueDate: string;
    amount: number;
    paid: number;
  }>;
  lastPaymentAt: string | null;
  openTickets: number;
  billingTickets: number;
  now?: Date;
};

export type ChurnScore = {
  score: number;
  probability: number;
  band: ChurnBand;
  reasons: string[];
};

const UNPAID = new Set(["issued", "due", "overdue", "partial"]);

function sigmoid(z: number) {
  if (z > 12) return 1;
  if (z < -12) return 0;
  return 1 / (1 + Math.exp(-z));
}

function daysBetween(from: Date, to: Date) {
  return Math.floor((to.getTime() - from.getTime()) / 86400_000);
}

function pack(probability: number, reasons: string[], band?: ChurnBand): ChurnScore {
  const p = Math.min(1, Math.max(0, probability));
  const score = Math.round(p * 100);
  const resolved: ChurnBand = band ?? (score >= 65 ? "high" : score >= 40 ? "medium" : "low");
  return { score, probability: Math.round(p * 1000) / 1000, band: resolved, reasons: reasons.slice(0, 4) };
}

/** Interpretable logistic model. Weights are documented, not fitted on a private dataset. */
export function scoreChurn(f: ChurnFeatures): ChurnScore {
  const now = f.now ?? new Date();
  const reasons: string[] = [];

  if (f.customerStatus === "inactive") {
    return pack(0.93, ["Account marked inactive"], "churned");
  }

  const live = f.services.filter((s) => s.status !== "terminated");
  if (f.services.length > 0 && live.length === 0) {
    return pack(0.9, ["All services terminated"], "churned");
  }

  let z = -2.6;

  if (f.services.length === 0) {
    z += 1.5;
    reasons.push("No service on the account");
  }

  if (live.some((s) => s.status === "suspended")) {
    z += 2.4;
    reasons.push("Service is suspended");
  } else if (live.some((s) => s.status === "grace")) {
    z += 2.2;
    reasons.push("In grace period");
  }

  if (live.some((s) => s.bundleMb > 0 && s.bundleUsed >= s.bundleMb)) {
    z += 0.85;
    reasons.push("Data bundle exhausted");
  }

  const unpaid = f.invoices.filter((i) => UNPAID.has(i.status));
  let maxOverdue = 0;
  for (const inv of unpaid) {
    const due = Date.parse(inv.dueDate);
    if (Number.isNaN(due)) continue;
    maxOverdue = Math.max(maxOverdue, daysBetween(new Date(due), now));
  }
  if (maxOverdue > 0) {
    z += 0.028 * Math.min(maxOverdue, 90);
    reasons.push(`${maxOverdue} day${maxOverdue === 1 ? "" : "s"} overdue`);
  }

  const outstanding = unpaid.reduce((sum, i) => sum + remainingKes(i.amount, i.paid, i.status), 0);
  if (outstanding > 0) {
    z += Math.min(1.1, outstanding / 4500);
    reasons.push(`KES ${outstanding.toLocaleString("en-KE")} outstanding`);
  }

  if (unpaid.some((i) => i.status === "partial")) {
    z += 0.35;
    reasons.push("Partial payment on an invoice");
  }

  if (f.lastPaymentAt) {
    const last = Date.parse(f.lastPaymentAt);
    if (!Number.isNaN(last)) {
      const idle = daysBetween(new Date(last), now);
      if (idle >= 40 && unpaid.length > 0) {
        z += Math.min(1.1, (idle - 30) * 0.03);
        reasons.push(`Last payment ${idle} days ago`);
      }
    }
  } else if (unpaid.length > 0) {
    z += 0.7;
    reasons.push("No confirmed payment on file");
  }

  for (const s of live) {
    if (!s.periodEnd) continue;
    const end = Date.parse(s.periodEnd);
    if (Number.isNaN(end)) continue;
    const left = daysBetween(now, new Date(end));
    if (left <= 3 && left >= -1 && unpaid.length > 0) {
      z += 0.7;
      reasons.push("Period ending with unpaid invoice");
      break;
    }
  }

  if (f.openTickets > 0) {
    z += 0.28 * Math.min(f.openTickets, 4);
    reasons.push(`${f.openTickets} open ticket${f.openTickets === 1 ? "" : "s"}`);
  }
  if (f.billingTickets > 0) {
    z += 0.45;
    reasons.push("Open billing complaint");
  }

  return pack(sigmoid(z), reasons);
}

export function churnTone(band: ChurnBand | string) {
  if (band === "high" || band === "churned") return "danger" as const;
  if (band === "medium") return "warn" as const;
  return "ok" as const;
}

export type CustomerChurn = ChurnScore & {
  customerId: string;
  name: string;
  balanceKes: number;
};

export async function loadChurnScores(sql: Sql, tenantId: string): Promise<CustomerChurn[]> {
  const customers = await sql<{ id: string; name: string; status: string }>`
    select id, name, status from customers where tenant_id = ${tenantId}`;
  if (customers.length === 0) return [];

  const services = await sql<{
    customer_id: string;
    status: string;
    period_end: string | null;
    bundle_used_mb: number;
    bundle_mb: number;
  }>`select s.customer_id, s.status, s.period_end::text as period_end, s.bundle_used_mb, p.bundle_mb
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId}`;

  const invoices = await sql<{
    customer_id: string;
    status: string;
    due_date: string;
    amount_kes: number;
    paid_kes: number;
  }>`select customer_id, status, due_date::text as due_date, amount_kes, paid_kes
     from invoices where tenant_id = ${tenantId}`;

  const pays = await sql<{ customer_id: string; paid_at: string }>`
    select customer_id, max(paid_at)::text as paid_at
    from payments where tenant_id = ${tenantId} and status = 'confirmed'
    group by customer_id`;

  const tickets = await sql<{ customer_id: string; open: number; billing: number }>`
    select customer_id,
      count(*) filter (where status not in ('closed','resolved'))::int as open,
      count(*) filter (where status not in ('closed','resolved') and category = 'billing')::int as billing
    from tickets
    where tenant_id = ${tenantId} and customer_id is not null
    group by customer_id`;

  const svcBy = new Map<string, ChurnFeatures["services"]>();
  for (const s of services) {
    const list = svcBy.get(s.customer_id) ?? [];
    list.push({
      status: s.status,
      periodEnd: s.period_end,
      bundleUsed: s.bundle_used_mb,
      bundleMb: s.bundle_mb,
    });
    svcBy.set(s.customer_id, list);
  }
  const invBy = new Map<string, ChurnFeatures["invoices"]>();
  for (const i of invoices) {
    const list = invBy.get(i.customer_id) ?? [];
    list.push({ status: i.status, dueDate: i.due_date, amount: i.amount_kes, paid: i.paid_kes });
    invBy.set(i.customer_id, list);
  }
  const payBy = new Map(pays.map((p) => [p.customer_id, p.paid_at]));
  const tixBy = new Map(tickets.map((t) => [t.customer_id, t]));

  return customers
    .map((c) => {
      const feats: ChurnFeatures = {
        customerStatus: c.status,
        services: svcBy.get(c.id) ?? [],
        invoices: invBy.get(c.id) ?? [],
        lastPaymentAt: payBy.get(c.id) ?? null,
        openTickets: tixBy.get(c.id)?.open ?? 0,
        billingTickets: tixBy.get(c.id)?.billing ?? 0,
      };
      const scored = scoreChurn(feats);
      const unpaid = (invBy.get(c.id) ?? []).filter((i) => UNPAID.has(i.status));
      const balanceKes = unpaid.reduce((sum, i) => sum + remainingKes(i.amount, i.paid, i.status), 0);
      return { ...scored, customerId: c.id, name: c.name, balanceKes };
    })
    .sort((a, b) => b.score - a.score);
}

import { nid } from "@/lib/utils";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const PLANS = {
  trial: { max_customers: 50, max_routers: 5, monthly_kes: 0 },
  starter: { max_customers: 500, max_routers: 20, monthly_kes: 4999 },
  growth: { max_customers: 5000, max_routers: 100, monthly_kes: 14999 },
} as const;

export type PlanCode = keyof typeof PLANS;

export async function ensureSubscription(sql: Sql, tenantId: string) {
  const [row] = await sql<{
    id: string;
    plan: string;
    status: string;
    max_customers: number;
    max_routers: number;
    monthly_kes: number;
    period_end: string | null;
  }>`select id, plan, status, max_customers, max_routers, monthly_kes, period_end::text as period_end
     from tenant_subscriptions where tenant_id = ${tenantId}`;
  if (row) return row;
  const spec = PLANS.trial;
  const end = new Date(Date.now() + 14 * 86400_000);
  const id = nid("sub");
  await sql`insert into tenant_subscriptions (id, tenant_id, plan, status, max_customers, max_routers, monthly_kes, period_end)
    values (${id}, ${tenantId}, 'trial', 'trial', ${spec.max_customers}, ${spec.max_routers}, ${spec.monthly_kes}, ${end.toISOString()})`;
  return {
    id,
    plan: "trial",
    status: "trial",
    ...spec,
    period_end: end.toISOString(),
  };
}

export async function changePlan(sql: Sql, tenantId: string, plan: PlanCode) {
  const spec = PLANS[plan];
  if (!spec) throw new Error("Unknown plan");
  await ensureSubscription(sql, tenantId);
  const end = new Date(Date.now() + 30 * 86400_000);
  const status = plan === "trial" ? "trial" : "active";
  await sql`update tenant_subscriptions
    set plan = ${plan}, status = ${status}, max_customers = ${spec.max_customers}, max_routers = ${spec.max_routers},
        monthly_kes = ${spec.monthly_kes}, period_end = ${end.toISOString()}
    where tenant_id = ${tenantId}`;
  return { plan, status, ...spec, period_end: end.toISOString() };
}

export async function assertCustomerQuota(sql: Sql, tenantId: string) {
  const sub = await ensureSubscription(sql, tenantId);
  const [n] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = ${tenantId}`;
  if ((n?.n ?? 0) >= sub.max_customers) {
    throw new Error(`Plan ${sub.plan} allows ${sub.max_customers} customers. Upgrade in Settings → Plan.`);
  }
}

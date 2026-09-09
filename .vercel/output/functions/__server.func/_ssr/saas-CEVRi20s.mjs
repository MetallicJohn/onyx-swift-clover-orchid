import { b as nid } from "./rls-stkZtAMF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/saas-CEVRi20s.js
var PLANS = {
	trial: {
		max_customers: 50,
		max_routers: 5,
		monthly_kes: 0
	},
	starter: {
		max_customers: 500,
		max_routers: 20,
		monthly_kes: 4999
	},
	growth: {
		max_customers: 5e3,
		max_routers: 100,
		monthly_kes: 14999
	}
};
async function ensureSubscription(sql, tenantId) {
	const [row] = await sql`select id, plan, status, max_customers, max_routers, monthly_kes, period_end::text as period_end
     from tenant_subscriptions where tenant_id = ${tenantId}`;
	if (row) return row;
	const spec = PLANS.trial;
	const end = new Date(Date.now() + 12096e5);
	const id = nid("sub");
	await sql`insert into tenant_subscriptions (id, tenant_id, plan, status, max_customers, max_routers, monthly_kes, period_end)
    values (${id}, ${tenantId}, 'trial', 'trial', ${spec.max_customers}, ${spec.max_routers}, ${spec.monthly_kes}, ${end.toISOString()})`;
	return {
		id,
		plan: "trial",
		status: "trial",
		...spec,
		period_end: end.toISOString()
	};
}
async function changePlan(sql, tenantId, plan) {
	const spec = PLANS[plan];
	if (!spec) throw new Error("Unknown plan");
	await ensureSubscription(sql, tenantId);
	const end = new Date(Date.now() + 2592e6);
	const status = plan === "trial" ? "trial" : "active";
	await sql`update tenant_subscriptions
    set plan = ${plan}, status = ${status}, max_customers = ${spec.max_customers}, max_routers = ${spec.max_routers},
        monthly_kes = ${spec.monthly_kes}, period_end = ${end.toISOString()}
    where tenant_id = ${tenantId}`;
	return {
		plan,
		status,
		...spec,
		period_end: end.toISOString()
	};
}
async function assertCustomerQuota(sql, tenantId) {
	const sub = await ensureSubscription(sql, tenantId);
	const [n] = await sql`select count(*)::int as n from customers where tenant_id = ${tenantId}`;
	if ((n?.n ?? 0) >= sub.max_customers) throw new Error(`Plan ${sub.plan} allows ${sub.max_customers} customers. Upgrade in Settings → Plan.`);
}
//#endregion
export { changePlan as n, ensureSubscription as r, assertCustomerQuota as t };

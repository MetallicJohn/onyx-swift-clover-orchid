import { b as nid } from "./rls-stkZtAMF.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/resellers-D82O6Apv.js
async function awardLoyalty(sql, tenantId, customerId, amountKes, reason = "payment", refId = "") {
	if (!customerId) return 0;
	const points = Math.floor(amountKes / 10);
	if (points <= 0) return 0;
	const existing = await sql`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
	if (existing[0]) await sql`update loyalty_accounts set points = ${existing[0].points + points} where id = ${existing[0].id}`;
	else await sql`insert into loyalty_accounts (id, tenant_id, customer_id, points)
      values (${nid("loy")}, ${tenantId}, ${customerId}, ${points})`;
	await sql`insert into loyalty_transactions (id, tenant_id, customer_id, delta, reason, ref_id)
    values (${nid("ltx")}, ${tenantId}, ${customerId}, ${points}, ${reason}, ${refId})`;
	return points;
}
async function redeemLoyalty(sql, tenantId, customerId, points) {
	const n = Math.floor(points);
	if (n < 1) throw new Error("Points required");
	const [acc] = await sql`
    select id, points from loyalty_accounts where tenant_id = ${tenantId} and customer_id = ${customerId}`;
	if (!acc || acc.points < n) throw new Error("Not enough points");
	await sql`update loyalty_accounts set points = ${acc.points - n} where id = ${acc.id}`;
	await sql`insert into loyalty_transactions (id, tenant_id, customer_id, delta, reason, ref_id)
    values (${nid("ltx")}, ${tenantId}, ${customerId}, ${-n}, 'redeem', '')`;
	return { points: acc.points - n };
}
async function creditReseller(sql, tenantId, customerId, amountKes, paymentId) {
	if (!customerId || amountKes <= 0) return null;
	const [cus] = await sql`
    select reseller_id from customers where id = ${customerId} and tenant_id = ${tenantId}`;
	if (!cus?.reseller_id) return null;
	const [rs] = await sql`
    select id, commission_pct, status from resellers where id = ${cus.reseller_id} and tenant_id = ${tenantId}`;
	if (!rs || rs.status !== "active") return null;
	const commission = Math.floor(amountKes * rs.commission_pct / 100);
	if (commission <= 0) return null;
	const [wallet] = await sql`
    select id, balance_kes from reseller_wallets where tenant_id = ${tenantId} and reseller_id = ${rs.id}`;
	if (wallet) await sql`update reseller_wallets set balance_kes = ${wallet.balance_kes + commission} where id = ${wallet.id}`;
	else await sql`insert into reseller_wallets (id, tenant_id, reseller_id, balance_kes)
      values (${nid("rwl")}, ${tenantId}, ${rs.id}, ${commission})`;
	await sql`insert into reseller_transactions (id, tenant_id, reseller_id, delta_kes, reason, ref_id)
    values (${nid("rtx")}, ${tenantId}, ${rs.id}, ${commission}, 'commission', ${paymentId})`;
	return {
		reseller_id: rs.id,
		commission
	};
}
async function attachCustomerReseller(sql, tenantId, customerId, resellerId) {
	const [rs] = await sql`select id from resellers where id = ${resellerId} and tenant_id = ${tenantId}`;
	if (!rs) throw new Error("Reseller not found");
	await sql`update customers set reseller_id = ${rs.id} where id = ${customerId} and tenant_id = ${tenantId}`;
}
//#endregion
export { redeemLoyalty as i, awardLoyalty as n, creditReseller as r, attachCustomerReseller as t };

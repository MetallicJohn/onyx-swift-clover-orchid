import { E as restoreCustomerAccess, j as syncRadiusAccount, p as enqueueServiceCommand, x as on } from "./rls-stkZtAMF.mjs";
import { i as writeInbox } from "./inbox-C11LOMfj.mjs";
import { r as notifyCustomerEvent } from "./notifications-NHmcUGyA.mjs";
import { n as awardLoyalty, r as creditReseller } from "./resellers-D82O6Apv.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/subscribers-BRhTNJh1.js
function normalizePhone(raw) {
	const digits = (raw || "").replace(/\D/g, "");
	if (digits.length === 9 && digits.startsWith("7")) return `254${digits}`;
	if (digits.length === 10 && digits.startsWith("0")) return `254${digits.slice(1)}`;
	if (digits.startsWith("254") && digits.length >= 12) return digits.slice(0, 12);
	return digits;
}
async function convertReferral(sql, tenantId, phone) {
	const p = normalizePhone(phone);
	if (!p) return null;
	const found = (await sql`
    select id, referrer_id, points, referee_phone from referrals
    where tenant_id = ${tenantId} and status = 'pending'`).find((r) => normalizePhone(r.referee_phone) === p);
	if (!found) return null;
	await sql`update referrals set status = 'converted' where id = ${found.id}`;
	await awardLoyalty(sql, tenantId, found.referrer_id, found.points * 10, "referral", found.id);
	return found;
}
var wired = false;
function wireModules() {
	if (wired) return;
	wired = true;
	on("payment.confirmed", async (sql, event) => {
		const p = event.payload;
		const tenantId = event.tenantId;
		const customerId = String(p.customer_id || "");
		const ispName = String(p.isp_name || "");
		const payId = String(p.payment_id || "");
		const amount = Number(p.amount_kes || 0);
		await restoreCustomerAccess(sql, tenantId, customerId);
		await awardLoyalty(sql, tenantId, customerId, amount, "payment", payId);
		try {
			await creditReseller(sql, tenantId, customerId, amount, payId);
		} catch {}
		try {
			await notifyCustomerEvent(sql, tenantId, ispName, customerId, "payment.received", payId, {
				customer_name: "",
				invoice_number: String(p.invoice_number || ""),
				amount: `KES ${amount}`,
				payment_reference: String(p.reference || "")
			});
			await notifyCustomerEvent(sql, tenantId, ispName, customerId, "service.restored", `${payId}-restore`, {
				customer_name: "",
				payment_reference: String(p.reference || ""),
				service_name: "Internet"
			});
		} catch {}
	});
	on("service.changed", async (sql, event) => {
		const p = event.payload;
		const service = {
			id: String(p.id || ""),
			access_method: String(p.access_method || ""),
			username: p.username ? String(p.username) : null,
			static_ip: p.static_ip ? String(p.static_ip) : null,
			status: String(p.status || ""),
			package_name: String(p.package_name || ""),
			download_mbps: Number(p.download_mbps || 10),
			upload_mbps: Number(p.upload_mbps || 10),
			password: p.password ? String(p.password) : void 0
		};
		const radius = await syncRadiusAccount(sql, event.tenantId, service);
		await enqueueServiceCommand(sql, event.tenantId, {
			...service,
			username: radius.username,
			password: service.password || radius.password
		});
	});
	on("ticket.created", async (sql, event) => {
		const cid = String(event.payload.customer_id || "");
		if (!cid) return;
		try {
			await writeInbox(sql, event.tenantId, cid, "Support ticket opened", String(event.payload.title || "A ticket was opened on your account"), "ticket.created");
		} catch {}
	});
	on("customer.created", async (sql, event) => {
		try {
			await convertReferral(sql, event.tenantId, String(event.payload.phone || ""));
		} catch {}
	});
}
//#endregion
export { wireModules };

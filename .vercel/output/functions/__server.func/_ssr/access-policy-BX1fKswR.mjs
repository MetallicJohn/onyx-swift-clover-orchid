import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { M as nid, a as emit, f as provisionServiceAccess, k as intervalDays, o as enqueueAgentCommand } from "./access-1saCIo2_.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/access-policy-BX1fKswR.js
var access_policy_BX1fKswR_exports = /* @__PURE__ */ __exportAll({
	a: () => activateVoucher,
	c: () => revokeVoucher,
	i: () => restorePaidAccess,
	n: () => maybeRunAccessPolicy,
	o: () => expireDueVouchers,
	r: () => recordAccounting,
	s: () => generateVouchers,
	t: () => access_policy_exports
});
function activateVoucherClock(hours, now = /* @__PURE__ */ new Date()) {
	return {
		status: "active",
		used_at: now,
		expires_at: new Date(now.getTime() + Math.max(1, hours) * 36e5)
	};
}
function nextVoucherStatus(status, expiresAt, now = /* @__PURE__ */ new Date()) {
	if (status === "cancelled") return "cancelled";
	if (status === "unused") return "unused";
	if (status === "active" && expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
	return status;
}
function canActivate(status) {
	return status === "unused";
}
function canRevoke(status) {
	return status === "unused" || status === "active";
}
async function walkInCustomer(sql, tenantId) {
	const [c] = await sql`
    select id from customers where tenant_id = ${tenantId} and name = 'Hotspot walk-in'`;
	if (c) return c.id;
	const id = nid("cus");
	await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
    values (${id}, ${tenantId}, 'individual', 'Hotspot walk-in', '', '', '', 'active')`;
	return id;
}
async function generateVouchers(sql, tenantId, packageId, count, hours) {
	const [pkg] = await sql`
    select id from packages where id = ${packageId} and tenant_id = ${tenantId} and access_method = 'hotspot'`;
	if (!pkg) throw new Error("Hotspot package not found");
	const n = Math.min(Math.max(count, 1), 50);
	const codes = [];
	for (let i = 0; i < n; i += 1) {
		const code = `HS-${crypto.randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`;
		await sql`insert into hotspot_vouchers (id, tenant_id, package_id, code, hours, status)
      values (${nid("vch")}, ${tenantId}, ${pkg.id}, ${code}, ${hours || 24}, 'unused')`;
		codes.push(code);
	}
	return { codes };
}
async function expireDueVouchers(sql, tenantId) {
	const due = await sql`
    select id, service_id, code, status, expires_at::text as expires_at from hotspot_vouchers
    where tenant_id = ${tenantId} and status = 'active'`;
	let n = 0;
	for (const v of due) {
		if (nextVoucherStatus("active", v.expires_at ? new Date(v.expires_at) : null) !== "expired") continue;
		await sql`update hotspot_vouchers set status = 'expired' where id = ${v.id}`;
		if (v.service_id) {
			await sql`update services set status = 'terminated' where id = ${v.service_id} and tenant_id = ${tenantId}`;
			await emit(sql, {
				type: "service.changed",
				tenantId,
				payload: {
					id: v.service_id,
					access_method: "hotspot",
					username: v.code,
					static_ip: null,
					status: "terminated"
				}
			});
		}
		n += 1;
	}
	return { expired: n };
}
async function activateVoucher(sql, tenantId, voucherId, customerId) {
	const [v] = await sql`select id, code, hours, status, package_id from hotspot_vouchers
     where id = ${voucherId} and tenant_id = ${tenantId}`;
	if (!v) throw new Error("Voucher not found");
	if (!canActivate(v.status)) throw new Error("Voucher is not unused");
	const cid = customerId || await walkInCustomer(sql, tenantId);
	const clock = activateVoucherClock(v.hours);
	const serviceId = nid("svc");
	await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
    values (${serviceId}, ${tenantId}, ${cid}, ${v.package_id}, 'hotspot', ${v.code}, null, 'active', ${clock.expires_at.toISOString()})`;
	await sql`update hotspot_vouchers
    set status = 'active', used_at = ${clock.used_at.toISOString()}, expires_at = ${clock.expires_at.toISOString()},
        service_id = ${serviceId}, customer_id = ${cid}
    where id = ${v.id}`;
	await emit(sql, {
		type: "service.changed",
		tenantId,
		payload: {
			id: serviceId,
			access_method: "hotspot",
			username: v.code,
			static_ip: null,
			status: "active"
		}
	});
	return {
		code: v.code,
		expires_at: clock.expires_at.toISOString(),
		service_id: serviceId
	};
}
async function revokeVoucher(sql, tenantId, voucherId) {
	const [v] = await sql`
    select id, status, service_id, code from hotspot_vouchers where id = ${voucherId} and tenant_id = ${tenantId}`;
	if (!v) throw new Error("Voucher not found");
	if (!canRevoke(v.status)) throw new Error("Voucher cannot be revoked");
	await sql`update hotspot_vouchers set status = 'cancelled' where id = ${v.id}`;
	if (v.service_id) {
		await sql`update services set status = 'terminated' where id = ${v.service_id} and tenant_id = ${tenantId}`;
		await emit(sql, {
			type: "service.changed",
			tenantId,
			payload: {
				id: v.service_id,
				access_method: "hotspot",
				username: v.code,
				static_ip: null,
				status: "terminated"
			}
		});
	} else await enqueueAgentCommand(sql, tenantId, "hotspot.disable", {
		username: v.code,
		status: "terminated"
	});
	return { ok: true };
}
var access_policy_exports = /* @__PURE__ */ __exportAll$1({
	applyAccessPolicy: () => applyAccessPolicy,
	bundleExhausted: () => bundleExhausted,
	customerHasOverdue: () => customerHasOverdue,
	extendPeriodEnd: () => extendPeriodEnd,
	grantPaidPeriod: () => grantPaidPeriod,
	maybeRunAccessPolicy: () => maybeRunAccessPolicy,
	periodMs: () => periodMs,
	recordAccounting: () => recordAccounting,
	restorePaidAccess: () => restorePaidAccess,
	usedMbFromBytes: () => usedMbFromBytes
});
function periodMs(billingInterval, validityHours = 0) {
	if (validityHours > 0) return validityHours * 36e5;
	return intervalDays(billingInterval) * 864e5;
}
function extendPeriodEnd(current, now, durationMs) {
	const cur = current ? new Date(current) : null;
	const valid = cur && !Number.isNaN(cur.getTime()) ? cur : null;
	const base = valid && valid.getTime() > now.getTime() ? valid : now;
	return new Date(base.getTime() + durationMs);
}
function bundleExhausted(usedMb, bundleMb) {
	return bundleMb > 0 && usedMb >= bundleMb;
}
function usedMbFromBytes(bytesIn, bytesOut) {
	return Math.max(0, Math.floor((Number(bytesIn) + Number(bytesOut)) / 1048576));
}
async function customerHasOverdue(sql, tenantId, customerId, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
	const rows = await sql`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${today}
    limit 1`;
	return Boolean(rows[0]);
}
async function notify(sql, tenantId, ispName, customerId, event, entityId, vars) {
	const { notifyCustomerEvent } = await import("./notifications-CBBMOK-P.mjs").then((n) => n.n);
	return notifyCustomerEvent(sql, tenantId, ispName, customerId, event, entityId, {
		customer_name: "",
		...vars
	});
}
async function setServiceState(sql, tenantId, serviceId, status, reason) {
	await sql`update services
    set status = ${status}, suspend_reason = ${reason}
    where id = ${serviceId} and tenant_id = ${tenantId}`;
	await provisionServiceAccess(sql, tenantId, serviceId);
}
async function grantPaidPeriod(sql, tenantId, customerId, now = /* @__PURE__ */ new Date()) {
	const svcs = await sql`select s.id, s.period_end::text as period_end, p.billing_interval, p.validity_hours
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}
       and s.status <> 'terminated'`;
	for (const s of svcs) await sql`update services
      set period_end = ${extendPeriodEnd(s.period_end, now, periodMs(s.billing_interval, s.validity_hours)).toISOString()}, bundle_used_mb = 0, suspend_reason = ''
      where id = ${s.id} and tenant_id = ${tenantId}`;
	return svcs.length;
}
async function restorePaidAccess(sql, tenantId, customerId) {
	await grantPaidPeriod(sql, tenantId, customerId);
	if (await customerHasOverdue(sql, tenantId, customerId)) return {
		restored: 0,
		held: true
	};
	const svcs = await sql`
    select id from services
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('grace','suspended','pending')`;
	await sql`update services set status = 'active', suspend_reason = ''
    where customer_id = ${customerId} and tenant_id = ${tenantId}
      and status in ('grace','suspended','pending')`;
	for (const s of svcs) await provisionServiceAccess(sql, tenantId, s.id);
	return {
		restored: svcs.length,
		held: false
	};
}
async function recordAccounting(sql, tenantId, input) {
	const username = input.username.trim();
	if (!username) throw new Error("username required");
	const [svc] = await sql`select s.id, s.status, s.bundle_used_mb, p.bundle_mb, s.access_method, s.static_ip,
            p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.username = ${username}
     order by s.created_at desc limit 1`;
	if (!svc) throw new Error("Unknown username");
	const bytesIn = Math.max(0, Number(input.bytes_in) || 0);
	const bytesOut = Math.max(0, Number(input.bytes_out) || 0);
	const sessionId = input.session_id?.trim() || nid("ses");
	const existing = await sql`
    select id, bytes_in, bytes_out from radius_sessions where tenant_id = ${tenantId} and id = ${sessionId}`;
	let addMb = 0;
	if (existing[0]) {
		addMb = usedMbFromBytes(Math.max(0, bytesIn - Number(existing[0].bytes_in)), Math.max(0, bytesOut - Number(existing[0].bytes_out)));
		await sql`update radius_sessions
      set bytes_in = ${bytesIn}, bytes_out = ${bytesOut}, nas_ip = ${input.nas_ip || ""}
      where id = ${sessionId} and tenant_id = ${tenantId}`;
	} else {
		addMb = usedMbFromBytes(bytesIn, bytesOut);
		await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values (${sessionId}, ${tenantId}, ${username}, ${svc.static_ip ?? ""}, ${input.nas_ip || ""}, ${bytesIn}, ${bytesOut})`;
	}
	const used = svc.bundle_used_mb + addMb;
	await sql`update services set bundle_used_mb = ${used} where id = ${svc.id} and tenant_id = ${tenantId}`;
	if (bundleExhausted(used, svc.bundle_mb) && (svc.status === "active" || svc.status === "grace")) {
		await setServiceState(sql, tenantId, svc.id, "suspended", "bundle");
		return {
			username,
			used_mb: used,
			bundle_mb: svc.bundle_mb,
			suspended: true,
			reason: "bundle"
		};
	}
	return {
		username,
		used_mb: used,
		bundle_mb: svc.bundle_mb,
		suspended: false,
		reason: ""
	};
}
async function applyAccessPolicy(sql, tenantId, ispName) {
	const vouchers = await expireDueVouchers(sql, tenantId);
	const invoices = await sql`select id, customer_id, number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and status in ('issued','due','overdue','partial')
       and amount_kes > paid_kes`;
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	let due = 0;
	let overdue = 0;
	let grace = 0;
	let suspended = 0;
	let time = 0;
	let bundle = 0;
	let notices = 0;
	for (const inv of invoices) {
		const vars = {
			invoice_number: inv.number,
			amount: `KES ${inv.amount_kes}`,
			due_date: inv.due_date
		};
		if (inv.due_date === today && inv.status === "issued") {
			await sql`update invoices set status = 'due' where id = ${inv.id} and tenant_id = ${tenantId}`;
			notices += await notify(sql, tenantId, ispName, inv.customer_id, "invoice.due", inv.id, vars);
			due += 1;
		}
		if (inv.due_date < today && inv.status !== "overdue" && inv.status !== "partial") {
			await sql`update invoices set status = 'overdue' where id = ${inv.id} and tenant_id = ${tenantId}`;
			notices += await notify(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
			overdue += 1;
		}
		if (inv.due_date >= today) continue;
		const daysPast = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 864e5);
		const services = await sql`select s.id, s.status, p.name, p.grace_days
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${tenantId} and s.customer_id = ${inv.customer_id} and s.status in ('active','grace')`;
		for (const svc of services) {
			const svcVars = {
				...vars,
				service_name: svc.name
			};
			if (daysPast <= svc.grace_days && svc.status === "active") {
				await setServiceState(sql, tenantId, svc.id, "grace", "invoice");
				notices += await notify(sql, tenantId, ispName, inv.customer_id, "grace.started", svc.id, svcVars);
				grace += 1;
			} else if (daysPast > svc.grace_days && svc.status !== "suspended") {
				await setServiceState(sql, tenantId, svc.id, "suspended", "invoice");
				notices += await notify(sql, tenantId, ispName, inv.customer_id, "service.suspended", svc.id, svcVars);
				suspended += 1;
			}
		}
	}
	const timed = await sql`select s.id, s.customer_id, s.status, p.name, p.grace_days, s.period_end::text as period_end
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId}
       and s.status in ('active','grace')
       and s.period_end is not null
       and s.period_end <= now()`;
	for (const svc of timed) {
		const end = Date.parse(svc.period_end);
		const graceMs = Math.max(0, svc.grace_days) * 864e5;
		const pastGrace = Date.now() > end + graceMs;
		if (!pastGrace && svc.status === "active" && svc.grace_days > 0) {
			await setServiceState(sql, tenantId, svc.id, "grace", "time");
			notices += await notify(sql, tenantId, ispName, svc.customer_id, "grace.started", svc.id, { service_name: svc.name });
			grace += 1;
			time += 1;
		} else if (pastGrace) {
			await setServiceState(sql, tenantId, svc.id, "suspended", "time");
			notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.suspended", svc.id, { service_name: svc.name });
			suspended += 1;
			time += 1;
		}
	}
	const capped = await sql`
    select s.id, s.customer_id, p.name
    from services s join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId}
      and s.status in ('active','grace')
      and p.bundle_mb > 0
      and s.bundle_used_mb >= p.bundle_mb`;
	for (const svc of capped) {
		await setServiceState(sql, tenantId, svc.id, "suspended", "bundle");
		notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.suspended", svc.id, { service_name: svc.name });
		suspended += 1;
		bundle += 1;
	}
	return {
		due,
		overdue,
		grace,
		suspended,
		time,
		bundle,
		notices,
		vouchers: vouchers.expired
	};
}
async function maybeRunAccessPolicy(sql, tenantId, tenantName) {
	try {
		if (!(await sql`
      update tenants set access_policy_ran_at = now()
      where id = ${tenantId}
        and (access_policy_ran_at is null or access_policy_ran_at < now() - interval '2 minutes')
      returning id`)[0]) return { ran: false };
		return {
			ran: true,
			...await applyAccessPolicy(sql, tenantId, tenantName)
		};
	} catch {
		return { ran: false };
	}
}
//#endregion
export { maybeRunAccessPolicy as a, revokeVoucher as c, generateVouchers as i, activateVoucher as n, recordAccounting as o, expireDueVouchers as r, restorePaidAccess as s, access_policy_BX1fKswR_exports as t };

import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { M as nid } from "./access-1saCIo2_.mjs";
import { r as stkAdapter } from "./providers-BmmJQ_JG.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/saas-CKrgrfcA.js
var saas_CKrgrfcA_exports = /* @__PURE__ */ __exportAll({
	a: () => requestPlanChange,
	i: () => loadPlanDesk,
	n: () => assertCustomerQuota,
	o: () => saas_exports,
	r: () => createSaasStkIntent,
	t: () => applySaasPayment
});
var saas_exports = /* @__PURE__ */ __exportAll$1({
	PLANS: () => PLANS,
	activatePlan: () => activatePlan,
	applySaasPayment: () => applySaasPayment,
	assertCustomerQuota: () => assertCustomerQuota,
	createSaasStkIntent: () => createSaasStkIntent,
	ensureSubscription: () => ensureSubscription,
	listSaasInvoices: () => listSaasInvoices,
	loadPlanDesk: () => loadPlanDesk,
	requestPlanChange: () => requestPlanChange,
	settleSaasStkIntent: () => settleSaasStkIntent
});
var PLANS = {
	trial: {
		label: "Trial",
		blurb: "14 days to onboard your first sites.",
		max_customers: 50,
		max_routers: 5,
		monthly_kes: 0
	},
	starter: {
		label: "Starter",
		blurb: "Single-POP operators and neighbourhood ISPs.",
		max_customers: 500,
		max_routers: 20,
		monthly_kes: 4999
	},
	growth: {
		label: "Growth",
		blurb: "Multi-POP with room to scale.",
		max_customers: 5e3,
		max_routers: 100,
		monthly_kes: 14999
	}
};
function daysLeft(periodEnd, now = /* @__PURE__ */ new Date()) {
	if (!periodEnd) return 0;
	const end = new Date(periodEnd);
	if (Number.isNaN(end.getTime())) return 0;
	return Math.ceil((end.getTime() - now.getTime()) / 864e5);
}
function asSnapshot(row) {
	const left = daysLeft(row.period_end);
	return {
		id: row.id,
		plan: row.plan,
		status: row.status,
		max_customers: row.max_customers,
		max_routers: row.max_routers,
		monthly_kes: row.monthly_kes,
		period_end: row.period_end,
		pending_plan: row.pending_plan ?? "",
		pending_invoice_id: row.pending_invoice_id ?? "",
		days_left: Math.max(0, left),
		trial_expired: row.plan === "trial" && left < 0
	};
}
async function ensureSubscription(sql, tenantId) {
	const [row] = await sql`select id, plan, status, max_customers, max_routers, monthly_kes, period_end::text as period_end,
            pending_plan, pending_invoice_id
     from tenant_subscriptions where tenant_id = ${tenantId}`;
	if (row) return asSnapshot(row);
	const spec = PLANS.trial;
	const end = new Date(Date.now() + 12096e5);
	const id = nid("sub");
	await sql`insert into tenant_subscriptions (id, tenant_id, plan, status, max_customers, max_routers, monthly_kes, period_end)
    values (${id}, ${tenantId}, 'trial', 'trial', ${spec.max_customers}, ${spec.max_routers}, ${spec.monthly_kes}, ${end.toISOString()})`;
	return asSnapshot({
		id,
		plan: "trial",
		status: "trial",
		...spec,
		period_end: end.toISOString(),
		pending_plan: "",
		pending_invoice_id: ""
	});
}
async function activatePlan(sql, tenantId, plan) {
	const spec = PLANS[plan];
	if (!spec) throw new Error("Unknown plan");
	await ensureSubscription(sql, tenantId);
	const end = new Date(Date.now() + (plan === "trial" ? 14 : 30) * 864e5);
	await sql`update tenant_subscriptions
    set plan = ${plan}, status = ${plan === "trial" ? "trial" : "active"}, max_customers = ${spec.max_customers}, max_routers = ${spec.max_routers},
        monthly_kes = ${spec.monthly_kes}, period_end = ${end.toISOString()},
        pending_plan = '', pending_invoice_id = ''
    where tenant_id = ${tenantId}`;
	return ensureSubscription(sql, tenantId);
}
async function voidOpenSaasInvoice(sql, tenantId, invoiceId) {
	if (!invoiceId) return;
	await sql`update saas_invoices set status = 'void'
    where id = ${invoiceId} and tenant_id = ${tenantId} and status in ('issued','due','overdue')`;
}
async function issueSaasInvoice(sql, tenantId, plan) {
	const spec = PLANS[plan];
	const [{ n }] = await sql`select count(*)::int as n from saas_invoices where tenant_id = ${tenantId}`;
	const number = `SUB-${String(1e3 + (n ?? 0) + 1)}`;
	const id = nid("sinv");
	const due = /* @__PURE__ */ new Date();
	due.setDate(due.getDate() + 7);
	const periodStart = /* @__PURE__ */ new Date();
	const periodEnd = new Date(Date.now() + 2592e6);
	await sql`insert into saas_invoices
    (id, tenant_id, number, plan, amount_kes, status, due_date, period_start, period_end)
    values (
      ${id}, ${tenantId}, ${number}, ${plan}, ${spec.monthly_kes}, 'issued', ${due.toISOString().slice(0, 10)},
      ${periodStart.toISOString()}, ${periodEnd.toISOString()}
    )`;
	return {
		id,
		number,
		plan,
		amount_kes: spec.monthly_kes,
		status: "issued",
		due_date: due.toISOString().slice(0, 10),
		issued_at: (/* @__PURE__ */ new Date()).toISOString(),
		period_end: periodEnd.toISOString()
	};
}
async function listSaasInvoices(sql, tenantId) {
	return sql`
    select id, number, plan, amount_kes, status, due_date::text as due_date,
           issued_at::text as issued_at, period_end::text as period_end
    from saas_invoices where tenant_id = ${tenantId}
    order by issued_at desc`;
}
async function requestPlanChange(sql, tenantId, plan) {
	if (!PLANS[plan]) throw new Error("Unknown plan");
	const sub = await ensureSubscription(sql, tenantId);
	if (plan === "trial") {
		if (sub.pending_invoice_id) await voidOpenSaasInvoice(sql, tenantId, sub.pending_invoice_id);
		if (sub.plan === "trial" && !sub.pending_plan) return {
			...sub,
			invoice: null,
			invoices: await listSaasInvoices(sql, tenantId)
		};
		return {
			...await activatePlan(sql, tenantId, "trial"),
			invoice: null,
			invoices: await listSaasInvoices(sql, tenantId)
		};
	}
	if (sub.plan === plan && sub.status === "active" && !sub.pending_plan) return {
		...sub,
		invoice: null,
		invoices: await listSaasInvoices(sql, tenantId),
		unchanged: true
	};
	if (sub.pending_plan === plan && sub.pending_invoice_id) {
		const [existing] = await sql`
      select id, number, plan, amount_kes, status, due_date::text as due_date,
             issued_at::text as issued_at, period_end::text as period_end
      from saas_invoices where id = ${sub.pending_invoice_id} and tenant_id = ${tenantId}
        and status in ('issued','due','overdue')`;
		if (existing) return {
			...sub,
			invoice: existing,
			invoices: await listSaasInvoices(sql, tenantId)
		};
	}
	if (sub.pending_invoice_id) await voidOpenSaasInvoice(sql, tenantId, sub.pending_invoice_id);
	const invoice = await issueSaasInvoice(sql, tenantId, plan);
	await sql`update tenant_subscriptions
    set pending_plan = ${plan}, pending_invoice_id = ${invoice.id}
    where tenant_id = ${tenantId}`;
	return {
		...await ensureSubscription(sql, tenantId),
		invoice,
		invoices: await listSaasInvoices(sql, tenantId)
	};
}
async function applySaasPayment(sql, opts) {
	const ref = opts.reference.trim();
	if (!ref) throw new Error("Payment reference is required");
	const [inv] = await sql`select id, plan, amount_kes, status, number from saas_invoices
     where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Platform invoice not found");
	if (inv.status === "paid") throw new Error("Invoice already paid");
	if (inv.status === "void") throw new Error("Invoice was cancelled");
	if ((await sql`select id from saas_payments where tenant_id = ${opts.tenantId} and reference = ${ref}`)[0]) throw new Error("Duplicate payment reference");
	const amount = Math.round(opts.amountKes ?? inv.amount_kes);
	if (amount !== inv.amount_kes) throw new Error("Platform invoices must be paid in full");
	const payId = nid("spay");
	await sql`insert into saas_payments (id, tenant_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${inv.id}, ${opts.provider || "mpesa"}, ${amount}, ${ref}, 'confirmed')`;
	await sql`update saas_invoices set status = 'paid', paid_at = now()
    where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
	const plan = inv.plan;
	if (!PLANS[plan]) throw new Error("Unknown plan on invoice");
	const next = await activatePlan(sql, opts.tenantId, plan);
	return {
		id: payId,
		amount,
		plan: next.plan,
		status: next.status,
		period_end: next.period_end
	};
}
async function createSaasStkIntent(sql, opts) {
	const [inv] = await sql`
    select id, amount_kes, status, number, plan from saas_invoices
    where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Platform invoice not found");
	if (inv.status === "paid") throw new Error("Invoice already paid");
	if (inv.status === "void") throw new Error("Invoice was cancelled");
	const [prov] = await sql`
    select enabled from payment_providers where tenant_id = ${opts.tenantId} and kind = ${opts.provider}`;
	if (prov && !prov.enabled) throw new Error("Provider disabled");
	const [ten] = await sql`
    select name, slug, public_base_url, support_phone from tenants where id = ${opts.tenantId}`;
	const phone = ten?.support_phone ?? "";
	if (!phone.replace(/\D/g, "")) throw new Error("Set a company phone in Settings → Company to receive the STK prompt");
	const origin = (ten?.public_base_url || "").replace(/\/$/, "");
	const callbackUrl = origin && ten?.slug ? `${origin}/api/webhooks/${opts.provider}/${ten.slug}` : "";
	let checkout = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
	let note = "queued";
	const adapter = stkAdapter(opts.provider);
	if (adapter) {
		const started = await adapter.start(sql, {
			tenantId: opts.tenantId,
			phone,
			amount: inv.amount_kes,
			invoiceId: inv.id,
			invoiceNumber: inv.number,
			firstName: ten?.name || "Gridline",
			lastName: "Plan",
			callbackUrl
		});
		if (started.checkout_id) checkout = started.checkout_id;
		note = started.note;
	}
	const id = nid("sint");
	await sql`insert into saas_payment_intents (id, tenant_id, invoice_id, provider, amount_kes, phone, checkout_id, status)
    values (${id}, ${opts.tenantId}, ${inv.id}, ${opts.provider}, ${inv.amount_kes}, ${phone}, ${checkout}, 'pending')`;
	return {
		id,
		checkout_id: checkout,
		phone,
		amount_kes: inv.amount_kes,
		note,
		invoice_number: inv.number
	};
}
async function settleSaasStkIntent(sql, opts) {
	const [intent] = await sql`select id, invoice_id, provider, status, checkout_id, amount_kes from saas_payment_intents
     where checkout_id = ${opts.checkoutId} and tenant_id = ${opts.tenantId}`;
	if (!intent) throw new Error("STK request not found");
	if (intent.status === "confirmed") throw new Error("Already confirmed");
	let reference = intent.checkout_id;
	const [prov] = await sql`
    select sandbox from payment_providers where tenant_id = ${opts.tenantId} and kind = ${intent.provider}`;
	const simulated = intent.checkout_id.startsWith("ws_");
	if (simulated && prov && !prov.sandbox) throw new Error("Cannot confirm a simulated STK on a live provider. Wait for the Daraja/Kopo Kopo callback.");
	const adapter = stkAdapter(intent.provider);
	if (adapter && !simulated) {
		const q = await adapter.query(sql, {
			tenantId: opts.tenantId,
			checkoutId: intent.checkout_id
		});
		if (!q.ok) throw new Error(q.error || "STK not confirmed by provider");
		if (q.reference) reference = q.reference;
	} else if (simulated && !prov?.sandbox) throw new Error("Cannot confirm a simulated STK on a live provider");
	const pay = await applySaasPayment(sql, {
		tenantId: opts.tenantId,
		invoiceId: intent.invoice_id,
		provider: intent.provider,
		reference,
		amountKes: intent.amount_kes
	});
	await sql`update saas_payment_intents set status = 'confirmed' where id = ${intent.id}`;
	return pay;
}
async function loadPlanDesk(sql, tenantId) {
	const current = await ensureSubscription(sql, tenantId);
	const invoices = await listSaasInvoices(sql, tenantId);
	const pending = current.pending_invoice_id ? invoices.find((i) => i.id === current.pending_invoice_id && i.status !== "paid" && i.status !== "void") ?? null : null;
	return {
		...current,
		catalog: Object.keys(PLANS).map((code) => ({
			code,
			...PLANS[code]
		})),
		invoice: pending,
		invoices
	};
}
async function assertCustomerQuota(sql, tenantId) {
	const sub = await ensureSubscription(sql, tenantId);
	const [n] = await sql`select count(*)::int as n from customers where tenant_id = ${tenantId}`;
	if ((n?.n ?? 0) >= sub.max_customers) throw new Error(`Plan ${sub.plan} allows ${sub.max_customers} customers. Upgrade in Settings → Plan.`);
}
//#endregion
export { requestPlanChange as a, loadPlanDesk as i, assertCustomerQuota as n, saas_CKrgrfcA_exports as o, createSaasStkIntent as r, applySaasPayment as t };

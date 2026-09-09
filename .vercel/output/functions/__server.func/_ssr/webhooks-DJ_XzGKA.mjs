import { M as nid, b as applyRls } from "./access-1saCIo2_.mjs";
import { t as applySaasPayment } from "./saas-CKrgrfcA.mjs";
import { t as applyConfirmedPayment } from "./payments-BFIx3bjI.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/webhooks-DJ_XzGKA.js
function asNumber(value) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const n = Number(value);
		if (Number.isFinite(n)) return n;
	}
}
function metaItem(body, name) {
	return (((body.Body?.stkCallback)?.CallbackMetadata)?.Item?.find((i) => i.Name === name))?.Value;
}
function parseMpesaCallback(body) {
	const stk = body.Body?.stkCallback;
	return {
		checkout: String(stk?.CheckoutRequestID || ""),
		resultCode: Number(stk?.ResultCode ?? -1),
		resultDesc: String(stk?.ResultDesc || ""),
		receipt: String(metaItem(body, "MpesaReceiptNumber") || ""),
		amount: asNumber(metaItem(body, "Amount")),
		phone: String(metaItem(body, "PhoneNumber") || "")
	};
}
function parseKopokopoCallback(body) {
	const data = body.data;
	const attrs = data?.attributes;
	const resource = (body.event || attrs?.event)?.resource || {};
	const status = String(attrs?.status || resource.status || "");
	const ok = /success|received/i.test(status);
	const amountRaw = resource.amount;
	const amount = typeof amountRaw === "object" && amountRaw ? asNumber(amountRaw.value) : asNumber(amountRaw);
	return {
		checkout: String(data?.id || body.id || resource.id || ""),
		resultCode: ok ? 0 : 1,
		resultDesc: status,
		receipt: String(resource.reference || ""),
		amount,
		phone: String(resource.sender_phone_number || resource.phone || "")
	};
}
function evaluateStkCallback(intent, parsed) {
	if (intent.status === "confirmed") return { action: "idempotent" };
	if (!parsed.checkout || parsed.checkout !== intent.checkout_id) return {
		action: "ignore",
		reason: "checkout mismatch"
	};
	if (parsed.resultCode !== 0) {
		const cancelled = parsed.resultCode === 1032;
		return {
			action: "fail",
			reason: parsed.resultDesc || `ResultCode ${parsed.resultCode}`,
			intentStatus: cancelled ? "cancelled" : "failed"
		};
	}
	if (parsed.amount != null && Math.round(parsed.amount) !== intent.amount_kes) return {
		action: "reconcile",
		reason: `amount mismatch callback=${parsed.amount} invoice=${intent.amount_kes}`
	};
	const reference = parsed.receipt.trim() || parsed.checkout;
	if (!reference) return {
		action: "reconcile",
		reason: "missing receipt"
	};
	return {
		action: "confirm",
		reference
	};
}
function callbackUrls(base, slug) {
	const root = (base || "").replace(/\/$/, "");
	if (!root || !slug) return {
		mpesa: "",
		kopokopo: ""
	};
	return {
		mpesa: `${root}/api/webhooks/mpesa/${encodeURIComponent(slug)}`,
		kopokopo: `${root}/api/webhooks/kopokopo/${encodeURIComponent(slug)}`
	};
}
async function tenantBySlug(sql, slug) {
	await applyRls(sql, { bypass: true });
	const [t] = await sql`
    select id, name, slug from tenants where slug = ${slug}`;
	if (t) await applyRls(sql, {
		tenantId: t.id,
		bypass: false
	});
	return t ?? null;
}
async function logWebhook(sql, tenantId, provider, checkoutId, payload, status) {
	await sql`insert into payment_webhooks (id, tenant_id, provider, checkout_id, payload, status)
    values (${nid("wh")}, ${tenantId}, ${provider}, ${checkoutId}, ${JSON.stringify(payload).slice(0, 8e3)}, ${status})`;
}
async function loadIntent(sql, tenantId, checkout) {
	const [intent] = await sql`select id, invoice_id, status, checkout_id, amount_kes from payment_intents
     where tenant_id = ${tenantId} and checkout_id = ${checkout}`;
	if (intent) return {
		...intent,
		kind: "customer"
	};
	const [saas] = await sql`select id, invoice_id, status, checkout_id, amount_kes from saas_payment_intents
     where tenant_id = ${tenantId} and checkout_id = ${checkout}`;
	if (saas) return {
		...saas,
		kind: "saas"
	};
	return null;
}
async function settleFromDecision(sql, tenant, provider, intent, parsed) {
	const decision = evaluateStkCallback(intent, parsed);
	if (decision.action === "idempotent") return "idempotent";
	if (decision.action === "ignore") return decision.reason;
	if (decision.action === "fail") {
		if (intent.kind === "saas") await sql`update saas_payment_intents set status = ${decision.intentStatus}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
		else await sql`update payment_intents set status = ${decision.intentStatus}, fail_reason = ${decision.reason}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
		return decision.intentStatus;
	}
	if (decision.action === "reconcile") {
		if (intent.kind === "saas") await sql`update saas_payment_intents set status = 'reconciliation_required'
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
		else await sql`update payment_intents set status = 'reconciliation_required', fail_reason = ${decision.reason}
        where id = ${intent.id} and tenant_id = ${tenant.id} and status = 'pending'`;
		return "reconciliation_required";
	}
	try {
		if (intent.kind === "saas") {
			await applySaasPayment(sql, {
				tenantId: tenant.id,
				invoiceId: intent.invoice_id,
				provider,
				reference: decision.reference,
				amountKes: intent.amount_kes
			});
			await sql`update saas_payment_intents set status = 'confirmed'
        where id = ${intent.id} and tenant_id = ${tenant.id}`;
		} else {
			await applyConfirmedPayment(sql, {
				tenantId: tenant.id,
				ispName: tenant.name,
				invoiceId: intent.invoice_id,
				provider,
				reference: decision.reference,
				amountKes: intent.amount_kes
			});
			await sql`update payment_intents set status = 'confirmed', fail_reason = ''
        where id = ${intent.id} and tenant_id = ${tenant.id}`;
		}
		return "confirmed";
	} catch (e) {
		const msg = e instanceof Error ? e.message : "confirm failed";
		if (/Duplicate/i.test(msg) || /already paid/i.test(msg)) {
			if (intent.kind === "saas") await sql`update saas_payment_intents set status = 'confirmed' where id = ${intent.id}`;
			else await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
			return "idempotent";
		}
		throw e;
	}
}
async function processMpesaCallback(sql, slug, body) {
	const tenant = await tenantBySlug(sql, slug);
	const parsed = parseMpesaCallback(body);
	if (!tenant) return {
		ResultCode: 0,
		ResultDesc: "Unknown tenant"
	};
	await logWebhook(sql, tenant.id, "mpesa", parsed.checkout, body, String(parsed.resultCode));
	if (!parsed.checkout) return {
		ResultCode: 0,
		ResultDesc: "Accepted"
	};
	const intent = await loadIntent(sql, tenant.id, parsed.checkout);
	if (!intent) return {
		ResultCode: 0,
		ResultDesc: "Unknown checkout"
	};
	return {
		ResultCode: 0,
		ResultDesc: await settleFromDecision(sql, tenant, "mpesa", intent, parsed)
	};
}
async function handleMpesaCallback(slug, body) {
	const { getSql } = await import("./db-Cj2MXHzY.mjs").then((n) => n.t).then((n) => n.t);
	return processMpesaCallback(await getSql(), slug, body);
}
async function handleKopokopoCallback(slug, body) {
	const { getSql } = await import("./db-Cj2MXHzY.mjs").then((n) => n.t).then((n) => n.t);
	const sql = await getSql();
	const tenant = await tenantBySlug(sql, slug);
	if (!tenant) return { ok: false };
	const parsed = parseKopokopoCallback(body);
	await logWebhook(sql, tenant.id, "kopokopo", parsed.checkout, body, parsed.resultDesc || "received");
	if (!parsed.checkout) return { ok: true };
	const intent = await loadIntent(sql, tenant.id, parsed.checkout) || (await sql`select id, invoice_id, status, checkout_id, amount_kes from payment_intents
         where tenant_id = ${tenant.id} and checkout_id like ${"%" + parsed.checkout} limit 1`)[0];
	if (!intent) return { ok: true };
	const loaded = "kind" in intent ? intent : {
		...intent,
		kind: "customer"
	};
	await settleFromDecision(sql, tenant, "kopokopo", loaded, {
		...parsed,
		checkout: loaded.checkout_id
	});
	return { ok: true };
}
async function tenantPayUrls(sql, tenantId, originFallback = "") {
	const [t] = await sql`
    select slug, public_base_url from tenants where id = ${tenantId}`;
	const base = (t?.public_base_url || originFallback).replace(/\/$/, "");
	return {
		slug: t?.slug ?? "",
		public_base_url: t?.public_base_url ?? "",
		...callbackUrls(base, t?.slug ?? "")
	};
}
//#endregion
export { handleMpesaCallback as n, tenantPayUrls as r, handleKopokopoCallback as t };

import { S as open, b as nid, d as emit, h as ensureOpsSchema } from "./rls-stkZtAMF.mjs";
import { i as loadKopo, n as kopoIncomingPayment, r as kopoPaymentStatus } from "./kopokopo-CXaTp8Cf.mjs";
import { n as recordLedger, t as allocatePayment } from "./ledger-IzxNvXf8.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/payments-D3oS_eip.js
function baseUrl(sandbox) {
	return sandbox ? "https://sandbox.safaricom.co.ke" : "https://api.safaricom.co.ke";
}
function nairobiStamp() {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone: "Africa/Nairobi",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hourCycle: "h23"
	}).formatToParts(/* @__PURE__ */ new Date());
	const g = (t) => parts.find((p) => p.type === t)?.value ?? "";
	return `${g("year")}${g("month")}${g("day")}${g("hour")}${g("minute")}${g("second")}`;
}
function msisdn254(phone) {
	const d = phone.replace(/\D/g, "");
	if (!d) return "";
	if (d.startsWith("254")) return d;
	if (d.startsWith("0") && d.length >= 10) return `254${d.slice(1)}`;
	if (d.length === 9) return `254${d}`;
	return d;
}
async function loadMpesa(sql, tenantId) {
	const row = (await sql`
    select client_id, client_secret, till_number, passkey, stk_type, sandbox, enabled
    from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`)[0];
	if (!row) return null;
	return {
		...row,
		client_secret: open(row.client_secret),
		passkey: open(row.passkey)
	};
}
function password(shortcode, passkey, timestamp) {
	return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}
async function mpesaAccessToken(cfg) {
	const basic = Buffer.from(`${cfg.client_id}:${cfg.client_secret}`).toString("base64");
	const res = await fetch(`${baseUrl(cfg.sandbox)}/oauth/v1/generate?grant_type=client_credentials`, { headers: {
		Authorization: `Basic ${basic}`,
		Accept: "application/json"
	} });
	const text = await res.text();
	if (!res.ok) throw new Error(`Daraja token ${res.status}: ${text.slice(0, 120)}`);
	const j = JSON.parse(text);
	if (!j.access_token) throw new Error("Daraja did not return an access token");
	return j.access_token;
}
async function mpesaStkPush(cfg, opts) {
	if (!cfg.till_number) throw new Error("Set the M-Pesa shortcode in Settings");
	if (!cfg.passkey) throw new Error("Set the Lipa Na M-Pesa passkey in Settings");
	const phone = msisdn254(opts.phone);
	if (!phone) throw new Error("Customer phone is required for M-Pesa STK");
	const ts = nairobiStamp();
	const token = await mpesaAccessToken(cfg);
	const buyGoods = cfg.stk_type === "till";
	const res = await fetch(`${baseUrl(cfg.sandbox)}/mpesa/stkpush/v1/processrequest`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			BusinessShortCode: cfg.till_number,
			Password: password(cfg.till_number, cfg.passkey, ts),
			Timestamp: ts,
			TransactionType: buyGoods ? "CustomerBuyGoodsOnline" : "CustomerPayBillOnline",
			Amount: opts.amount,
			PartyA: phone,
			PartyB: cfg.till_number,
			PhoneNumber: phone,
			CallBackURL: opts.callbackUrl || void 0,
			AccountReference: opts.account.slice(0, 12) || "BILL",
			TransactionDesc: opts.description.slice(0, 13) || "Internet"
		})
	});
	const text = await res.text();
	let j;
	try {
		j = JSON.parse(text);
	} catch {
		throw new Error(`Daraja STK ${res.status}: ${text.slice(0, 160)}`);
	}
	if (!res.ok || j.ResponseCode && j.ResponseCode !== "0") throw new Error(j.errorMessage || j.CustomerMessage || `Daraja STK ${res.status}`);
	if (!j.CheckoutRequestID) throw new Error("Daraja did not return CheckoutRequestID");
	return {
		checkout_id: j.CheckoutRequestID,
		merchant_id: j.MerchantRequestID ?? "",
		message: j.CustomerMessage ?? "STK push sent"
	};
}
async function mpesaStkQuery(cfg, checkoutRequestId) {
	const ts = nairobiStamp();
	const token = await mpesaAccessToken(cfg);
	const res = await fetch(`${baseUrl(cfg.sandbox)}/mpesa/stkpushquery/v1/query`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json"
		},
		body: JSON.stringify({
			BusinessShortCode: cfg.till_number,
			Password: password(cfg.till_number, cfg.passkey, ts),
			Timestamp: ts,
			CheckoutRequestID: checkoutRequestId
		})
	});
	const text = await res.text();
	const j = JSON.parse(text);
	if (!res.ok && !j.ResultCode) throw new Error(j.errorMessage || `Daraja query ${res.status}`);
	return {
		resultCode: j.ResultCode ?? "",
		resultDesc: j.ResultDesc ?? j.errorMessage ?? "",
		ok: j.ResultCode === "0"
	};
}
var adapters = /* @__PURE__ */ new Map();
function registerStk(adapter) {
	adapters.set(adapter.kind, adapter);
}
function stkAdapter(kind) {
	return adapters.get(kind) ?? null;
}
registerStk({
	kind: "mpesa",
	async start(sql, req) {
		const cfg = await loadMpesa(sql, req.tenantId);
		if (cfg && !cfg.enabled) throw new Error("M-Pesa is disabled");
		if (cfg && !cfg.sandbox && !req.callbackUrl) throw new Error("Set the public site URL in Settings — Daraja needs a callback URL");
		if (!cfg?.client_id || !cfg.client_secret || !cfg.passkey) return {
			checkout_id: "",
			note: "M-Pesa sandbox (no keys) — simulated STK"
		};
		try {
			const pushed = await mpesaStkPush(cfg, {
				phone: req.phone,
				amount: req.amount,
				account: req.invoiceNumber || "BILL",
				description: "Internet bill",
				callbackUrl: req.callbackUrl || void 0
			});
			return {
				checkout_id: pushed.checkout_id,
				note: pushed.message
			};
		} catch (e) {
			if (!cfg.sandbox) throw e;
			return {
				checkout_id: "",
				note: e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback"
			};
		}
	},
	async query(sql, opts) {
		if (opts.checkoutId.startsWith("ws_")) return {
			ok: true,
			reference: opts.checkoutId
		};
		const cfg = await loadMpesa(sql, opts.tenantId);
		if (!cfg?.client_id || !cfg.client_secret || !cfg.passkey) return {
			ok: true,
			reference: opts.checkoutId
		};
		const q = await mpesaStkQuery(cfg, opts.checkoutId);
		if (!q.ok) return {
			ok: false,
			error: q.resultDesc || `M-Pesa ResultCode ${q.resultCode}`
		};
		return {
			ok: true,
			reference: opts.checkoutId
		};
	}
});
registerStk({
	kind: "kopokopo",
	async start(sql, req) {
		const cfg = await loadKopo(sql, req.tenantId);
		if (!cfg || !cfg.enabled) throw new Error("Kopo Kopo is disabled");
		if (!cfg.sandbox && !req.callbackUrl) throw new Error("Set the public site URL in Settings — Kopo Kopo needs a callback URL");
		if (!cfg.client_id || !cfg.client_secret) return {
			checkout_id: "",
			note: "kopokopo sandbox (no keys) — simulated STK"
		};
		try {
			const pushed = await kopoIncomingPayment(cfg, {
				phone: req.phone,
				amount: req.amount,
				firstName: req.firstName,
				lastName: req.lastName,
				email: req.email,
				invoiceId: req.invoiceId,
				invoiceNumber: req.invoiceNumber,
				callbackUrl: req.callbackUrl || void 0
			});
			return {
				checkout_id: pushed.id || pushed.location,
				note: cfg.sandbox ? "kopokopo sandbox STK sent" : "kopokopo STK sent"
			};
		} catch (e) {
			if (!cfg.sandbox) throw e;
			return {
				checkout_id: "",
				note: e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback"
			};
		}
	},
	async query(sql, opts) {
		const cfg = await loadKopo(sql, opts.tenantId);
		if (!cfg?.client_id || !cfg.client_secret) return {
			ok: true,
			reference: opts.checkoutId
		};
		const st = await kopoPaymentStatus(cfg, opts.checkoutId);
		if (st.status && st.status !== "Success" && st.status !== "Received") return {
			ok: false,
			error: `Kopo Kopo status: ${st.status}`
		};
		return {
			ok: true,
			reference: st.reference || opts.checkoutId
		};
	}
});
async function applyConfirmedPayment(sql, opts) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const [inv] = await sql`select id, customer_id, amount_kes, number, status from invoices
     where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Invoice not found");
	const ref = opts.reference.trim();
	if (!ref) throw new Error("Payment reference is required");
	if ((await sql`select id from payments where tenant_id = ${opts.tenantId} and reference = ${ref}`)[0]) throw new Error("Duplicate payment reference");
	const payId = nid("pay");
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${inv.customer_id}, ${inv.id}, ${opts.provider || "mpesa"}, ${inv.amount_kes}, ${ref}, 'confirmed')`;
	await sql`update invoices set status = 'paid' where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
	try {
		await recordLedger(sql, {
			tenantId: opts.tenantId,
			customerId: inv.customer_id,
			entryType: "payment",
			creditKes: inv.amount_kes,
			refType: "payment",
			refId: payId,
			memo: `${opts.provider} ${ref}`
		});
		await allocatePayment(sql, {
			tenantId: opts.tenantId,
			paymentId: payId,
			invoiceId: inv.id,
			amountKes: inv.amount_kes
		});
	} catch {}
	await emit(sql, {
		type: "payment.confirmed",
		tenantId: opts.tenantId,
		payload: {
			payment_id: payId,
			customer_id: inv.customer_id,
			invoice_id: inv.id,
			invoice_number: inv.number,
			amount_kes: inv.amount_kes,
			reference: ref,
			provider: opts.provider,
			isp_name: opts.ispName
		}
	});
	return {
		id: payId,
		amount: inv.amount_kes
	};
}
async function createStkIntent(sql, opts) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const [inv] = await sql`
    select id, customer_id, amount_kes, status from invoices where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Invoice not found");
	if (inv.status === "paid") throw new Error("Invoice already paid");
	const [prov] = await sql`
    select enabled from payment_providers where tenant_id = ${opts.tenantId} and kind = ${opts.provider}`;
	if (prov && !prov.enabled) throw new Error("Provider disabled");
	const [cus] = await sql`
    select phone, name, email from customers where id = ${inv.customer_id}`;
	const [ten] = await sql`
    select slug, public_base_url from tenants where id = ${opts.tenantId}`;
	const origin = (ten?.public_base_url || "").replace(/\/$/, "");
	const callbackUrl = origin && ten?.slug ? `${origin}/api/webhooks/${opts.provider}/${ten.slug}` : "";
	let checkout = `ws_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
	let note = "queued";
	const adapter = stkAdapter(opts.provider);
	if (adapter) {
		const [invFull] = await sql`select number from invoices where id = ${inv.id}`;
		const parts = (cus?.name || "Customer").trim().split(/\s+/);
		const started = await adapter.start(sql, {
			tenantId: opts.tenantId,
			phone: cus?.phone ?? "",
			amount: inv.amount_kes,
			invoiceId: inv.id,
			invoiceNumber: invFull?.number || inv.id,
			firstName: parts[0] || "Customer",
			lastName: parts.slice(1).join(" ") || "Pay",
			email: cus?.email,
			callbackUrl
		});
		if (started.checkout_id) checkout = started.checkout_id;
		note = started.note;
	}
	const id = nid("int");
	await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, phone, checkout_id, status)
    values (${id}, ${opts.tenantId}, ${inv.id}, ${inv.customer_id}, ${opts.provider}, ${inv.amount_kes}, ${cus?.phone ?? ""}, ${checkout}, 'pending')`;
	return {
		id,
		checkout_id: checkout,
		phone: cus?.phone ?? "",
		amount_kes: inv.amount_kes,
		note
	};
}
async function settleStkIntent(sql, opts) {
	const [intent] = await sql`select id, invoice_id, provider, status, checkout_id from payment_intents
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
	const pay = await applyConfirmedPayment(sql, {
		tenantId: opts.tenantId,
		ispName: opts.ispName,
		invoiceId: intent.invoice_id,
		provider: intent.provider,
		reference
	});
	await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
	return pay;
}
//#endregion
export { settleStkIntent as a, mpesaAccessToken as i, createStkIntent as n, loadMpesa as r, applyConfirmedPayment as t };

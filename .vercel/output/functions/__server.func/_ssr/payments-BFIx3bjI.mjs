import { B as statusAfterPayment, F as remainingKes, M as nid, P as recordLedger, a as emit, l as ensureOpsSchema, y as allocatePayment } from "./access-1saCIo2_.mjs";
import { r as stkAdapter } from "./providers-BmmJQ_JG.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/payments-BFIx3bjI.js
async function applyConfirmedPayment(sql, opts) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const [inv] = await sql`select id, customer_id, amount_kes, paid_kes, number, status from invoices
     where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Invoice not found");
	const ref = opts.reference.trim();
	if (!ref) throw new Error("Payment reference is required");
	if ((await sql`select id from payments where tenant_id = ${opts.tenantId} and reference = ${ref}`)[0]) throw new Error("Duplicate payment reference");
	const remaining = remainingKes(inv.amount_kes, inv.paid_kes, inv.status);
	if (remaining <= 0) throw new Error("Invoice already paid");
	const amount = Math.min(Math.max(1, Math.round(opts.amountKes ?? remaining)), remaining);
	const paid = inv.paid_kes + amount;
	const status = statusAfterPayment(inv.amount_kes, paid, inv.status);
	const payId = nid("pay");
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${payId}, ${opts.tenantId}, ${inv.customer_id}, ${inv.id}, ${opts.provider || "mpesa"}, ${amount}, ${ref}, 'confirmed')`;
	await sql`update invoices set status = ${status}, paid_kes = ${paid} where id = ${inv.id} and tenant_id = ${opts.tenantId}`;
	try {
		await recordLedger(sql, {
			tenantId: opts.tenantId,
			customerId: inv.customer_id,
			entryType: "payment",
			creditKes: amount,
			refType: "payment",
			refId: payId,
			memo: `${opts.provider} ${ref}`
		});
		await allocatePayment(sql, {
			tenantId: opts.tenantId,
			paymentId: payId,
			invoiceId: inv.id,
			amountKes: amount
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
			amount_kes: amount,
			remaining_kes: remainingKes(inv.amount_kes, paid, status),
			invoice_paid: status === "paid",
			reference: ref,
			provider: opts.provider,
			isp_name: opts.ispName
		}
	});
	return {
		id: payId,
		amount,
		status,
		remaining_kes: remainingKes(inv.amount_kes, paid, status)
	};
}
async function createStkIntent(sql, opts) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const [inv] = await sql`
    select id, customer_id, amount_kes, paid_kes, status from invoices where id = ${opts.invoiceId} and tenant_id = ${opts.tenantId}`;
	if (!inv) throw new Error("Invoice not found");
	const remaining = remainingKes(inv.amount_kes, inv.paid_kes, inv.status);
	if (remaining <= 0) throw new Error("Invoice already paid");
	const amount = Math.min(Math.max(1, Math.round(opts.amountKes ?? remaining)), remaining);
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
			amount,
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
    values (${id}, ${opts.tenantId}, ${inv.id}, ${inv.customer_id}, ${opts.provider}, ${amount}, ${cus?.phone ?? ""}, ${checkout}, 'pending')`;
	return {
		id,
		checkout_id: checkout,
		phone: cus?.phone ?? "",
		amount_kes: amount,
		note
	};
}
async function settleStkIntent(sql, opts) {
	const [intent] = await sql`select id, invoice_id, provider, status, checkout_id, amount_kes from payment_intents
     where checkout_id = ${opts.checkoutId} and tenant_id = ${opts.tenantId}`;
	if (intent) {
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
			reference,
			amountKes: intent.amount_kes
		});
		await sql`update payment_intents set status = 'confirmed' where id = ${intent.id}`;
		return pay;
	}
	const { settleSaasStkIntent } = await import("./saas-CKrgrfcA.mjs").then((n) => n.o).then((n) => n.o);
	return settleSaasStkIntent(sql, opts);
}
//#endregion
export { createStkIntent as n, settleStkIntent as r, applyConfirmedPayment as t };

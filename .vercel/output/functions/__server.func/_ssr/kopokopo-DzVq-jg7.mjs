import { N as open } from "./access-1saCIo2_.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/kopokopo-DzVq-jg7.js
function baseUrl(sandbox) {
	return sandbox ? "https://sandbox.kopokopo.com" : "https://api.kopokopo.com";
}
function e164(phone) {
	const d = phone.replace(/\D/g, "");
	if (!d) return "";
	if (d.startsWith("254")) return `+${d}`;
	if (d.startsWith("0") && d.length >= 10) return `+254${d.slice(1)}`;
	if (d.length === 9) return `+254${d}`;
	return `+${d}`;
}
async function loadKopo(sql, tenantId) {
	const row = (await sql`
    select client_id, client_secret, till_number, sandbox, enabled
    from payment_providers where tenant_id = ${tenantId} and kind = 'kopokopo'`)[0];
	if (!row) return null;
	return {
		...row,
		client_secret: open(row.client_secret)
	};
}
async function kopoAccessToken(cfg) {
	const res = await fetch(`${baseUrl(cfg.sandbox)}/oauth/token`, {
		method: "POST",
		headers: {
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json"
		},
		body: new URLSearchParams({
			client_id: cfg.client_id,
			client_secret: cfg.client_secret,
			grant_type: "client_credentials"
		})
	});
	const text = await res.text();
	if (!res.ok) throw new Error(`Kopo Kopo token ${res.status}: ${text.slice(0, 120)}`);
	const j = JSON.parse(text);
	if (!j.access_token) throw new Error("Kopo Kopo did not return an access token");
	return j.access_token;
}
async function kopoIncomingPayment(cfg, opts) {
	const phone = e164(opts.phone);
	if (!phone) throw new Error("Customer phone is required for Kopo Kopo STK");
	if (!cfg.till_number) throw new Error("Set the Kopo Kopo till number in Settings");
	const token = await kopoAccessToken(cfg);
	const res = await fetch(`${baseUrl(cfg.sandbox)}/api/v2/incoming_payments`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			Accept: "application/json"
		},
		body: JSON.stringify({
			payment_channel: "M-PESA STK Push",
			till_number: cfg.till_number,
			subscriber: {
				first_name: opts.firstName || "Customer",
				last_name: opts.lastName || "Pay",
				phone_number: phone,
				...opts.email ? { email: opts.email } : {}
			},
			amount: {
				currency: "KES",
				value: opts.amount
			},
			metadata: {
				invoice_id: opts.invoiceId,
				reference: opts.invoiceNumber,
				notes: `Invoice ${opts.invoiceNumber}`
			},
			_links: { callback_url: opts.callbackUrl || "" }
		})
	});
	const location = res.headers.get("location") || res.headers.get("Location") || "";
	const text = await res.text();
	if (res.status !== 201 && !res.ok) throw new Error(`Kopo Kopo STK ${res.status}: ${text.slice(0, 160)}`);
	return {
		location,
		id: location.split("/").filter(Boolean).pop() || "",
		raw: text
	};
}
async function kopoPaymentStatus(cfg, locationOrId) {
	const token = await kopoAccessToken(cfg);
	const url = locationOrId.startsWith("http") ? locationOrId : `${baseUrl(cfg.sandbox)}/api/v2/incoming_payments/${locationOrId}`;
	const res = await fetch(url, { headers: {
		Authorization: `Bearer ${token}`,
		Accept: "application/json"
	} });
	const text = await res.text();
	if (!res.ok) throw new Error(`Kopo Kopo status ${res.status}: ${text.slice(0, 120)}`);
	const j = JSON.parse(text);
	return {
		status: j.data?.attributes?.status ?? "",
		reference: j.data?.attributes?.event?.resource?.reference ?? "",
		raw: j
	};
}
//#endregion
export { loadKopo as i, kopoIncomingPayment as n, kopoPaymentStatus as r, kopoAccessToken as t };

import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { n as clsx } from "../_libs/class-variance-authority+clsx.mjs";
import { t as twMerge } from "../_libs/tailwind-merge.mjs";
import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
//#region node_modules/.nitro/vite/services/ssr/assets/rls-D3aPKMQT.js
var rls_D3aPKMQT_exports = /* @__PURE__ */ __exportAll({
	C: () => nid,
	S: () => kes,
	_: () => webfamBalance,
	a: () => issueInvoice,
	b: () => seal,
	c: () => allocatePayment,
	d: () => deliverChannel,
	f: () => deliverSms,
	g: () => toPublic,
	h: () => saveMessagingSettings,
	i: () => intervalDays,
	l: () => recordLedger,
	m: () => getMessagingSettings,
	n: () => rls_exports,
	o: () => remainingKes,
	p: () => deliverWhatsapp,
	r: () => generateRecurringInvoices,
	s: () => statusAfterPayment,
	t: () => applyRls,
	u: () => channelAllowed,
	v: () => hint$1,
	w: () => slugify,
	x: () => cn,
	y: () => open
});
function cn(...inputs) {
	return twMerge(clsx(inputs));
}
function kes(amount) {
	return new Intl.NumberFormat("en-KE", {
		style: "currency",
		currency: "KES",
		maximumFractionDigits: 0
	}).format(amount);
}
function nid(prefix) {
	return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
function slugify(value) {
	return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "isp";
}
var PREFIX = "enc:v1:";
function configuredSecret() {
	return (process.env.APP_SECRET || process.env.BETTER_AUTH_SECRET || "").trim() || "";
}
function keyBytes() {
	const configured = configuredSecret();
	if (configured) return createHash("sha256").update(configured).digest();
	Boolean(process.env.DATABASE_URL?.trim());
	throw new Error("APP_SECRET or BETTER_AUTH_SECRET is required");
}
function seal(plain) {
	if (!plain) return "";
	if (plain.startsWith(PREFIX)) return plain;
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
	const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return PREFIX + Buffer.concat([
		iv,
		tag,
		enc
	]).toString("base64");
}
function open(stored) {
	if (!stored) return "";
	if (!stored.startsWith(PREFIX)) return stored;
	const raw = Buffer.from(stored.slice(7), "base64");
	const iv = raw.subarray(0, 12);
	const tag = raw.subarray(12, 28);
	const data = raw.subarray(28);
	const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}
function hint$1(stored) {
	const plain = open(stored);
	if (!plain) return "";
	if (plain.length <= 4) return "••••";
	return `••••${plain.slice(-4)}`;
}
var DEFAULTS = {
	payment_sms: true,
	payment_whatsapp: true,
	billing_sms: true,
	billing_whatsapp: false,
	sms_provider: "africastalking",
	sms_sender_id: "",
	sms_username: "",
	sms_api_key: "",
	sms_sandbox: true,
	wa_provider: "meta",
	wa_phone_id: "",
	wa_access_token: "",
	wa_business_id: "",
	wa_sandbox: true
};
async function ensureMessagingSchema(_sql) {}
async function getMessagingSettings(sql, tenantId) {
	await /* @__PURE__ */ ensureMessagingSchema(sql);
	const rows = await sql`
    select payment_sms, payment_whatsapp, billing_sms, billing_whatsapp,
           sms_provider, sms_sender_id, sms_username, sms_api_key, sms_sandbox,
           wa_provider, wa_phone_id, wa_access_token, wa_business_id, wa_sandbox
    from messaging_settings where tenant_id = ${tenantId}`;
	if (rows[0]) return {
		...rows[0],
		sms_api_key: open(rows[0].sms_api_key),
		wa_access_token: open(rows[0].wa_access_token)
	};
	await sql`insert into messaging_settings (tenant_id) values (${tenantId})`;
	return { ...DEFAULTS };
}
function hint(secret) {
	if (!secret) return "";
	return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
function toPublic(s) {
	return {
		payment_sms: s.payment_sms,
		payment_whatsapp: s.payment_whatsapp,
		billing_sms: s.billing_sms,
		billing_whatsapp: s.billing_whatsapp,
		sms_provider: s.sms_provider,
		sms_sender_id: s.sms_sender_id,
		sms_username: s.sms_username,
		sms_sandbox: s.sms_sandbox,
		wa_provider: s.wa_provider,
		wa_phone_id: s.wa_phone_id,
		wa_business_id: s.wa_business_id,
		wa_sandbox: s.wa_sandbox,
		sms_api_key_set: Boolean(s.sms_api_key),
		sms_api_key_hint: hint(s.sms_api_key),
		wa_token_set: Boolean(s.wa_access_token),
		wa_token_hint: hint(s.wa_access_token)
	};
}
function channelAllowed(event, channel, s) {
	if (channel === "in_app" || channel === "email") return true;
	const payment = event === "payment.received" || event === "service.restored";
	if (channel === "sms") return payment ? s.payment_sms : s.billing_sms;
	if (channel === "whatsapp") return payment ? s.payment_whatsapp : s.billing_whatsapp;
	return false;
}
function e164(phone) {
	const d = phone.replace(/\D/g, "");
	if (!d) return "";
	if (d.startsWith("254")) return `+${d}`;
	if (d.startsWith("0") && d.length >= 10) return `+254${d.slice(1)}`;
	if (d.length === 9) return `+254${d}`;
	return `+${d}`;
}
function keMobile(phone) {
	return e164(phone).replace("+", "");
}
async function postJson(url, body, headers = {}) {
	const res = await fetch(url, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
			...headers
		},
		body: JSON.stringify(body)
	});
	const text = await res.text();
	return {
		ok: res.ok,
		status: res.status,
		text
	};
}
async function sendHostpinnacle(host, settings, mobile, message) {
	return postJson(`${host.replace(/\/$/, "")}/api/services/sendsms/`, {
		apikey: settings.sms_api_key,
		partnerID: settings.sms_username,
		message,
		shortcode: settings.sms_sender_id,
		mobile
	});
}
async function sendTalksasaV3(base, settings, mobile, message) {
	return postJson(`${base.replace(/\/$/, "")}/sms/send`, {
		recipient: mobile.startsWith("+") ? mobile : `+${mobile}`,
		sender_id: settings.sms_sender_id,
		type: "plain",
		message
	}, { Authorization: `Bearer ${settings.sms_api_key}` });
}
async function sendWebfam(settings, mobile, message) {
	const body = {
		to: mobile,
		message
	};
	if (settings.sms_sender_id) body.sender_id = settings.sms_sender_id;
	return postJson("https://sms.webfam.co.ke/api/v1/sms/send", body, { Authorization: `Bearer ${settings.sms_api_key}` });
}
function webfamError(status, text) {
	try {
		const j = JSON.parse(text);
		if (j.error) return `Webfam ${status}: ${j.error}`;
		if (j.errors) return `Webfam ${status}: ${Object.values(j.errors).flat().join("; ")}`;
	} catch {}
	return `Webfam ${status} ${text.slice(0, 80)}`;
}
async function webfamBalance(settings) {
	if (!settings.sms_api_key) return {
		ok: false,
		detail: "No Webfam API key saved"
	};
	const res = await fetch("https://sms.webfam.co.ke/api/v1/account/balance", { headers: {
		Authorization: `Bearer ${settings.sms_api_key}`,
		Accept: "application/json"
	} });
	const text = await res.text();
	if (!res.ok) return {
		ok: false,
		detail: webfamError(res.status, text)
	};
	try {
		const j = JSON.parse(text);
		if (!j.success) return {
			ok: false,
			detail: webfamError(res.status, text)
		};
		return {
			ok: true,
			detail: `${j.data?.balance ?? "?"} ${j.data?.currency ?? "credits"}${j.data?.is_low ? " (low)" : ""}`
		};
	} catch {
		return {
			ok: false,
			detail: text.slice(0, 80)
		};
	}
}
async function deliverSms(settings, phone, message) {
	const to = e164(phone);
	const mobile = keMobile(phone);
	if (!to) return {
		status: "failed",
		detail: "No phone number"
	};
	if (!settings.sms_api_key || settings.sms_sandbox) return {
		status: "sandbox",
		detail: `${settings.sms_provider} sandbox → ${to}`
	};
	try {
		const kind = settings.sms_provider;
		if (kind === "africastalking") {
			const body = new URLSearchParams({
				username: settings.sms_username,
				to,
				message,
				...settings.sms_sender_id ? { from: settings.sms_sender_id } : {}
			});
			const res = await fetch("https://api.africastalking.com/version1/messaging", {
				method: "POST",
				headers: {
					apiKey: settings.sms_api_key,
					Accept: "application/json",
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body
			});
			if (!res.ok) return {
				status: "failed",
				detail: `Africa's Talking ${res.status}`
			};
			return {
				status: "sent",
				detail: to
			};
		}
		if (kind === "twilio") {
			const sid = settings.sms_username;
			const auth = Buffer.from(`${sid}:${settings.sms_api_key}`).toString("base64");
			const body = new URLSearchParams({
				To: to,
				From: settings.sms_sender_id,
				Body: message
			});
			const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
				method: "POST",
				headers: {
					Authorization: `Basic ${auth}`,
					"Content-Type": "application/x-www-form-urlencoded"
				},
				body
			});
			if (!res.ok) return {
				status: "failed",
				detail: `Twilio ${res.status}`
			};
			return {
				status: "sent",
				detail: to
			};
		}
		if (kind === "talksasa") {
			const r = await sendTalksasaV3("https://bulksms.talksasa.com/api/v3", settings, mobile, message);
			if (!r.ok) return {
				status: "failed",
				detail: `Talksasa ${r.status} ${r.text.slice(0, 80)}`
			};
			return {
				status: "sent",
				detail: to
			};
		}
		if (kind === "blessedtexts") {
			const r = await sendHostpinnacle("https://sms.blessedtexts.com", settings, mobile, message);
			if (!r.ok) return {
				status: "failed",
				detail: `Blessed Texts ${r.status} ${r.text.slice(0, 80)}`
			};
			return {
				status: "sent",
				detail: to
			};
		}
		if (kind === "webfam") {
			const r = await sendWebfam(settings, mobile, message);
			if (!r.ok) return {
				status: "failed",
				detail: webfamError(r.status, r.text)
			};
			try {
				const j = JSON.parse(r.text);
				if (j.success === false) return {
					status: "failed",
					detail: webfamError(r.status, r.text)
				};
				const remaining = j.data?.balance_remaining ?? j.data?.balanceRemaining;
				return {
					status: "sent",
					detail: `${to} ${j.data?.message_id ? `#${j.data.message_id}` : ""}${remaining != null ? ` · ${remaining} credits` : ""}`.trim()
				};
			} catch {
				return {
					status: "sent",
					detail: to
				};
			}
		}
		const res = await fetch("https://api.advantasms.com/v1/send", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Api-Key": settings.sms_api_key
			},
			body: JSON.stringify({
				partnerID: settings.sms_username,
				shortcode: settings.sms_sender_id,
				mobile,
				message
			})
		});
		if (!res.ok) return {
			status: "failed",
			detail: `Advanta ${res.status}`
		};
		return {
			status: "sent",
			detail: to
		};
	} catch (e) {
		return {
			status: "failed",
			detail: e instanceof Error ? e.message : "SMS send failed"
		};
	}
}
async function deliverWhatsapp(settings, phone, message) {
	const to = e164(phone).replace("+", "");
	if (!to) return {
		status: "failed",
		detail: "No phone number"
	};
	if (!settings.wa_access_token || !settings.wa_phone_id || settings.wa_sandbox) return {
		status: "sandbox",
		detail: `WhatsApp sandbox → +${to}`
	};
	try {
		const res = await fetch(`https://graph.facebook.com/v21.0/${settings.wa_phone_id}/messages`, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${settings.wa_access_token}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				messaging_product: "whatsapp",
				to,
				type: "text",
				text: {
					preview_url: false,
					body: message
				}
			})
		});
		if (!res.ok) return {
			status: "failed",
			detail: `Meta ${res.status}`
		};
		return {
			status: "sent",
			detail: `+${to}`
		};
	} catch (e) {
		return {
			status: "failed",
			detail: e instanceof Error ? e.message : "WhatsApp send failed"
		};
	}
}
async function deliverChannel(settings, channel, dest, body) {
	if (channel === "sms") return deliverSms(settings, dest, body);
	if (channel === "whatsapp") return deliverWhatsapp(settings, dest, body);
	return {
		status: "sent",
		detail: dest
	};
}
async function saveMessagingSettings(sql, tenantId, patch) {
	const current = await getMessagingSettings(sql, tenantId);
	const keepSecret = (incoming, existing) => {
		if (!incoming || incoming.startsWith("••••")) return existing;
		return incoming;
	};
	const next = {
		payment_sms: patch.payment_sms ?? current.payment_sms,
		payment_whatsapp: patch.payment_whatsapp ?? current.payment_whatsapp,
		billing_sms: patch.billing_sms ?? current.billing_sms,
		billing_whatsapp: patch.billing_whatsapp ?? current.billing_whatsapp,
		sms_provider: patch.sms_provider ?? current.sms_provider,
		sms_sender_id: patch.sms_sender_id ?? current.sms_sender_id,
		sms_username: patch.sms_username ?? current.sms_username,
		sms_api_key: seal(keepSecret(patch.sms_api_key, current.sms_api_key)),
		sms_sandbox: patch.sms_sandbox ?? current.sms_sandbox,
		wa_provider: patch.wa_provider ?? current.wa_provider,
		wa_phone_id: patch.wa_phone_id ?? current.wa_phone_id,
		wa_access_token: seal(keepSecret(patch.wa_access_token, current.wa_access_token)),
		wa_business_id: patch.wa_business_id ?? current.wa_business_id,
		wa_sandbox: patch.wa_sandbox ?? current.wa_sandbox
	};
	await sql`update messaging_settings set
    payment_sms = ${next.payment_sms},
    payment_whatsapp = ${next.payment_whatsapp},
    billing_sms = ${next.billing_sms},
    billing_whatsapp = ${next.billing_whatsapp},
    sms_provider = ${next.sms_provider},
    sms_sender_id = ${next.sms_sender_id},
    sms_username = ${next.sms_username},
    sms_api_key = ${next.sms_api_key},
    sms_sandbox = ${next.sms_sandbox},
    wa_provider = ${next.wa_provider},
    wa_phone_id = ${next.wa_phone_id},
    wa_access_token = ${next.wa_access_token},
    wa_business_id = ${next.wa_business_id},
    wa_sandbox = ${next.wa_sandbox},
    updated_at = now()
    where tenant_id = ${tenantId}`;
	return next;
}
async function recordLedger(sql, opts) {
	await sql`insert into customer_ledger
    (id, tenant_id, customer_id, entry_type, debit_kes, credit_kes, ref_type, ref_id, memo)
    values (
      ${nid("led")}, ${opts.tenantId}, ${opts.customerId}, ${opts.entryType},
      ${opts.debitKes ?? 0}, ${opts.creditKes ?? 0}, ${opts.refType ?? ""}, ${opts.refId ?? ""}, ${opts.memo ?? ""}
    )`;
}
async function allocatePayment(sql, opts) {
	await sql`insert into payment_allocations (id, tenant_id, payment_id, invoice_id, amount_kes)
    values (${nid("alc")}, ${opts.tenantId}, ${opts.paymentId}, ${opts.invoiceId}, ${opts.amountKes})`;
}
function intervalDays(billingInterval) {
	if (billingInterval === "daily") return 1;
	if (billingInterval === "weekly") return 7;
	return 30;
}
function needsRecurringInvoice(opts) {
	if (opts.hasUnpaid) return false;
	if (!opts.lastIssuedAt) return true;
	const last = new Date(opts.lastIssuedAt);
	if (Number.isNaN(last.getTime())) return true;
	const today = opts.today ?? /* @__PURE__ */ new Date();
	return Math.floor((today.getTime() - last.getTime()) / 864e5) >= intervalDays(opts.interval);
}
function moneyRound(n) {
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.round(n));
}
function taxOn(subtotal, ratePct) {
	if (ratePct <= 0 || subtotal <= 0) return 0;
	return moneyRound(subtotal * ratePct / 100);
}
function normalizeItems(items) {
	return items.map((item) => {
		const quantity = Math.max(1, moneyRound(item.quantity ?? 1) || 1);
		const unit_kes = moneyRound(item.unit_kes);
		return {
			description: item.description.trim() || "Internet service",
			quantity,
			unit_kes,
			amount_kes: quantity * unit_kes,
			package_id: item.package_id || "",
			service_id: item.service_id || ""
		};
	}).filter((item) => item.amount_kes > 0);
}
function invoiceTotals(items, vatRatePct) {
	const subtotal = items.reduce((sum, item) => sum + item.amount_kes, 0);
	const tax = taxOn(subtotal, vatRatePct);
	return {
		subtotal,
		tax,
		total: subtotal + tax,
		tax_rate: vatRatePct > 0 ? vatRatePct : 0
	};
}
function remainingKes(amount, paid, status) {
	if (status === "paid") return 0;
	return Math.max(0, moneyRound(amount) - moneyRound(paid));
}
function statusAfterPayment(amount, paid, current) {
	if (paid >= amount) return "paid";
	if (paid > 0) return "partial";
	return current === "paid" ? "issued" : current;
}
async function tenantVatRate(sql, tenantId) {
	const [ten] = await sql`
    select vat_enabled, vat_rate_pct from tenants where id = ${tenantId}`;
	if (!ten?.vat_enabled) return 0;
	return Math.max(0, ten.vat_rate_pct || 16);
}
async function issueInvoice(sql, opts) {
	const items = normalizeItems(opts.items && opts.items.length > 0 ? opts.items : [{
		description: "Internet service",
		quantity: 1,
		unit_kes: moneyRound(opts.amountKes ?? 0)
	}]);
	if (items.length === 0) throw new Error("Invoice needs at least one line");
	const totals = invoiceTotals(items, await tenantVatRate(sql, opts.tenantId));
	const [{ n }] = await sql`select count(*)::int as n from invoices where tenant_id = ${opts.tenantId}`;
	const number = `INV-${String(1e3 + (n ?? 0) + 1)}`;
	const id = nid("inv");
	await sql`insert into invoices
    (id, tenant_id, customer_id, number, amount_kes, status, due_date, subtotal_kes, tax_kes, tax_rate, paid_kes, notes)
    values (
      ${id}, ${opts.tenantId}, ${opts.customerId}, ${number}, ${totals.total}, 'issued', ${opts.dueDate},
      ${totals.subtotal}, ${totals.tax}, ${totals.tax_rate}, 0, ${opts.notes ?? ""}
    )`;
	for (const item of items) await sql`insert into invoice_items
      (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes, package_id, service_id)
      values (
        ${nid("ili")}, ${opts.tenantId}, ${id}, ${item.description}, ${item.quantity}, ${item.unit_kes},
        ${item.amount_kes}, ${item.package_id || null}, ${item.service_id || null}
      )`;
	await recordLedger(sql, {
		tenantId: opts.tenantId,
		customerId: opts.customerId,
		entryType: "invoice",
		debitKes: totals.total,
		refType: "invoice",
		refId: id,
		memo: number
	});
	return {
		id,
		number,
		amount_kes: totals.total,
		subtotal_kes: totals.subtotal,
		tax_kes: totals.tax,
		tax_rate: totals.tax_rate
	};
}
async function generateRecurringInvoices(sql, tenantId) {
	const customers = await sql`
    select distinct c.id from customers c
    join services s on s.customer_id = c.id
    where c.tenant_id = ${tenantId} and s.tenant_id = ${tenantId} and s.status in ('active','grace')`;
	const created = [];
	for (const c of customers) {
		const pkgs = await sql`
      select s.id as service_id, p.id as package_id, p.name, p.price_kes, p.billing_interval
      from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.customer_id = ${c.id} and s.status in ('active','grace')`;
		if (!pkgs[0]) continue;
		const unpaid = await sql`
      select id from invoices where tenant_id = ${tenantId} and customer_id = ${c.id}
      and status in ('issued','due','overdue','partial') limit 1`;
		const [last] = await sql`
      select issued_at::text as issued_at from invoices
      where tenant_id = ${tenantId} and customer_id = ${c.id}
      order by issued_at desc limit 1`;
		if (!needsRecurringInvoice({
			hasUnpaid: Boolean(unpaid[0]),
			lastIssuedAt: last?.issued_at ?? null,
			interval: pkgs[0].billing_interval
		})) continue;
		const due = /* @__PURE__ */ new Date();
		due.setDate(due.getDate() + Math.min(intervalDays(pkgs[0].billing_interval), 14));
		const dueDate = due.toISOString().slice(0, 10);
		const inv = await issueInvoice(sql, {
			tenantId,
			customerId: c.id,
			dueDate,
			items: pkgs.map((p) => ({
				description: `${p.name} (${p.billing_interval})`,
				quantity: 1,
				unit_kes: p.price_kes,
				package_id: p.package_id,
				service_id: p.service_id
			}))
		});
		created.push({
			customerId: c.id,
			id: inv.id,
			number: inv.number,
			amount_kes: inv.amount_kes,
			dueDate
		});
	}
	return created;
}
var rls_exports = /* @__PURE__ */ __exportAll$1({ applyRls: () => applyRls });
async function applyRls(sql, opts) {
	const tenantId = opts.tenantId ?? "";
	const bypass = opts.bypass ? "on" : "off";
	await sql.query("select set_config('app.tenant_id', $1, false)", [tenantId]);
	await sql.query("select set_config('app.bypass_rls', $1, false)", [bypass]);
}
//#endregion
//#region node_modules/.nitro/vite/services/ssr/assets/access-1saCIo2_.js
var DESTRUCTIVE = /^(raw\.script|system\.reboot|reboot|factory)/i;
function initialCommandStatus(kind) {
	return DESTRUCTIVE.test(kind) ? "proposed" : "queued";
}
async function ensureOpsSchema(_sql) {}
/** RouterOS v7 script generation. Uses :local, :if, :do, find where — not API-style one-liners. */
function rosQuote(value) {
	return `"${value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}
function localBlock(vars) {
	return Object.entries(vars).map(([k, v]) => `:local ${k} ${rosQuote(v)};`).join("\n");
}
function enrollRosScript(opts) {
	const identity = opts.identity || opts.name;
	const addr = opts.wgAddress.includes("/") ? opts.wgAddress : `${opts.wgAddress}/32`;
	const pull = opts.pullUrl || "";
	const scheduler = pull ? `
:do { /system script remove [find where name="gridline-pull"] } on-error={}
/system script add name=gridline-pull owner=admin policy=read,write,policy,test,password,sensitive source={
  :do {
    /tool fetch url=${rosQuote(pull)} mode=https check-certificate=no http-method=get dst-path=gridline-pull.rsc;
    :delay 2s;
    :if ([:len [/file find where name="gridline-pull.rsc"]] > 0) do={
      /import file-name=gridline-pull.rsc;
    }
  } on-error={
    :log warning "gridline-agent fetch failed";
  }
}

:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
/system scheduler add name=gridline-agent interval=1m start-time=startup \\
  policy=read,write,policy,test,password,sensitive \\
  on-event="/system script run gridline-pull";` : `
:do { /system scheduler remove [find where name="gridline-agent"] } on-error={}
/system scheduler add name=gridline-agent interval=1m start-time=startup \\
  on-event={ :log info ("gridline heartbeat " . ${rosQuote(opts.token)}) };`;
	return `# Gridline agent enroll — RouterOS v7 script
# Paste in New Terminal, or: /import file-name=gridline-enroll.rsc
# Syntax: :local / :if / :do on-error / find where

${localBlock({
		identity,
		token: opts.token,
		wgKey: opts.wgPublic,
		wgAddr: addr
	})}

/system identity set name=\$identity;

:if ([:len [/interface wireguard find where name="wg-gridline"]] = 0) do={
  /interface wireguard add name=wg-gridline listen-port=13231 comment="gridline-agent";
}

:if ([:len [/interface wireguard peers find where interface="wg-gridline" and public-key=\$wgKey]] = 0) do={
  /interface wireguard peers add interface=wg-gridline public-key=\$wgKey allowed-address=10.200.0.1/32 persistent-keepalive=00:00:25 comment="gridline-controller";
}

:if ([:len [/ip address find where interface="wg-gridline"]] = 0) do={
  /ip address add address=\$wgAddr interface=wg-gridline;
}

:if ([:len [/ip firewall filter find where comment="gridline-agent"]] = 0) do={
  /ip firewall filter add chain=input in-interface=wg-gridline action=accept comment="gridline-agent" place-before=0;
}

/ip service set www-ssl disabled=no address=10.200.0.0/24;
/ip service set api disabled=no address=10.200.0.0/24;
/ip service set winbox address=10.200.0.0/24;

:log info ("gridline enrolled token=" . \$token);
${scheduler}
`;
}
function commandRosScript(kind, payload) {
	const user = String(payload.username || payload.name || "").trim();
	const password = String(payload.password || "");
	const ip = String(payload.static_ip || payload.address || "");
	const profile = String(payload.package || payload.profile || "default");
	const comment = String(payload.service_id || "gridline");
	const limit = `${Number(payload.upload_mbps || payload.up || 10)}M/${Number(payload.download_mbps || payload.down || 10)}M`;
	const disabled = payload.status === "suspended" || payload.status === "terminated" || payload.enabled === false;
	const qname = `static-${user || ip || "host"}`;
	if (kind.startsWith("pppoe.")) {
		if (!user) return "# missing pppoe username";
		if (kind.endsWith("disconnect")) return `${localBlock({ user })}
:do { /ppp active remove [find where name=\$user] } on-error={};`;
		if (kind.endsWith("disable") || disabled) return `${localBlock({ user })}
:if ([:len [/ppp secret find where name=\$user]] > 0) do={
  /ppp secret set [find where name=\$user] disabled=yes;
}
:do { /ppp active remove [find where name=\$user] } on-error={};`;
		return `${localBlock({
			user,
			pass: password,
			profile,
			comment
		})}
:if ([:len [/ppp secret find where name=\$user]] = 0) do={
  /ppp secret add name=\$user password=\$pass service=pppoe profile=\$profile comment=\$comment disabled=no;
} else={
  /ppp secret set [find where name=\$user] password=\$pass profile=\$profile disabled=no;
}`;
	}
	if (kind.startsWith("static.")) {
		if (kind.endsWith("disable") || disabled) return `${localBlock({
			qname,
			ip
		})}
:if ([:len [/queue simple find where name=\$qname]] > 0) do={
  /queue simple set [find where name=\$qname] disabled=yes;
}
:do { /ip firewall address-list remove [find where list="gridline-active" and address=\$ip] } on-error={};`;
		return `${localBlock({
			qname,
			ip,
			limit,
			user
		})}
:if ([:len [/queue simple find where name=\$qname]] = 0) do={
  /queue simple add name=\$qname target=(\$ip . "/32") max-limit=\$limit;
} else={
  /queue simple set [find where name=\$qname] max-limit=\$limit disabled=no;
}
:if ([:len [/ip firewall address-list find where list="gridline-active" and address=\$ip]] = 0) do={
  /ip firewall address-list add list=gridline-active address=\$ip comment=\$user;
}`;
	}
	if (kind.startsWith("hotspot.")) {
		if (!user) return "# missing hotspot username";
		if (kind.endsWith("disable") || disabled) return `${localBlock({ user })}
:if ([:len [/ip hotspot user find where name=\$user]] > 0) do={
  /ip hotspot user set [find where name=\$user] disabled=yes;
}
:do { /ip hotspot active remove [find where user=\$user] } on-error={};`;
		return `${localBlock({
			user,
			pass: password,
			profile
		})}
:if ([:len [/ip hotspot user find where name=\$user]] = 0) do={
  /ip hotspot user add name=\$user password=\$pass profile=\$profile disabled=no;
} else={
  /ip hotspot user set [find where name=\$user] password=\$pass profile=\$profile disabled=no;
}`;
	}
	if (kind === "identity.set") return `${localBlock({ identity: String(payload.identity || payload.name || "gridline") })}
/system identity set name=\$identity;`;
	if (kind === "resource.snapshot") return `:log info [/system resource get version];
:log info [/system resource get cpu-load];`;
	if (kind === "raw.script") return String(payload.script || payload.source || "");
	if (kind === "reboot") return `:delay 2s;
/system reboot;`;
	return `# unknown kind ${kind}`;
}
function wrapPullRosScript(opts) {
	const body = opts.commands.map((c) => `# --- ${c.kind} ${c.id}
${c.script}`).join("\n\n");
	return `# Gridline agent pull — RouterOS v7
# /import file-name=gridline-pull.rsc
# identity: ${opts.identity}

{
${body || `  :log info ${rosQuote("gridline-agent idle")};`}

  :log info ${rosQuote(`gridline-agent applied ${opts.commands.length} command(s)`)};
}
`;
}
function rawFromDer(der, size = 32) {
	return der.subarray(der.length - size).toString("base64");
}
function generateWireGuardKeypair() {
	const pair = generateKeyPairSync("x25519", {
		publicKeyEncoding: {
			type: "spki",
			format: "der"
		},
		privateKeyEncoding: {
			type: "pkcs8",
			format: "der"
		}
	});
	const publicKey = rawFromDer(pair.publicKey);
	const privateKey = rawFromDer(pair.privateKey);
	if (publicKey.length < 40 || privateKey.length < 40) throw new Error("WireGuard key generation failed");
	return {
		publicKey,
		privateKeySealed: seal(privateKey)
	};
}
function wgAddressForIndex(i) {
	return `10.200.0.${i % 250 + 2}/32`;
}
function enrollFields(_name) {
	const token = `agt_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
	const keys = generateWireGuardKeypair();
	return {
		token,
		wg_public: keys.publicKey,
		wg_private_sealed: keys.privateKeySealed
	};
}
async function pickRouter(sql, tenantId) {
	return (await sql`
    select id from routers where tenant_id = ${tenantId}
    order by case when wg_status = 'connected' then 0 else 1 end, name
    limit 1`)[0]?.id ?? null;
}
async function enqueueAgentCommand(sql, tenantId, kind, payload, routerId, requestedBy = "") {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const rid = routerId ?? await pickRouter(sql, tenantId);
	if (!rid) return null;
	const id = nid("cmd");
	const status = initialCommandStatus(kind);
	await sql`insert into agent_commands (id, tenant_id, router_id, kind, payload, status, requested_by)
    values (${id}, ${tenantId}, ${rid}, ${kind}, ${JSON.stringify(payload)}, ${status}, ${requestedBy})`;
	return id;
}
async function enqueueServiceCommand(sql, tenantId, service) {
	const action = service.status === "suspended" || service.status === "terminated" ? "disable" : "upsert";
	return enqueueAgentCommand(sql, tenantId, `${service.access_method}.${action}`, {
		service_id: service.id,
		username: service.username,
		password: service.password || "",
		static_ip: service.static_ip,
		status: service.status,
		package: service.package_name ?? "",
		download_mbps: service.download_mbps ?? 10,
		upload_mbps: service.upload_mbps ?? 10
	});
}
function agentPullUrl(base, token) {
	const root = (base || "").replace(/\/$/, "");
	if (!root || !token) return "";
	return `${root}/api/agent/script?token=${encodeURIComponent(token)}`;
}
function agentScript(opts) {
	return enrollRosScript(opts);
}
var handlers = /* @__PURE__ */ new Map();
function on(type, handler) {
	const list = handlers.get(type) ?? [];
	list.push(handler);
	handlers.set(type, list);
}
async function emit(sql, event) {
	const { wireModules } = await import("./subscribers-DZaCSMrh.mjs");
	wireModules();
	const list = handlers.get(event.type) ?? [];
	for (const handler of list) await handler(sql, event);
}
function mikrotikRateLimit(downMbps, upMbps) {
	return `${Math.max(1, upMbps)}M/${Math.max(1, downMbps)}M`;
}
function renderFreeRadiusUsers(accounts) {
	return accounts.map((a) => {
		if (!a.enabled) return `${a.username} Auth-Type := Reject`;
		const attrs = [`Cleartext-Password := "${a.password}"`];
		if (a.rate_limit) attrs.push(`Mikrotik-Rate-Limit := "${a.rate_limit}"`);
		if (a.framed_ip) attrs.push(`Framed-IP-Address := ${a.framed_ip}`);
		attrs.push(`Mikrotik-Group := "${a.group_name}"`);
		return `${a.username} ${attrs[0]}\n\t${attrs.slice(1).join(",\n	")}`;
	}).join("\n\n");
}
function publicRadiusAccount(row) {
	const p = row.password;
	const shown = !p ? "" : p.length <= 4 ? "••••" : `••••${p.slice(-4)}`;
	return {
		...row,
		password: shown
	};
}
function secret() {
	return crypto.randomUUID().replace(/-/g, "").slice(0, 10);
}
async function syncRadiusAccount(sql, tenantId, service) {
	const username = service.username?.trim() || `${service.access_method}-${service.id.slice(-6)}`;
	const enabled = service.status === "active" || service.status === "grace" || service.status === "pending";
	const group = service.access_method === "static" ? "static" : service.access_method;
	const rate = mikrotikRateLimit(service.download_mbps ?? 10, service.upload_mbps ?? 10);
	const existing = await sql`
    select id, password from radius_accounts where tenant_id = ${tenantId} and service_id = ${service.id}`;
	if (existing[0]) {
		const password = service.password || existing[0].password;
		await sql`update radius_accounts
      set username = ${username}, framed_ip = ${service.static_ip ?? ""}, group_name = ${group}, enabled = ${enabled}, rate_limit = ${rate}, password = ${password}
      where id = ${existing[0].id}`;
		return {
			username,
			password,
			enabled,
			rate_limit: rate
		};
	}
	const password = service.password || secret();
	await sql`insert into radius_accounts (id, tenant_id, service_id, username, password, framed_ip, group_name, enabled, rate_limit)
    values (${nid("rad")}, ${tenantId}, ${service.id}, ${username}, ${password}, ${service.static_ip ?? ""}, ${group}, ${enabled}, ${rate})`;
	return {
		username,
		password,
		enabled,
		rate_limit: rate
	};
}
async function disconnectRadiusUser(sql, tenantId, username) {
	const [acc] = await sql`select username, group_name, service_id from radius_accounts
     where tenant_id = ${tenantId} and username = ${username}`;
	if (!acc) throw new Error("RADIUS user not found");
	const kind = acc.group_name === "hotspot" ? "hotspot.disable" : "pppoe.disable";
	await enqueueAgentCommand(sql, tenantId, kind, {
		username: acc.username,
		service_id: acc.service_id,
		status: "suspended"
	});
	await sql`update radius_sessions set stopped_at = now()
    where tenant_id = ${tenantId} and username = ${username} and stopped_at is null`;
	return {
		username: acc.username,
		kind
	};
}
async function seedRadiusSessions(sql, tenantId) {
	const acc = await sql`
    select username, framed_ip from radius_accounts where tenant_id = ${tenantId} and enabled = true`;
	if (((await sql`select count(*)::int as n from radius_sessions where tenant_id = ${tenantId}`)[0]?.n ?? 0) > 0) return;
	for (const a of acc.slice(0, 4)) await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values (${nid("ses")}, ${tenantId}, ${a.username}, ${a.framed_ip || "10.10.10." + (20 + Math.floor(Math.random() * 80))}, '10.200.0.2', ${5e6 + Math.floor(Math.random() * 4e7)}, ${1e6 + Math.floor(Math.random() * 8e6)})`;
}
async function provisionServiceAccess(sql, tenantId, serviceId) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	const [svc] = await sql`select s.id, s.access_method, s.username, s.static_ip, s.status, p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
	if (!svc) return null;
	await emit(sql, {
		type: "service.changed",
		tenantId,
		payload: { ...svc }
	});
	const [radius] = await sql`
    select username, password, enabled from radius_accounts
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
	return radius ?? null;
}
async function seedOpsForTenant(sql, tenantId) {
	await /* @__PURE__ */ ensureOpsSchema(sql);
	await getMessagingSettings(sql, tenantId);
	for (const p of [
		{
			kind: "mpesa",
			label: "M-Pesa Daraja"
		},
		{
			kind: "kopokopo",
			label: "Kopo Kopo"
		},
		{
			kind: "airtel",
			label: "Airtel Money"
		},
		{
			kind: "bank",
			label: "Bank transfer"
		}
	]) if (!(await sql`select id from payment_providers where tenant_id = ${tenantId} and kind = ${p.kind}`)[0]) await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
        values (${nid("prv")}, ${tenantId}, ${p.kind}, ${p.label}, true, true)`;
	if (!(await sql`select id from ip_pools where tenant_id = ${tenantId}`)[0]) await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
      values (${nid("pool")}, ${tenantId}, 'Static customers', '102.68.10.0/24', 20)`;
	const services = await sql`select id from services where tenant_id = ${tenantId}`;
	for (const s of services) await provisionServiceAccess(sql, tenantId, s.id);
	await seedRadiusSessions(sql, tenantId);
	const routers = await sql`
    select id, name, enroll_token from routers where tenant_id = ${tenantId}`;
	let i = 0;
	for (const r of routers) {
		i += 1;
		if (!r.enroll_token) {
			const enroll = enrollFields(r.name);
			await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_address = ${wgAddressForIndex(i)}, agent_version = '0.2.0'
        where id = ${r.id}`;
		}
	}
	const hsPkg = await sql`select id from packages where tenant_id = ${tenantId} and access_method = 'hotspot' limit 1`;
	const vouchers = await sql`select count(*)::int as n from hotspot_vouchers where tenant_id = ${tenantId}`;
	if (hsPkg[0] && (vouchers[0]?.n ?? 0) === 0) for (let v = 1; v <= 6; v++) {
		const code = `HS-${(1e5 + v).toString(36).toUpperCase()}${v}`;
		await sql`insert into hotspot_vouchers (id, tenant_id, package_id, code, hours, status)
        values (${nid("vch")}, ${tenantId}, ${hsPkg[0].id}, ${code}, 24, ${v < 3 ? "active" : "unused"})`;
	}
	if (((await sql`select count(*)::int as n from cpe_devices where tenant_id = ${tenantId}`)[0]?.n ?? 0) === 0) {
		const cust = await sql`select id from customers where tenant_id = ${tenantId} limit 3`;
		const devices = [
			{
				serial: "ZTE-4G-88921",
				product: "F670L",
				ssid: "Amina-Home"
			},
			{
				serial: "HW-HG8145-1022",
				product: "HG8145V5",
				ssid: "Njeri-Office"
			},
			{
				serial: "TK-ARCHER-4410",
				product: "Archer C6",
				ssid: "Faith-WiFi"
			}
		];
		for (let d = 0; d < devices.length; d++) await sql`insert into cpe_devices (id, tenant_id, serial, product_class, ssid, status, customer_id)
        values (${nid("cpe")}, ${tenantId}, ${devices[d].serial}, ${devices[d].product}, ${devices[d].ssid}, 'online', ${cust[d]?.id ?? null})`;
	}
	if (((await sql`select count(*)::int as n from resellers where tenant_id = ${tenantId}`)[0]?.n ?? 0) === 0) {
		await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, 'Westlands Agent', '+254700111222', 12, 'active')`;
		await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, 'Nyali Kiosk', '+254711333444', 8, 'active')`;
	}
}
//#endregion
export { issueInvoice as A, statusAfterPayment as B, deliverChannel as C, getMessagingSettings as D, generateRecurringInvoices as E, remainingKes as F, webfamBalance as H, rls_D3aPKMQT_exports as I, saveMessagingSettings as L, nid as M, open as N, hint$1 as O, recordLedger as P, seal as R, cn as S, deliverWhatsapp as T, toPublic as V, wgAddressForIndex as _, emit as a, applyRls as b, enrollFields as c, on as d, provisionServiceAccess as f, syncRadiusAccount as g, seedOpsForTenant as h, disconnectRadiusUser as i, kes as j, intervalDays as k, ensureOpsSchema as l, renderFreeRadiusUsers as m, agentScript as n, enqueueAgentCommand as o, publicRadiusAccount as p, commandRosScript as r, enqueueServiceCommand as s, agentPullUrl as t, initialCommandStatus as u, wrapPullRosScript as v, deliverSms as w, channelAllowed as x, allocatePayment as y, slugify as z };

import { C as provisionServiceAccess, b as nid, g as getMessagingSettings, i as channelAllowed, s as deliverChannel } from "./rls-stkZtAMF.mjs";
import { n as recordLedger } from "./ledger-IzxNvXf8.mjs";
import { i as writeInbox, r as queueEmail } from "./inbox-C11LOMfj.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/notifications-NHmcUGyA.js
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
async function issueInvoice(sql, opts) {
	const [{ n }] = await sql`select count(*)::int as n from invoices where tenant_id = ${opts.tenantId}`;
	const number = `INV-${String(1e3 + (n ?? 0) + 1)}`;
	const id = nid("inv");
	await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
    values (${id}, ${opts.tenantId}, ${opts.customerId}, ${number}, ${opts.amountKes}, 'issued', ${opts.dueDate})`;
	await recordLedger(sql, {
		tenantId: opts.tenantId,
		customerId: opts.customerId,
		entryType: "invoice",
		debitKes: opts.amountKes,
		refType: "invoice",
		refId: id,
		memo: number
	});
	return {
		id,
		number
	};
}
async function generateRecurringInvoices(sql, tenantId, issue) {
	const customers = await sql`
    select distinct c.id from customers c
    join services s on s.customer_id = c.id
    where c.tenant_id = ${tenantId} and s.tenant_id = ${tenantId} and s.status in ('active','grace')`;
	let created = 0;
	for (const c of customers) {
		const pkgs = await sql`
      select p.price_kes, p.billing_interval from services s
      join packages p on p.id = s.package_id
      where s.tenant_id = ${tenantId} and s.customer_id = ${c.id} and s.status in ('active','grace')`;
		if (!pkgs[0]) continue;
		const amount = pkgs.reduce((sum, p) => sum + p.price_kes, 0);
		const interval = pkgs[0].billing_interval;
		const unpaid = await sql`
      select id from invoices where tenant_id = ${tenantId} and customer_id = ${c.id}
      and status in ('issued','due','overdue') limit 1`;
		const [last] = await sql`
      select issued_at::text as issued_at from invoices
      where tenant_id = ${tenantId} and customer_id = ${c.id}
      order by issued_at desc limit 1`;
		if (!needsRecurringInvoice({
			hasUnpaid: Boolean(unpaid[0]),
			lastIssuedAt: last?.issued_at ?? null,
			interval
		})) continue;
		const due = /* @__PURE__ */ new Date();
		due.setDate(due.getDate() + Math.min(intervalDays(interval), 14));
		await issue(c.id, amount, due.toISOString().slice(0, 10));
		created += 1;
	}
	return created;
}
var DEFAULTS = [
	{
		event_code: "invoice.created",
		channel: "sms",
		subject: "Invoice issued",
		body: "Hi {customer_name}, {isp_name} issued {invoice_number} for {amount}. Due {due_date}. Pay via M-Pesa to stay online."
	},
	{
		event_code: "invoice.created",
		channel: "email",
		subject: "Invoice {invoice_number} from {isp_name}",
		body: "Hello {customer_name},\n\nInvoice {invoice_number} for {amount} is due on {due_date}.\nPay by M-Pesa to avoid service interruption.\n\n{isp_name}"
	},
	{
		event_code: "invoice.due",
		channel: "sms",
		subject: "Invoice due today",
		body: "{customer_name}, {invoice_number} of {amount} is due today. Pay now to avoid grace/suspension. — {isp_name}"
	},
	{
		event_code: "invoice.overdue",
		channel: "sms",
		subject: "Invoice overdue",
		body: "{customer_name}, {invoice_number} ({amount}) is overdue. Pay today or service may enter grace. — {isp_name}"
	},
	{
		event_code: "invoice.overdue",
		channel: "whatsapp",
		subject: "Overdue invoice",
		body: "Hi {customer_name}, your {isp_name} invoice {invoice_number} of {amount} is overdue (due {due_date}). Pay via M-Pesa to keep your connection."
	},
	{
		event_code: "payment.received",
		channel: "sms",
		subject: "Payment received",
		body: "Payment {payment_reference} of {amount} received. Thank you {customer_name}. Service is active. — {isp_name}"
	},
	{
		event_code: "payment.received",
		channel: "in_app",
		subject: "Payment received",
		body: "We received {amount} (ref {payment_reference}) for {invoice_number}. Your service is active."
	},
	{
		event_code: "payment.received",
		channel: "whatsapp",
		subject: "Payment received",
		body: "Hi {customer_name}, we received {amount} (ref {payment_reference}) for {invoice_number}. Your service is active. — {isp_name}"
	},
	{
		event_code: "service.restored",
		channel: "whatsapp",
		subject: "Service restored",
		body: "{customer_name}, {service_name} is back online after payment {payment_reference}. — {isp_name}"
	},
	{
		event_code: "payment.received",
		channel: "email",
		subject: "Receipt {payment_reference}",
		body: "Hi {customer_name},\n\nWe received {amount} (ref {payment_reference}) for {invoice_number}. Your service has been restored/confirmed.\n\n{isp_name}"
	},
	{
		event_code: "grace.started",
		channel: "sms",
		subject: "Grace period",
		body: "{customer_name}, your {service_name} is now on grace after unpaid {invoice_number}. Pay {amount} to avoid suspension. — {isp_name}"
	},
	{
		event_code: "service.suspended",
		channel: "sms",
		subject: "Service suspended",
		body: "{customer_name}, {service_name} is suspended for non-payment of {invoice_number} ({amount}). Pay to restore instantly. — {isp_name}"
	},
	{
		event_code: "service.restored",
		channel: "sms",
		subject: "Service restored",
		body: "{customer_name}, {service_name} is back online after payment {payment_reference}. — {isp_name}"
	},
	{
		event_code: "invoice.created",
		channel: "in_app",
		subject: "Invoice issued",
		body: "{invoice_number} for {customer_name} ({amount}) issued, due {due_date}."
	},
	{
		event_code: "service.suspended",
		channel: "in_app",
		subject: "Service suspended",
		body: "{customer_name} / {service_name} suspended after unpaid {invoice_number}."
	}
];
function render(template, vars) {
	return template.replace(/\{([a-z_]+)\}/g, (_, key) => vars[key] ?? "");
}
async function ensureNotificationSchema(_sql) {}
async function ensureDefaultTemplates(sql, tenantId) {
	await /* @__PURE__ */ ensureNotificationSchema(sql);
	for (const t of DEFAULTS) {
		if ((await sql`
      select id from notification_templates
      where tenant_id = ${tenantId} and event_code = ${t.event_code} and channel = ${t.channel}`)[0]) continue;
		await sql`insert into notification_templates (id, tenant_id, event_code, channel, subject, body, enabled)
      values (${nid("tpl")}, ${tenantId}, ${t.event_code}, ${t.channel}, ${t.subject}, ${t.body}, true)`;
	}
}
function destinationFor(channel, phone, email) {
	if (channel === "email") return email || "no-email";
	if (channel === "in_app") return "console";
	return phone || "no-phone";
}
async function dispatchNotification(sql, opts) {
	await ensureDefaultTemplates(sql, opts.tenantId);
	const settings = await getMessagingSettings(sql, opts.tenantId);
	const templates = await sql`select id, channel, subject, body, enabled from notification_templates
     where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and enabled = true`;
	const vars = {
		...opts.vars,
		isp_name: opts.ispName,
		customer_name: opts.customerName
	};
	let sent = 0;
	for (const tpl of templates) {
		if (!channelAllowed(opts.event, tpl.channel, settings)) continue;
		const subject = render(tpl.subject, vars);
		const body = render(tpl.body, vars);
		const dest = destinationFor(tpl.channel, opts.phone ?? "", opts.email ?? "");
		if ((await sql`
      select id from notification_logs
      where tenant_id = ${opts.tenantId} and event_code = ${opts.event} and entity_id = ${opts.entityId} and channel = ${tpl.channel}`)[0]) continue;
		let delivery = {
			status: "sent",
			detail: dest
		};
		if (tpl.channel === "sms" || tpl.channel === "whatsapp") delivery = await deliverChannel(settings, tpl.channel, dest, body);
		else if (tpl.channel === "email") delivery = await queueEmail(sql, opts.tenantId, dest, subject, body);
		else if (tpl.channel === "in_app" && opts.customerId) {
			await writeInbox(sql, opts.tenantId, opts.customerId, subject, body, opts.event);
			delivery = {
				status: "sent",
				detail: "inbox"
			};
		}
		await sql`insert into notification_logs (id, tenant_id, customer_id, event_code, channel, entity_id, subject, body, destination, status)
      values (${nid("ntf")}, ${opts.tenantId}, ${opts.customerId}, ${opts.event}, ${tpl.channel}, ${opts.entityId}, ${subject}, ${body}, ${delivery.detail || dest}, ${delivery.status})`;
		sent += 1;
	}
	return sent;
}
async function notifyCustomerEvent(sql, tenantId, ispName, customerId, event, entityId, vars) {
	const [c] = await sql`
    select name, phone, email from customers where id = ${customerId} and tenant_id = ${tenantId}`;
	if (!c) return 0;
	return dispatchNotification(sql, {
		tenantId,
		ispName,
		event,
		entityId,
		customerId,
		customerName: c.name,
		phone: c.phone,
		email: c.email,
		vars: {
			...vars,
			customer_name: c.name
		}
	});
}
async function runBillingCycle(sql, tenantId, ispName) {
	const issued = await generateRecurringInvoices(sql, tenantId, async (customerId, amountKes, dueDate) => {
		const inv = await issueInvoice(sql, {
			tenantId,
			customerId,
			amountKes,
			dueDate
		});
		await notifyCustomerEvent(sql, tenantId, ispName, customerId, "invoice.created", inv.id, {
			customer_name: "",
			invoice_number: inv.number,
			amount: `KES ${amountKes}`,
			due_date: dueDate
		});
	});
	const invoices = await sql`select id, customer_id, number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and status in ('issued','due','overdue')`;
	const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
	let due = 0;
	let overdue = 0;
	let grace = 0;
	let suspended = 0;
	let notices = 0;
	for (const inv of invoices) {
		const vars = {
			customer_name: "",
			invoice_number: inv.number,
			amount: `KES ${inv.amount_kes}`,
			due_date: inv.due_date
		};
		if (inv.due_date === today && inv.status === "issued") {
			await sql`update invoices set status = 'due' where id = ${inv.id} and tenant_id = ${tenantId}`;
			notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.due", inv.id, vars);
			due += 1;
		}
		if (inv.due_date < today && inv.status !== "overdue") {
			await sql`update invoices set status = 'overdue' where id = ${inv.id} and tenant_id = ${tenantId}`;
			notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
			overdue += 1;
		} else if (inv.status === "overdue") notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
		if (inv.due_date >= today) continue;
		const daysPast = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 864e5);
		const services = await sql`select s.id, s.status, s.package_id, p.name, p.grace_days
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${tenantId} and s.customer_id = ${inv.customer_id} and s.status in ('active','grace')`;
		for (const svc of services) {
			const svcVars = {
				...vars,
				service_name: svc.name
			};
			if (daysPast <= svc.grace_days && svc.status === "active") {
				await sql`update services set status = 'grace' where id = ${svc.id} and tenant_id = ${tenantId}`;
				await provisionServiceAccess(sql, tenantId, svc.id);
				notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "grace.started", svc.id, svcVars);
				grace += 1;
			} else if (daysPast > svc.grace_days && svc.status !== "suspended") {
				await sql`update services set status = 'suspended' where id = ${svc.id} and tenant_id = ${tenantId}`;
				await provisionServiceAccess(sql, tenantId, svc.id);
				notices += await notifyCustomerEvent(sql, tenantId, ispName, inv.customer_id, "service.suspended", svc.id, svcVars);
				suspended += 1;
			}
		}
	}
	return {
		due,
		overdue,
		grace,
		suspended,
		notices,
		issued
	};
}
//#endregion
export { runBillingCycle as i, issueInvoice as n, notifyCustomerEvent as r, ensureDefaultTemplates as t };

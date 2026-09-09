import { M as nid } from "./access-1saCIo2_.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/inbox-BYYGIUPO.js
async function writeInbox(sql, tenantId, customerId, subject, body, eventCode) {
	await sql`insert into customer_inbox (id, tenant_id, customer_id, subject, body, event_code)
    values (${nid("inb")}, ${tenantId}, ${customerId}, ${subject.slice(0, 200)}, ${body.slice(0, 4e3)}, ${eventCode})`;
}
async function listCustomerInbox(sql, tenantId, customerId) {
	return sql`
    select id, subject, body, event_code, created_at::text as created_at, read_at::text as read_at
    from customer_inbox where tenant_id = ${tenantId} and customer_id = ${customerId}
    order by created_at desc limit 40`;
}
async function listInbox(sql, tenantId) {
	return sql`select i.id, i.customer_id, i.subject, i.body, i.event_code, i.created_at::text as created_at, c.name as customer_name
     from customer_inbox i left join customers c on c.id = i.customer_id
     where i.tenant_id = ${tenantId} order by i.created_at desc limit 50`;
}
async function queueEmail(sql, tenantId, to, subject, body) {
	const id = nid("eml");
	let status = "queued";
	let detail = "";
	const key = process.env.RESEND_API_KEY;
	if (key && to.includes("@")) try {
		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				from: "Gridline <noreply@gridline.app>",
				to: [to],
				subject,
				text: body
			})
		});
		status = res.ok ? "sent" : "failed";
		detail = res.ok ? "resend" : `resend ${res.status}`;
	} catch (e) {
		status = "failed";
		detail = e instanceof Error ? e.message : "send failed";
	}
	else {
		detail = to.includes("@") ? "queued (no RESEND_API_KEY)" : "missing email";
		status = to.includes("@") ? "queued" : "failed";
	}
	await sql`insert into email_outbox (id, tenant_id, to_addr, subject, body, status, detail)
    values (${id}, ${tenantId}, ${to}, ${subject.slice(0, 200)}, ${body.slice(0, 4e3)}, ${status}, ${detail})`;
	return {
		status,
		detail
	};
}
//#endregion
export { writeInbox as i, listInbox as n, queueEmail as r, listCustomerInbox as t };

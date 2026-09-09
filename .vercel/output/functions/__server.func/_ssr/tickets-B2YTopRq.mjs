import { M as nid, a as emit } from "./access-1saCIo2_.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/tickets-B2YTopRq.js
function slaHours(priority) {
	if (priority === "urgent") return 4;
	if (priority === "high") return 8;
	if (priority === "low") return 72;
	return 24;
}
function dueAt(priority, now = /* @__PURE__ */ new Date()) {
	return new Date(now.getTime() + slaHours(priority) * 36e5);
}
async function openTicket(sql, tenantId, data) {
	const id = nid("tkt");
	const due = dueAt(data.priority);
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, assigned_to, due_at)
    values (${id}, ${tenantId}, ${data.customer_id || null}, ${data.title.trim()}, ${data.category}, ${data.priority},
            ${data.assigned_to ? "assigned" : "new"}, ${data.assigned_to || ""}, ${due.toISOString()})`;
	await emit(sql, {
		type: "ticket.created",
		tenantId,
		payload: {
			ticket_id: id,
			title: data.title,
			customer_id: data.customer_id || "",
			priority: data.priority
		}
	});
	return { id };
}
async function assignTicket(sql, tenantId, ticketId, userId) {
	await sql`update tickets set assigned_to = ${userId}, status = 'assigned'
    where id = ${ticketId} and tenant_id = ${tenantId}`;
	await emit(sql, {
		type: "ticket.updated",
		tenantId,
		payload: {
			ticket_id: ticketId,
			status: "assigned",
			assigned_to: userId
		}
	});
}
async function commentTicket(sql, tenantId, ticketId, authorId, body) {
	const text = body.trim();
	if (!text) throw new Error("Comment required");
	await sql`insert into ticket_comments (id, tenant_id, ticket_id, author_id, body)
    values (${nid("tcm")}, ${tenantId}, ${ticketId}, ${authorId}, ${text})`;
}
async function listStaff(sql, tenantId) {
	return sql`
    select m.user_id, m.role, coalesce(u.name, m.user_id) as name, coalesce(u.email, '') as email
    from tenant_members m
    left join "user" u on u.id = m.user_id
    where m.tenant_id = ${tenantId}
    order by m.role`;
}
//#endregion
export { openTicket as i, commentTicket as n, listStaff as r, assignTicket as t };

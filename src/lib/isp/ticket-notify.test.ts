import assert from "node:assert/strict";
import { test } from "node:test";
import { applyTechnicianWhatsAppStatus, assignTicket, changeTicketStatus, openTicket } from "./tickets.ts";
import { scanTicketSla } from "./ticket-notify.ts";
import { openTestDb } from "./test-db.ts";

test("ticket events notify the customer and the technician, not every step", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_t', 'Alpha Fibre', 'alpha-fibre')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_t', 'ten_t', 'Jane Wanjiku', '0711222333')`;
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
      values ('usr_tech', 'Amina Tech', 'amina-tech@isp.test', true, now(), now())`;
    await sql`insert into tenant_members (id, tenant_id, user_id, role) values ('mem_tech', 'ten_t', 'usr_tech', 'technician')`;
    await sql`insert into operator_profiles (user_id, phone) values ('usr_tech', '0712000111')`;
    await asRole("ten_t");

    const opened = await openTicket(sql, "ten_t", {
      title: "No internet",
      category: "network",
      priority: "high",
      customer_id: "cus_t",
    });
    await assignTicket(sql, "ten_t", opened.id, "usr_tech");
    await changeTicketStatus(sql, "ten_t", opened.id, "accepted");
    await changeTicketStatus(sql, "ten_t", opened.id, "travelling");
    await changeTicketStatus(sql, "ten_t", opened.id, "on_site");
    await changeTicketStatus(sql, "ten_t", opened.id, "resolved");

    const logs = await sql<{ event_code: string; channel: string; entity_id: string }>`
      select event_code, channel, entity_id from notification_logs where tenant_id = 'ten_t' order by created_at`;
    const codes = logs.map((row) => `${row.event_code}:${row.channel}`);
    assert.ok(codes.includes("ticket_opened:sms"));
    assert.ok(codes.includes("ticket_opened:in_app"));
    assert.ok(codes.includes("ticket_assigned:whatsapp"));
    assert.equal(logs.filter((row) => row.event_code === "ticket_status_changed").length, 1);
    assert.ok(codes.includes("ticket_resolved:sms"));
    assert.equal(logs.some((row) => row.event_code === "ticket_accepted"), false);

    const reply = await applyTechnicianWhatsAppStatus(sql, "ten_t", "+254712000111", "on site");
    assert.equal(reply.handled, true);
    assert.match(reply.reply, /no open ticket/i);

    const again = await openTicket(sql, "ten_t", {
      title: "Slow speeds",
      category: "performance",
      priority: "normal",
      customer_id: "cus_t",
      assigned_to: "usr_tech",
    });
    await changeTicketStatus(sql, "ten_t", again.id, "accepted", { technicianUserId: "usr_tech" });
    const moved = await applyTechnicianWhatsAppStatus(sql, "ten_t", "0712000111", "on site");
    assert.equal(moved.handled, true);
    assert.match(moved.reply, /on site/);
    const [row] = await sql<{ status: string }>`select status from tickets where id = ${again.id}`;
    assert.equal(row?.status, "on_site");
    await assert.rejects(
      () => changeTicketStatus(sql, "ten_t", again.id, "closed", { technicianUserId: "usr_tech" }),
      /not allowed/,
    );
    const stranger = await applyTechnicianWhatsAppStatus(sql, "ten_t", "+254700000999", "resolved");
    assert.equal(stranger.handled, false);

    await sql`update tickets set due_at = now() + interval '10 minutes' where id = ${again.id}`;
    await scanTicketSla(sql);
    await scanTicketSla(sql);
    const sla = await sql<{ n: number }>`
      select count(*)::int as n from notification_logs
      where tenant_id = 'ten_t' and event_code = 'ticket_sla_warning' and entity_id = ${again.id}`;
    assert.equal(sla[0]?.n, 1);
  } finally {
    await close();
  }
});

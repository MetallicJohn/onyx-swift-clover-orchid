import assert from "node:assert/strict";
import { test } from "node:test";
import { openTestDb } from "./test-db.ts";
import { bulkUpdateTickets, summarizeTicketBulk, ticketBulkAllowed } from "./tickets.ts";

test("ticket bulk permissions follow the desk roles", () => {
  assert.equal(ticketBulkAllowed("isp_admin", "assign"), true);
  assert.equal(ticketBulkAllowed("isp_admin", "close"), true);
  assert.equal(ticketBulkAllowed("technician", "status"), true);
  assert.equal(ticketBulkAllowed("technician", "assign"), false);
  assert.equal(ticketBulkAllowed("technician", "priority"), false);
  assert.equal(ticketBulkAllowed("technician", "close"), false);
  assert.equal(ticketBulkAllowed("support", "status"), false);
  assert.equal(ticketBulkAllowed("finance", "close"), false);
});

test("ticket bulk summarizes partial failure", () => {
  assert.equal(summarizeTicketBulk({ updated: ["a"], failed: [] }), "1 ticket updated successfully");
  assert.equal(
    summarizeTicketBulk({ updated: ["a", "b", "c", "d", "e", "f"], failed: [{ id: "x", error: "no" }, { id: "y", error: "no" }] }),
    "6 tickets updated successfully. 2 tickets could not be updated",
  );
});

test("ticket bulk assign, priority, status, close, and partial failure stay on the tenant", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_tb', 'Bulk Fibre', 'bulk-fibre'), ('ten_other', 'Other', 'other-bulk')`;
    await sql`insert into customers (id, tenant_id, name, phone) values
      ('cus_tb', 'ten_tb', 'John Kamau', '0711000001'),
      ('cus_other', 'ten_other', 'Other', '0711000002')`;
    await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt") values
      ('usr_tech', 'Tech', 'tech-bulk@isp.test', true, now(), now()),
      ('usr_other', 'Other Tech', 'other-bulk@isp.test', true, now(), now())`;
    await sql`insert into tenant_members (id, tenant_id, user_id, role) values
      ('mem_tech', 'ten_tb', 'usr_tech', 'technician'),
      ('mem_other', 'ten_tb', 'usr_other', 'support')`;
    await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, assigned_to) values
      ('tkt_a', 'ten_tb', 'cus_tb', 'No internet', 'network', 'low', 'new', ''),
      ('tkt_b', 'ten_tb', 'cus_tb', 'Slow speed', 'performance', 'normal', 'resolved', 'usr_tech'),
      ('tkt_c', 'ten_tb', 'cus_tb', 'Billing', 'billing', 'high', 'assigned', 'usr_other'),
      ('tkt_x', 'ten_other', 'cus_other', 'Foreign', 'network', 'low', 'new', '')`;
    await asRole("ten_tb");

    const assigned = await bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_a", "tkt_missing", "tkt_x"], "assign", "usr_tech");
    assert.deepEqual(assigned.updated, ["tkt_a"]);
    assert.equal(assigned.failed.length, 2);
    assert.match(summarizeTicketBulk(assigned), /1 ticket updated successfully/);
    assert.match(summarizeTicketBulk(assigned), /2 tickets could not be updated/);

    const priority = await bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_a", "tkt_b"], "priority", "urgent");
    assert.deepEqual(priority.updated.sort(), ["tkt_a", "tkt_b"]);
    assert.equal(priority.failed.length, 0);

    const status = await bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_a"], "status", "waiting");
    assert.deepEqual(status.updated, ["tkt_a"]);

    const closed = await bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_b"], "close", "");
    assert.deepEqual(closed.updated, ["tkt_b"]);

    const [rowA] = await sql<{ priority: string; status: string; assigned_to: string }>`
      select priority, status, assigned_to from tickets where id = 'tkt_a' and tenant_id = 'ten_tb'`;
    assert.equal(rowA?.assigned_to, "usr_tech");
    assert.equal(rowA?.priority, "urgent");
    assert.equal(rowA?.status, "waiting");
    const [rowB] = await sql<{ status: string }>`select status from tickets where id = 'tkt_b'`;
    assert.equal(rowB?.status, "closed");

    const techClose = await bulkUpdateTickets(sql, "ten_tb", "usr_tech", ["tkt_a", "tkt_c"], "close", "", { technicianUserId: "usr_tech" });
    assert.deepEqual(techClose.updated, ["tkt_a"]);
    assert.equal(techClose.failed.length, 1);
    assert.match(techClose.failed[0]?.error || "", /Not assigned/);

    await assert.rejects(() => bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_c"], "priority", "critical"), /Unknown priority/);
    await assert.rejects(() => bulkUpdateTickets(sql, "ten_tb", "usr_admin", ["tkt_c"], "assign", "usr_missing"), /not on this network/);

    await bypass();
    const [foreign] = await sql<{ status: string; assigned_to: string }>`select status, assigned_to from tickets where id = 'tkt_x'`;
    assert.equal(foreign?.status, "new");
    assert.equal(foreign?.assigned_to, "");
    const [audit] = await sql<{ n: number }>`
      select count(*)::int as n from audit_logs where tenant_id = 'ten_tb' and entity_id = 'tkt_a' and action like 'ticket.bulk_%'`;
    assert.ok(Number(audit?.n || 0) >= 3);
  } finally {
    await close();
  }
});

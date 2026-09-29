import assert from "node:assert/strict";
import { test } from "node:test";
import { searchOnboardCustomers } from "./onboard-create.ts";
import {
  listTicketCustomerServices,
  nextTicketSearch,
  openStaffTicket,
  queryTicketList,
} from "./tickets.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_td', 'Desk Fibre', 'desk-fibre'), ('ten_x', 'Other', 'other-net')`;
  await sql`insert into customers (id, tenant_id, name, phone, email, account_number) values
    ('cus_john', 'ten_td', 'John Kamau', '0712345678', 'john@example.com', 'CUST-001'),
    ('cus_mary', 'ten_td', 'Mary Wanjiku', '0722456789', 'mary@example.com', 'CUST-002'),
    ('cus_x', 'ten_x', 'John Kamau', '0712345678', 'x@example.com', 'CUST-001')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, active) values
    ('pkg_home', 'ten_td', 'Home Fibre', 'pppoe', 20, 10, 2000, true),
    ('pkg_static', 'ten_td', 'Static', 'static', 10, 10, 3000, true)`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, name) values
    ('svc_home', 'ten_td', 'cus_john', 'pkg_home', 'pppoe', 'john.kamau', '', 'active', 'Home Fibre'),
    ('svc_ip', 'ten_td', 'cus_john', 'pkg_static', 'static', '', '192.168.10.25', 'active', 'Static IP'),
    ('svc_mary', 'ten_td', 'cus_mary', 'pkg_home', 'pppoe', 'mary', '', 'active', 'Home Fibre')`;
  await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values ('usr_james', 'James Otieno', 'james@isp.test', true, now(), now())`;
  await sql`insert into tenant_members (id, tenant_id, user_id, role) values ('mem_james', 'ten_td', 'usr_james', 'technician')`;
  await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, assigned_to, created_at) values
    ('tkt_open', 'ten_td', 'cus_john', 'No internet', 'network', 'high', 'new', '', now()),
    ('tkt_wait', 'ten_td', 'cus_mary', 'Slow speed', 'performance', 'normal', 'waiting', 'usr_james', now() - interval '1 hour'),
    ('tkt_done', 'ten_td', 'cus_john', 'Installation', 'install', 'low', 'resolved', 'usr_james', now() - interval '1 day'),
    ('tkt_other', 'ten_x', 'cus_x', 'No internet', 'network', 'high', 'new', '', now())`;
}

test("ticket search changes return to page 1 and page changes keep filters", () => {
  const base = nextTicketSearch({ status: "open", page: 7, priority: "high" }, { q: "internet" });
  assert.equal(base.page, 1);
  assert.equal(base.q, "internet");
  assert.equal(base.priority, "high");
  assert.equal(base.status, "open");
  const paged = nextTicketSearch(base, { page: 3 }, true);
  assert.equal(paged.page, 3);
  assert.equal(paged.q, "internet");
  assert.equal(paged.priority, "high");
});

test("ticket list is tenant scoped, searchable, filterable, and paged", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    for (let i = 0; i < 21; i += 1) {
      await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status, created_at)
        values (${`tkt_extra_${i}`}, 'ten_td', 'cus_john', ${`Extra ${i}`}, 'network', 'normal', 'assigned', now() - (${i} * interval '1 minute'))`;
    }
    await asRole("ten_td");

    const open = await queryTicketList(sql, "ten_td", {});
    assert.equal(open.counts.all, 24);
    assert.equal(open.counts.resolved, 1);
    assert.equal(open.counts.waiting, 1);
    assert.ok(open.items.every((row) => row.status !== "resolved" && row.status !== "closed"));
    assert.equal(open.items.some((row) => row.id === "tkt_other"), false);
    assert.equal(open.pageSize, 20);
    assert.equal(open.total, 23);
    assert.equal(open.totalPages, 2);
    assert.equal(open.items.length, 20);

    const page2 = await queryTicketList(sql, "ten_td", { page: 2 });
    assert.equal(page2.page, 2);
    assert.equal(page2.items.length, 3);
    assert.equal(new Set([...open.items, ...page2.items].map((row) => row.id)).size, 23);

    const clamped = await queryTicketList(sql, "ten_td", { page: 9, status: "waiting", priority: "normal", assignedTo: "usr_james" });
    assert.equal(clamped.page, 1);
    assert.equal(clamped.total, 1);
    assert.equal(clamped.items[0]?.id, "tkt_wait");

    const byName = await queryTicketList(sql, "ten_td", { status: "all", q: "Mary" });
    assert.deepEqual(byName.items.map((row) => row.id), ["tkt_wait"]);
    const byPhone = await queryTicketList(sql, "ten_td", { status: "all", q: "0712345678", priority: "high" });
    assert.equal(byPhone.items.length, 1);
    assert.equal(byPhone.items[0]?.id, "tkt_open");
    const byAccount = await queryTicketList(sql, "ten_td", { status: "all", q: "CUST-002" });
    assert.equal(byAccount.items[0]?.customer_name, "Mary Wanjiku");
    const byTitle = await queryTicketList(sql, "ten_td", { q: "internet", priority: "high", status: "new" });
    assert.equal(byTitle.total, 1);
    assert.equal(byTitle.items[0]?.title, "No internet");
    const short = await queryTicketList(sql, "ten_td", { q: "n" });
    assert.equal(short.total, open.total);

    const leaked = await queryTicketList(sql, "ten_x", { status: "all" });
    assert.equal(leaked.total, 0);
    assert.equal(leaked.counts.all, 0);

    const found = await searchOnboardCustomers(sql, "ten_td", "John");
    assert.equal(found.length, 1);
    assert.equal(found[0]?.account_number, "CUST-001");
    assert.equal((await searchOnboardCustomers(sql, "ten_td", "0722456789"))[0]?.id, "cus_mary");
    assert.equal((await searchOnboardCustomers(sql, "ten_td", "CUST-001"))[0]?.name, "John Kamau");
    assert.equal((await searchOnboardCustomers(sql, "ten_x", "John")).length, 0);
    for (let i = 0; i < 9; i += 1) {
      await sql`insert into customers (id, tenant_id, name, phone, account_number)
        values (${`cus_j${i}`}, 'ten_td', ${`John Extra ${i}`}, ${`073300000${i}`}, ${`CUST-1${i}`})`;
    }
    const limited = await searchOnboardCustomers(sql, "ten_td", "John");
    assert.equal(limited.length, 8);
    assert.equal(limited.some((row) => row.id === "cus_x"), false);

    const services = await listTicketCustomerServices(sql, "ten_td", "cus_john");
    assert.deepEqual(services.map((row) => row.id).sort(), ["svc_home", "svc_ip"]);
    assert.equal(services.find((row) => row.id === "svc_ip")?.static_ip, "192.168.10.25");
    assert.equal((await listTicketCustomerServices(sql, "ten_td", "cus_x")).length, 0);

    await assert.rejects(() => openStaffTicket(sql, "ten_td", { title: "X", category: "network", priority: "normal" }), /customer/i);
    await assert.rejects(
      () => openStaffTicket(sql, "ten_td", { title: "X", category: "network", priority: "normal", customer_id: "cus_x" }),
      /not found/i,
    );
    await assert.rejects(
      () =>
        openStaffTicket(sql, "ten_td", {
          title: "X",
          category: "network",
          priority: "normal",
          customer_id: "cus_john",
          service_id: "svc_mary",
        }),
      /does not belong/i,
    );
    const opened = await openStaffTicket(sql, "ten_td", {
      title: "  Router down  ",
      category: "network",
      priority: "urgent",
      customer_id: "cus_john",
      service_id: "svc_home",
      assigned_to: "usr_james",
    });
    const [row] = await sql<{ title: string; status: string; service_id: string; customer_id: string }>`
      select title, status, service_id, customer_id from tickets where id = ${opened.id}`;
    assert.equal(row?.title, "Router down");
    assert.equal(row?.status, "assigned");
    assert.equal(row?.service_id, "svc_home");
    assert.equal(row?.customer_id, "cus_john");
  } finally {
    await close();
  }
});

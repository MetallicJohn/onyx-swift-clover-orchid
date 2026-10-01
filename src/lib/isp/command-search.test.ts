import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { searchWorkspace } from "./server-search.ts";
import { openTestDb } from "./test-db.ts";

function walk(dir: string, hits: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, hits);
    else if (/\.(tsx|ts|mjs|js)$/.test(name)) hits.push(path);
  }
}

test("command search opens the record for each workspace entity", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_cs', 'Search', 'search-net'), ('ten_cs2', 'Other', 'search-other')`;
    await sql`insert into customers (id, tenant_id, name, phone, account_number) values
      ('cus_cs', 'ten_cs', 'John Kamau', '0712000001', 'ACC-1'),
      ('cus_hide', 'ten_cs2', 'John Kamau', '0712000001', 'ACC-1')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes) values
      ('pkg_cs', 'ten_cs', '10 Mbps', 'pppoe', 10, 5, 3500)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status) values
      ('svc_cs', 'ten_cs', 'cus_cs', 'pkg_cs', 'pppoe', 'john.kamau', 'active')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date) values
      ('inv_cs', 'ten_cs', 'cus_cs', 'INV-2026-00451', 3500, 'overdue', '2026-10-01')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at) values
      ('pay_cs', 'ten_cs', 'cus_cs', 'inv_cs', 'mpesa', 3500, 'QWE123456', 'confirmed', now())`;
    await sql`insert into leads (id, tenant_id, lead_number, name, phone, interested_package_id) values
      ('led_cs', 'ten_cs', 'LD-000124', 'Jane Wanjiku', '0712000009', 'pkg_cs')`;
    await sql`insert into routers (id, tenant_id, name, location) values ('rtr_cs', 'ten_cs', 'Nanyuki Core', 'Nanyuki')`;
    await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status) values
      ('tkt_cs', 'ten_cs', 'cus_cs', 'No internet at Kamau', 'network', 'high', 'new')`;
    await asRole("ten_cs");

    const hits = await searchWorkspace(sql, "ten_cs", "isp_admin", "Kamau");
    const byGroup = Object.fromEntries(hits.map((hit) => [hit.group, hit]));
    assert.equal(byGroup.Customers?.href, "/app/customers/cus_cs");
    assert.equal(byGroup.Services?.href, "/app/services/svc_cs");
    assert.match(byGroup.Services?.label || "", /10 Mbps/);
    assert.equal(byGroup.Invoices?.href, "/app/billing/invoices/inv_cs");
    assert.match(byGroup.Invoices?.hint || "", /3,500/);
    assert.equal(byGroup.Tickets?.href, "/app/tickets/tkt_cs");
    assert.equal(hits.some((hit) => hit.id === "cus_hide"), false);

    const lead = await searchWorkspace(sql, "ten_cs", "isp_admin", "LD-000124");
    assert.equal(lead.find((hit) => hit.group === "Leads")?.href, "/app/leads/led_cs");

    const payment = await searchWorkspace(sql, "ten_cs", "isp_admin", "QWE123456");
    assert.equal(payment.find((hit) => hit.group === "Payments")?.href, "/app/billing/payments/pay_cs");

    const router = await searchWorkspace(sql, "ten_cs", "isp_admin", "Nanyuki");
    assert.equal(router.find((hit) => hit.group === "Routers")?.href, "/app/routers/rtr_cs");

    const tech = await searchWorkspace(sql, "ten_cs", "technician", "QWE123456");
    assert.equal(tech.some((hit) => hit.group === "Payments"), false);
    assert.equal(tech.some((hit) => hit.group === "Routers"), false);
  } finally {
    await close();
  }
});

test("application screens do not use native confirm or prompt", () => {
  const root = new URL("../../", import.meta.url);
  const files: string[] = [];
  walk(new URL(".", root).pathname.replace(/lib\/$/, ""), files);
  const src = files.filter((file) => file.includes("/src/"));
  assert.ok(src.length > 20);
  for (const file of src) {
    const text = readFileSync(file, "utf8");
    assert.doesNotMatch(text, /window\.prompt\s*\(/, file);
    assert.doesNotMatch(text, /window\.confirm\s*\(/, file);
  }
  const desk = readFileSync(new URL("../../components/isp/acs-device-desk.tsx", import.meta.url), "utf8");
  assert.match(desk, /Factory reset CPE/);
  assert.match(desk, /confirmPhrase: "RESET"/);
  assert.match(desk, /pendingLabel: "Resetting\.\.\."/);
  assert.match(desk, /action: async/);
  const guard = readFileSync(new URL("../../components/ui/unsaved-guard.tsx", import.meta.url), "utf8");
  assert.match(guard, /askConfirm/);
  assert.match(guard, /enableBeforeUnload/);
  assert.match(guard, /Unsaved changes/);
  assert.doesNotMatch(guard, /window\.confirm/);
  const dialog = readFileSync(new URL("../../components/ui/confirm-dialog.tsx", import.meta.url), "utf8");
  assert.match(dialog, /phase === "loading"/);
  assert.match(dialog, /Try again|confirmButtonLabel/);
  assert.match(dialog, /confirmCanDismiss/);
});

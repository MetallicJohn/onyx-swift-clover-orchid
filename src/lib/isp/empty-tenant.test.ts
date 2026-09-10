import assert from "node:assert/strict";
import { test } from "node:test";
import { emptySeededTenantsCreatedOn, emptyTenantBusinessData, nairobiDate } from "./empty-tenant.ts";
import { openTestDb } from "./test-db.ts";

test("nairobiDate is YYYY-MM-DD in East Africa", () => {
  assert.equal(nairobiDate(new Date("2026-09-10T21:30:00+03:00")), "2026-09-10");
  assert.equal(nairobiDate(new Date("2026-09-10T23:30:00+00:00")), "2026-09-11");
});

test("emptying a tenant created today drops customers and invoices, keeps the login workspace", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, demo_seeded, created_at)
      values ('ten_today', 'Fresh', 'fresh', true, now())`;
    await sql`insert into customers (id, tenant_id, name, phone)
      values ('cus_today', 'ten_today', 'Amina Wanjiku', '0712001001')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_today', 'ten_today', 'Home 10', 'pppoe', 10, 10, 2500)`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_today', 'ten_today', 'cus_today', 'INV-1042', 2500, 'issued', '2026-09-30')`;

    const result = await emptySeededTenantsCreatedOn(sql, "ten_today");
    assert.equal(result.emptied, true);
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_today'`;
    const [inv] = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = 'ten_today'`;
    const [pkg] = await sql<{ n: number }>`select count(*)::int as n from packages where tenant_id = 'ten_today'`;
    const [ten] = await sql<{ demo_seeded: boolean }>`select demo_seeded from tenants where id = 'ten_today'`;
    assert.equal(cus?.n, 0);
    assert.equal(inv?.n, 0);
    assert.equal(pkg?.n, 0);
    assert.equal(ten?.demo_seeded, false);

    const again = await emptySeededTenantsCreatedOn(sql, "ten_today");
    assert.equal(again.emptied, false);
  } finally {
    await close();
  }
});

test("tenants created on another day are left alone", async () => {
  const { sql, bypass, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, demo_seeded, created_at)
      values ('ten_old', 'Old', 'old', true, '2026-09-01T08:00:00+03:00')`;
    await sql`insert into customers (id, tenant_id, name) values ('cus_old', 'ten_old', 'Keep me')`;
    const result = await emptySeededTenantsCreatedOn(sql, "ten_old", nairobiDate());
    assert.equal(result.emptied, false);
    const [cus] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_old'`;
    assert.equal(cus?.n, 1);
    await emptyTenantBusinessData(sql, "ten_old");
  } finally {
    await close();
  }
});

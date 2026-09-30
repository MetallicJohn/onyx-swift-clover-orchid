import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLatitude, parseLongitude } from "./leads-format.ts";
import {
  convertLead,
  createLead,
  findLeadCustomerMatches,
  getLead,
  listLeads,
  recordInstallation,
  setLeadStatus,
  updateLead,
} from "./leads.ts";
import { canAccessAppPath, hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

test("GPS coordinates stay numeric and reject out-of-range values", () => {
  assert.equal(parseLatitude("0.016947"), 0.016947);
  assert.equal(parseLongitude("37.072811"), 37.072811);
  assert.equal(parseLatitude(""), null);
  assert.throws(() => parseLatitude(91), /90/);
  assert.throws(() => parseLongitude(-181), /180/);
});

test("lead permissions stay separate from customer access", () => {
  assert.equal(hasPermission("customer_care", "leads.create"), true);
  assert.equal(hasPermission("customer_care", "leads.convert"), false);
  assert.equal(hasPermission("technician", "leads.installation"), true);
  assert.equal(hasPermission("technician", "leads.convert"), false);
  assert.equal(hasPermission("isp_owner", "leads.convert"), true);
  assert.equal(canAccessAppPath("technician", "/app/leads"), true);
});

test("creating leads does not change the customer count, including a batch of 100", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_ld', 'Lead ISP', 'lead-isp')`;
    await asRole("ten_ld");
    const before = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_ld'`;
    await createLead(sql, { tenantId: "ten_ld", actorId: "usr_1", input: { name: "Amina Fibre", phone: "0712000101", area: "Westlands" } });
    for (let i = 0; i < 100; i += 1) {
      const phone = `0712${String(100000 + i).slice(0, 6)}`;
      await createLead(sql, { tenantId: "ten_ld", actorId: "usr_1", input: { name: `Batch ${i}`, phone } });
    }
    const after = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_ld'`;
    assert.equal(before[0]?.n ?? 0, 0);
    assert.equal(after[0]?.n ?? 0, 0);
    const found = await listLeads(sql, "ten_ld", { q: "westlands" });
    assert.equal(found.total >= 1, true);
    assert.equal(found.rows.some((row) => row.name === "Amina Fibre"), true);
  } finally {
    await close();
  }
});

test("convert creates a customer and service, reuses an existing customer, and rolls back a failed conversion", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_cv', 'Convert ISP', 'convert-isp'), ('ten_other', 'Other', 'other-leads')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_cv', 'ten_cv', '10 Mbps', 'pppoe', 10, 10, 2000)`;
    await sql`insert into customers (id, tenant_id, name, phone, email, account_number)
      values ('cus_old', 'ten_cv', 'Existing Home', '0712000888', 'old@example.com', 'CUSOLD')`;
    await asRole("ten_cv");

    const fresh = await createLead(sql, {
      tenantId: "ten_cv",
      actorId: "usr_1",
      input: {
        name: "New Install",
        phone: "0712000777",
        email: "new@example.com",
        area: "Kilimani",
        interested_package_id: "pkg_cv",
        latitude: 0.016947,
        longitude: 37.072811,
      },
    });
    assert.equal(fresh.lead_number, "LD-000001");
    assert.equal(fresh.latitude, 0.016947);
    const edited = await updateLead(sql, {
      tenantId: "ten_cv",
      actorId: "usr_1",
      leadId: fresh.id,
      input: {
        name: "New Install",
        phone: "0712000777",
        email: "new@example.com",
        area: "Kilimani",
        town: "Nairobi",
        interested_package_id: "pkg_cv",
        latitude: 0.016947,
        longitude: 37.072811,
      },
    });
    assert.equal(edited.town, "Nairobi");
    await assert.rejects(
      () => convertLead(sql, { tenantId: "ten_cv", tenantName: "Convert ISP", actorId: "usr_1", leadId: fresh.id, sendNotification: false }),
      /installation completed/,
    );
    await recordInstallation(sql, { tenantId: "ten_cv", actorId: "usr_1", leadId: fresh.id, installation_status: "completed" });
    await assert.rejects(
      () => convertLead(sql, { tenantId: "ten_cv", tenantName: "Convert ISP", actorId: "usr_1", leadId: fresh.id, sendNotification: false }),
      /Confirm the conversion/,
    );
    const converted = await convertLead(sql, {
      tenantId: "ten_cv",
      tenantName: "Convert ISP",
      actorId: "usr_1",
      leadId: fresh.id,
      sendNotification: false,
      confirmed: true,
      canActivateNow: true,
      canOverrideExpiry: true,
    });
    assert.ok(converted.customer_id);
    assert.ok(converted.service_id);
    assert.equal(converted.lead?.conversion_status, "converted");
    assert.equal(converted.lead?.customer_id, converted.customer_id);
    const [placed] = await sql<{ address: string }>`select address from customers where id = ${converted.customer_id}`;
    assert.match(placed?.address || "", /0\.016947/);
    assert.match(placed?.address || "", /37\.072811/);
    const [customers] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_cv' and deleted_at is null`;
    assert.equal(customers?.n, 2);
    const [svc] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = 'ten_cv' and customer_id = ${converted.customer_id}`;
    assert.equal(svc?.n, 1);
    const detail = await getLead(sql, "ten_cv", fresh.id);
    assert.equal(detail.activities.some((a) => a.activity_type === "CONVERSION"), true);
    const [audit] = await sql<{ details: string }>`select details from audit_logs where tenant_id = 'ten_cv' and action = 'lead.converted'`;
    assert.match(audit?.details || "", new RegExp(converted.customer_id));

    const again = await createLead(sql, {
      tenantId: "ten_cv",
      actorId: "usr_1",
      input: { name: "Second Line", phone: "0712000888", interested_package_id: "pkg_cv" },
    });
    await recordInstallation(sql, { tenantId: "ten_cv", actorId: "usr_1", leadId: again.id, installation_status: "completed" });
    const matches = await findLeadCustomerMatches(sql, "ten_cv", again);
    assert.equal(matches.some((m) => m.id === "cus_old" && m.blocking), true);
    await assert.rejects(
      () => convertLead(sql, { tenantId: "ten_cv", tenantName: "Convert ISP", actorId: "usr_1", leadId: again.id, sendNotification: false, confirmed: true }),
      /Existing customer/,
    );
    const reused = await convertLead(sql, {
      tenantId: "ten_cv",
      tenantName: "Convert ISP",
      actorId: "usr_1",
      leadId: again.id,
      useCustomerId: "cus_old",
      sendNotification: false,
      confirmed: true,
      canActivateNow: true,
      canOverrideExpiry: true,
    });
    assert.equal(reused.customer_id, "cus_old");
    assert.ok(reused.service_id);
    const [afterReuse] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_cv' and deleted_at is null`;
    assert.equal(afterReuse?.n, 2);
    const [servicesBeforeLink] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = 'ten_cv' and customer_id = 'cus_old'`;
    const linkOnly = await createLead(sql, {
      tenantId: "ten_cv",
      actorId: "usr_1",
      input: { name: "Existing Home", phone: "0712000888" },
    });
    await recordInstallation(sql, { tenantId: "ten_cv", actorId: "usr_1", leadId: linkOnly.id, installation_status: "completed" });
    const linked = await convertLead(sql, {
      tenantId: "ten_cv",
      tenantName: "Convert ISP",
      actorId: "usr_1",
      leadId: linkOnly.id,
      useCustomerId: "cus_old",
      sendNotification: false,
      confirmed: true,
    });
    assert.equal(linked.customer_id, "cus_old");
    assert.equal(linked.service_id, null);
    const [servicesAfterLink] = await sql<{ n: number }>`select count(*)::int as n from services where tenant_id = 'ten_cv' and customer_id = 'cus_old'`;
    assert.equal(servicesAfterLink?.n, servicesBeforeLink?.n);

    const broken = await createLead(sql, {
      tenantId: "ten_cv",
      actorId: "usr_1",
      input: { name: "Will Fail", phone: "0712000666", interested_package_id: "pkg_cv" },
    });
    await recordInstallation(sql, { tenantId: "ten_cv", actorId: "usr_1", leadId: broken.id, installation_status: "completed" });
    const beforeFail = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_cv'`;
    await assert.rejects(
      () =>
        convertLead(sql, {
          tenantId: "ten_cv",
          tenantName: "Convert ISP",
          actorId: "usr_1",
          leadId: broken.id,
          onboardingType: "continuing",
          expiryYmd: "",
          sendNotification: false,
          confirmed: true,
          canOverrideExpiry: true,
        }),
      /expiry|Customer saved|Service failed/i,
    );
    const afterFail = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_cv'`;
    assert.equal(afterFail[0]?.n, beforeFail[0]?.n);
    const still = await getLead(sql, "ten_cv", broken.id);
    assert.equal(still.lead.conversion_status, "open");
    assert.equal(still.lead.customer_id, null);

    const lost = await createLead(sql, { tenantId: "ten_cv", actorId: "usr_1", input: { name: "Lost One", phone: "0712000555" } });
    await setLeadStatus(sql, { tenantId: "ten_cv", actorId: "usr_1", leadId: lost.id, status: "lost", lost_reason: "Price" });
    const [finalCount] = await sql<{ n: number }>`select count(*)::int as n from customers where tenant_id = 'ten_cv' and deleted_at is null`;
    assert.equal(finalCount?.n, afterReuse?.n);

    await asRole("ten_other");
    await assert.rejects(() => getLead(sql, "ten_cv", fresh.id), /not found|permission|row-level/i);
    const hidden = await listLeads(sql, "ten_other", {});
    assert.equal(hidden.total, 0);
  } finally {
    await close();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { generateRecurringInvoices } from "./billing.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { createOnboard } from "./onboard-create.ts";
import { confirmCustomerImport, previewCustomerImport } from "./onboard-import.ts";
import {
  importTemplateCsv,
  parseDelimitedText,
  parseFlexibleYmd,
  previewImportRow,
  suggestColumnMap,
} from "./onboard-import-format.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, billing_interval, validity_hours, active)
    values
      ('pkg_home', 'ten_a', 'Home 10', 'pppoe', 10, 5, 2500, 'monthly', 0, true),
      ('pkg_biz', 'ten_a', 'Business 50', 'pppoe', 50, 50, 8000, 'monthly', 0, true)`;
}

test("import dates accept YYYY-MM-DD and dd/mm/yy", () => {
  assert.equal(parseFlexibleYmd("2026-09-30"), "2026-09-30");
  assert.equal(parseFlexibleYmd("30/09/26"), "2026-09-30");
  assert.equal(parseFlexibleYmd("30/09/2026"), "2026-09-30");
  assert.throws(() => parseFlexibleYmd("32/13/26"));
  assert.throws(() => parseFlexibleYmd("not-a-date"));
});

test("CSV parser and column aliases map expiry to first renewal", () => {
  const csv = importTemplateCsv();
  const parsed = parseDelimitedText(csv);
  assert.ok(parsed.headers.includes("subscription_expiry_date"));
  const map = suggestColumnMap(parsed.headers);
  assert.equal(map.subscription_expiry_date, "subscription_expiry_date");
  const quoted = parseDelimitedText('name,phone\n"Acme, Ltd",0700111222');
  assert.equal(quoted.rows[0]?.[0], "Acme, Ltd");
  const preview = previewImportRow(
    2,
    {
      name: "Acme Ltd",
      phone: "0700111222",
      email: "",
      address: "",
      account_number: "",
      access_method: "pppoe",
      package_name: "Business 50",
      username: "acme.pppoe",
      static_ip: "",
      router: "",
      pppoe_password: "",
      subscription_start_date: "01/09/26",
      subscription_expiry_date: "30/09/26",
      billing_anchor_date: "",
      onboarding_type: "continuing",
      send_onboarding_notification: "",
    },
    { mode: "continuing", packages: [{ name: "Business 50", access_method: "pppoe", active: true }] },
  );
  assert.equal(preview.expiry_ymd, "2026-09-30");
  assert.equal(preview.first_renewal_ymd, "2026-09-30");
  assert.equal(preview.send_onboarding_notification, false);
  assert.equal(preview.errors.length, 0);
  const missing = previewImportRow(
    3,
    {
      name: "Jane",
      phone: "0700222333",
      email: "",
      address: "",
      account_number: "",
      access_method: "pppoe",
      package_name: "Home 10",
      username: "",
      static_ip: "",
      router: "",
      pppoe_password: "",
      subscription_start_date: "",
      subscription_expiry_date: "",
      billing_anchor_date: "",
      onboarding_type: "continuing",
      send_onboarding_notification: "",
    },
    { mode: "continuing", packages: [{ name: "Home 10", access_method: "pppoe", active: true }] },
  );
  assert.ok(missing.errors.some((e) => e.field === "subscription_expiry_date"));
});

test("continuing onboard stores the selected expiry as the billing anchor and does not invoice or SMS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const created = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      canActivateNow: false,
      input: {
        customer_mode: "new",
        include_service: true,
        customer: {
          name: "Acme Ltd",
          phone: "0712888101",
          email: "net@acme.ke",
          address: "Industrial Area",
          type: "business",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_biz",
          username: "acme.pppoe",
          auto_username: false,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "2026-09-30",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
          onboarding_type: "continuing",
          subscription_start_ymd: "2026-09-01",
          send_onboarding_notification: false,
          import_source: "csv",
        },
      },
    });
    assert.ok(created.service_id);
    assert.equal(created.invoice_id, null);
    assert.equal(created.status, "active");
    const [svc] = await sql<{
      period_end: string;
      expiry_source: string;
      billing_anchor_date: string | null;
      onboarding_type: string;
      send_onboarding_notification: boolean;
      username: string | null;
    }>`select period_end::text as period_end, expiry_source, billing_anchor_date::text as billing_anchor_date,
             onboarding_type, send_onboarding_notification, username
       from services where id = ${created.service_id}`;
    assert.equal(svc?.onboarding_type, "continuing");
    assert.equal(svc?.expiry_source, "billing");
    assert.equal((svc?.billing_anchor_date || "").slice(0, 10), "2026-09-30");
    assert.equal(nairobiDate(svc?.period_end || ""), "2026-09-30");
    assert.equal(svc?.send_onboarding_notification, false);
    assert.equal(svc?.username, "acme.pppoe");
    const invoices = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = 'ten_a'`;
    assert.equal(invoices[0]?.n, 0);
    const sms = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = 'ten_a'`;
    assert.equal(sms[0]?.n, 0);
    const cmds = await sql<{ n: number }>`select count(*)::int as n from agent_commands where tenant_id = 'ten_a'`;
    assert.equal(cmds[0]?.n, 0);

    const early = await generateRecurringInvoices(sql, "ten_a", new Date("2026-09-17T10:00:00+03:00"));
    assert.equal(early.length, 0);
    const first = await generateRecurringInvoices(sql, "ten_a", new Date("2026-09-30T10:00:00+03:00"));
    assert.equal(first.length, 1);
    assert.equal(first[0]?.dueDate, "2026-09-30");
    assert.equal(first[0]?.serviceId, created.service_id);
    const [inv] = await sql<{ due_date: string; amount_kes: number }>`
      select due_date::text as due_date, amount_kes from invoices where id = ${first[0]!.id}`;
    assert.equal((inv?.due_date || "").slice(0, 10), "2026-09-30");
    assert.equal(inv?.amount_kes, 8000);
    const [stamp] = await sql<{ first_renewal_invoiced_at: string | null }>`
      select first_renewal_invoiced_at::text as first_renewal_invoiced_at from services where id = ${created.service_id}`;
    assert.ok(stamp?.first_renewal_invoiced_at);
    const again = await generateRecurringInvoices(sql, "ten_a", new Date("2026-09-30T18:00:00+03:00"));
    assert.equal(again.length, 0);
    await sql`update invoices set status = 'paid', paid_kes = amount_kes, issued_at = '2026-09-30T07:00:00Z' where id = ${first[0]!.id}`;
    const tooSoon = await generateRecurringInvoices(sql, "ten_a", new Date("2026-10-05T10:00:00+03:00"));
    assert.equal(tooSoon.length, 0);
    const next = await generateRecurringInvoices(sql, "ten_a", new Date("2026-10-30T10:00:00+03:00"));
    assert.equal(next.length, 1);
  } finally {
    await close();
  }
});

test("new customer onboarding still invoices and is unchanged", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const created = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "new",
        include_service: true,
        customer: {
          name: "Jane Muthoni",
          phone: "0712888102",
          email: "",
          address: "",
          type: "individual",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
          username: "",
          auto_username: true,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "",
          activation: "after_payment",
          notes: "",
          hotspot_mode: "account",
          onboarding_type: "new",
          subscription_start_ymd: "",
          send_onboarding_notification: true,
        },
      },
    });
    assert.ok(created.invoice_id);
    assert.equal(created.status, "pending");
    const [svc] = await sql<{ billing_anchor_date: string | null; onboarding_type: string }>`
      select billing_anchor_date::text as billing_anchor_date, onboarding_type from services where id = ${created.service_id}`;
    assert.equal(svc?.onboarding_type, "new");
    assert.equal(svc?.billing_anchor_date, null);
  } finally {
    await close();
  }
});

test("bulk import preview and extra-service isolation keep the other line's expiry", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    const first = await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "new",
        include_service: true,
        customer: {
          name: "Acme Ltd",
          phone: "0712888103",
          email: "",
          address: "",
          type: "business",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
          username: "acme.one",
          auto_username: false,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "2026-09-30",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
          onboarding_type: "continuing",
          subscription_start_ymd: "",
          send_onboarding_notification: false,
        },
      },
    });
    const csv = [
      "name,phone,package_name,username,subscription_expiry_date,onboarding_type",
      "Acme Ltd,0712888103,Business 50,acme.two,15/10/26,continuing",
      "No Name,0712888104,Home 10,bad.user,,continuing",
    ].join("\n");
    const preview = await previewCustomerImport(sql, "ten_a", { text: csv, mode: "continuing" });
    assert.equal(preview.ready_count, 1);
    assert.equal(preview.error_count, 1);
    assert.equal(preview.ready[0]?.first_renewal_ymd, "2026-10-15");
    assert.equal(preview.ready[0]?.attach_customer_id, first.customer_id);
    const confirmed = await confirmCustomerImport(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: { text: csv, mode: "continuing" },
    });
    assert.equal(confirmed.attached, 1);
    assert.equal(confirmed.created, 0);
    const lines = await sql<{ id: string; username: string | null; period_end: string; billing_anchor_date: string | null }>`
      select id, username, period_end::text as period_end, billing_anchor_date::text as billing_anchor_date
      from services where customer_id = ${first.customer_id} and deleted_at is null order by created_at`;
    assert.equal(lines.length, 2);
    const original = lines.find((l) => l.id === first.service_id);
    const extra = lines.find((l) => l.id !== first.service_id);
    assert.equal(nairobiDate(original?.period_end || ""), "2026-09-30");
    assert.equal(nairobiDate(extra?.period_end || ""), "2026-10-15");
    assert.equal((extra?.billing_anchor_date || "").slice(0, 10), "2026-10-15");
    assert.notEqual(extra?.username, original?.username);
    const invoices = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = 'ten_a'`;
    assert.equal(invoices[0]?.n, 0);
  } finally {
    await close();
  }
});

test("duplicate username is skipped and does not overwrite", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_a");
    await createOnboard(sql, {
      tenantId: "ten_a",
      tenantName: "Alpha",
      actorId: "usr_staff",
      input: {
        customer_mode: "new",
        include_service: true,
        customer: {
          name: "Jane",
          phone: "0712888105",
          email: "",
          address: "",
          type: "individual",
          tag_ids: [],
          account_number: "",
          notes: "",
          portal_password: "",
        },
        service: {
          access_method: "pppoe",
          package_id: "pkg_home",
          username: "jane.pppoe",
          auto_username: false,
          static_ip: "",
          pool_id: "",
          router_id: "",
          mac_address: "",
          cpe_id: "",
          expiry_ymd: "2026-10-01",
          activation: "active",
          notes: "",
          hotspot_mode: "account",
          onboarding_type: "continuing",
          subscription_start_ymd: "",
          send_onboarding_notification: false,
        },
      },
    });
    const csv = [
      "name,phone,package_name,username,subscription_expiry_date,onboarding_type",
      "Clone,0712888106,Home 10,jane.pppoe,20/10/26,continuing",
    ].join("\n");
    const preview = await previewCustomerImport(sql, "ten_a", { text: csv, mode: "continuing" });
    assert.equal(preview.ready_count, 0);
    assert.ok(preview.rows[0]?.errors.some((e) => /username/i.test(e.message)));
  } finally {
    await close();
  }
});

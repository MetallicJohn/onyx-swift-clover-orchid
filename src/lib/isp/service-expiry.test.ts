import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAccessPolicy } from "./access-policy.ts";
import { authorizeRadius } from "./radius-rest.ts";
import { assertPermission, hasPermission } from "./rbac.ts";
import {
  STAFF_EXPIRY_REASON,
  STAFF_EXPIRY_SOURCE,
  isPastNairobiDate,
  parseExpiryYmd,
  setServiceExpiry,
} from "./service-expiry.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { openTestDb } from "./test-db.ts";

test("Nairobi calendar dates last until end of the selected day", () => {
  const { ymd, accessUntil } = parseExpiryYmd("2026-09-13");
  assert.equal(ymd, "2026-09-13");
  assert.equal(nairobiDate(accessUntil), "2026-09-13");
  assert.equal(isPastNairobiDate("1999-01-01", new Date("2026-09-13T10:00:00+03:00")), true);
  assert.equal(isPastNairobiDate("2026-09-13", new Date("2026-09-13T10:00:00+03:00")), false);
  assert.throws(() => parseExpiryYmd("13/09/2026"), /valid calendar date/);
  assert.throws(() => parseExpiryYmd("2026-02-31"), /valid calendar date/);
  assert.throws(() => parseExpiryYmd(""), /valid calendar date/);
});

async function seed(
  sql: Awaited<ReturnType<typeof openTestDb>>["sql"],
  opts?: { status?: string; reason?: string; bundle?: number; used?: number; method?: string },
) {
  const method = opts?.method ?? "pppoe";
  await sql`insert into tenants (id, name, slug) values ('ten_ex', 'Expiry', 'expiry')`;
  await sql`insert into customers (id, tenant_id, name, phone, account_number)
    values ('cus_ex', 'ten_ex', 'Amina Wanjiku', '0712001001', 'A1001')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days, bundle_mb)
    values ('pkg_ex', 'ten_ex', 'Home 10', ${method}, 10, 5, 2500, 2, ${opts?.bundle ?? 0})`;
  const paid = new Date(Date.now() + 14 * 86400_000).toISOString();
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, suspend_reason, bundle_used_mb)
    values ('svc_ex', 'ten_ex', 'cus_ex', 'pkg_ex', ${method}, 'amina', ${opts?.status ?? "active"}, ${paid}, ${opts?.reason ?? ""}, ${opts?.used ?? 0})`;
  await sql`insert into radius_accounts (id, tenant_id, service_id, username, password, enabled)
    values ('rad_ex', 'ten_ex', 'svc_ex', 'amina', 'secret', true)`;
  await sql`insert into routers (id, tenant_id, name) values ('rtr_ex', 'ten_ex', 'edge-01')`;
  return paid;
}

async function countQuiet(
  sql: Awaited<ReturnType<typeof openTestDb>>["sql"],
) {
  const [inv] = await sql<{ n: number }>`select count(*)::int as n from invoices where tenant_id = 'ten_ex'`;
  const [pay] = await sql<{ n: number }>`select count(*)::int as n from payments where tenant_id = 'ten_ex'`;
  const [intents] = await sql<{ n: number }>`select count(*)::int as n from payment_intents where tenant_id = 'ten_ex'`;
  const [notes] = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = 'ten_ex'`;
  const [mail] = await sql<{ n: number }>`select count(*)::int as n from email_outbox where tenant_id = 'ten_ex'`;
  const [campaigns] = await sql<{ n: number }>`select count(*)::int as n from comm_campaigns where tenant_id = 'ten_ex'`;
  const [recipients] = await sql<{ n: number }>`select count(*)::int as n from comm_recipients where tenant_id = 'ten_ex'`;
  return {
    invoices: inv?.n ?? 0,
    payments: pay?.n ?? 0,
    intents: intents?.n ?? 0,
    notes: notes?.n ?? 0,
    mail: mail?.n ?? 0,
    campaigns: campaigns?.n ?? 0,
    recipients: recipients?.n ?? 0,
  };
}

test("past date suspends without billing or customer messages", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    const paid = await seed(sql);
    await asRole("ten_ex");
    const before = await countQuiet(sql);
    const [pkgBefore] = await sql<{ price_kes: number; billing_interval: string }>`
      select price_kes, billing_interval from packages where id = 'pkg_ex'`;
    const out = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: "2020-01-15",
      reason: "Line already offline at the premises",
      actorId: "user_staff",
      actorLabel: "Faith",
    });
    assert.equal(out.status, "suspended");
    assert.equal(out.suspend_reason, STAFF_EXPIRY_REASON);
    assert.equal(out.trigger_billing, false);
    assert.equal(out.send_customer_notifications, false);
    assert.equal(out.source, STAFF_EXPIRY_SOURCE);
    assert.equal(new Date(out.period_end ?? 0).toISOString(), new Date(paid).toISOString());
    const [row] = await sql<{ status: string; period_end: string; expiry_source: string; suspend_reason: string }>`
      select status, period_end::text as period_end, expiry_source, suspend_reason from services where id = 'svc_ex'`;
    assert.equal(row?.status, "suspended");
    assert.equal(row?.expiry_source, "staff");
    assert.equal(row?.suspend_reason, STAFF_EXPIRY_REASON);
    assert.equal(new Date(row?.period_end ?? 0).toISOString(), new Date(paid).toISOString());
    const after = await countQuiet(sql);
    assert.deepEqual(after, before);
    const [pkgAfter] = await sql<{ price_kes: number; billing_interval: string }>`
      select price_kes, billing_interval from packages where id = 'pkg_ex'`;
    assert.equal(pkgAfter?.price_kes, pkgBefore?.price_kes);
    assert.equal(pkgAfter?.billing_interval, pkgBefore?.billing_interval);
    const [aud] = await sql<{ details: string; action: string }>`
      select details, action from audit_logs where tenant_id = 'ten_ex' and action = 'service.expiry.update'`;
    assert.equal(aud?.action, "service.expiry.update");
    assert.match(aud?.details || "", /staff_expiry_date_change/);
    assert.match(aud?.details || "", /"trigger_billing":false/);
    assert.match(aud?.details || "", /"send_customer_notifications":false/);
    const auth = await authorizeRadius(sql, "ten_ex", { username: "amina" });
    assert.equal(auth.result, "reject");
  } finally {
    await close();
  }
});

test("today and future dates restore unless another block applies", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql, { status: "suspended", reason: "time" });
    await asRole("ten_ex");
    const today = nairobiDate();
    const restored = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: today,
      reason: "Customer still on the network today",
      actorId: "user_staff",
    });
    assert.equal(restored.status, "active");
    assert.equal(restored.suspend_reason, "");
    const auth = await authorizeRadius(sql, "ten_ex", { username: "amina" });
    assert.equal(auth.result, "accept");
    const future = nairobiDate(new Date(Date.now() + 5 * 86400_000));
    const again = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Temporary access until next visit",
      actorId: "user_staff",
    });
    assert.equal(again.status, "active");
    const quiet = await countQuiet(sql);
    assert.equal(quiet.notes, 0);
    assert.equal(quiet.mail, 0);
    assert.equal(quiet.campaigns, 0);
    assert.equal(quiet.payments, 0);
    assert.equal(quiet.invoices, 0);
  } finally {
    await close();
  }
});

test("independent suspension conditions are not overridden", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql, { status: "suspended", reason: "manual" });
    await asRole("ten_ex");
    const future = nairobiDate(new Date(Date.now() + 86400_000));
    const manual = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Keep admin hold",
      actorId: "user_staff",
    });
    assert.equal(manual.status, "suspended");
    assert.equal(manual.suspend_reason, "manual");

    await bypass();
    await sql`update services set suspend_reason = 'time', bundle_used_mb = 10 where id = 'svc_ex'`;
    await sql`update packages set bundle_mb = 5 where id = 'pkg_ex'`;
    await asRole("ten_ex");
    const capped = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Bundle still used up",
      actorId: "user_staff",
    });
    assert.equal(capped.status, "suspended");
    assert.equal(capped.suspend_reason, "bundle");

    await bypass();
    await sql`update services set bundle_used_mb = 0, suspend_reason = 'invoice' where id = 'svc_ex'`;
    await sql`update packages set bundle_mb = 0 where id = 'pkg_ex'`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_ex', 'ten_ex', 'cus_ex', 'INV-EX', 2500, 'overdue', '2020-01-01')`;
    await asRole("ten_ex");
    const unpaid = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Invoice still unpaid",
      actorId: "user_staff",
    });
    assert.equal(unpaid.status, "suspended");
    assert.equal(unpaid.suspend_reason, "invoice");
  } finally {
    await close();
  }
});

test("terminated services stay terminated", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql, { status: "terminated", reason: "terminated" });
    await asRole("ten_ex");
    const future = nairobiDate(new Date(Date.now() + 86400_000));
    const out = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Do not resurrect a closed line",
      actorId: "user_staff",
    });
    assert.equal(out.status, "terminated");
    const [row] = await sql<{ status: string; expiry_source: string }>`
      select status, expiry_source from services where id = 'svc_ex'`;
    assert.equal(row?.status, "terminated");
    assert.equal(row?.expiry_source, "staff");
    const auth = await authorizeRadius(sql, "ten_ex", { username: "amina" });
    assert.equal(auth.result, "reject");
  } finally {
    await close();
  }
});

test("tenant isolation and missing reason", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await sql`insert into tenants (id, name, slug) values ('ten_other', 'Other', 'other')`;
    await asRole("ten_other");
    await assert.rejects(
      () =>
        setServiceExpiry(sql, "ten_other", {
          serviceId: "svc_ex",
          ymd: "2026-10-01",
          reason: "cross tenant",
          actorId: "user_b",
        }),
      /Service not found/,
    );
    const [failed] = await sql<{ n: number }>`
      select count(*)::int as n from audit_logs
      where tenant_id = 'ten_other' and action = 'service.expiry.update.failed'`;
    assert.equal(failed?.n, 1);
    await asRole("ten_ex");
    await assert.rejects(
      () =>
        setServiceExpiry(sql, "ten_ex", {
          serviceId: "svc_ex",
          ymd: "2026-10-01",
          reason: "  ",
          actorId: "user_staff",
        }),
      /reason/i,
    );
    const [reasonFail] = await sql<{ n: number }>`
      select count(*)::int as n from audit_logs
      where tenant_id = 'ten_ex' and action = 'service.expiry.update.failed'`;
    assert.ok((reasonFail?.n ?? 0) >= 1);
    assert.equal(hasPermission("technician", "services.expiry.update"), false);
    assert.throws(() => assertPermission("technician", "services.expiry.update"), /Forbidden/);
    assert.equal(hasPermission("finance", "services.expiry.update"), false);
    assert.equal(hasPermission("support", "services.expiry.update"), false);
  } finally {
    await close();
  }
});

test("duplicate save is idempotent and PPPoE static hotspot reuse access provisioning", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql, { method: "pppoe" });
    await asRole("ten_ex");
    const first = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: "2021-03-01",
      reason: "First save",
      actorId: "user_staff",
    });
    const second = await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: "2021-03-01",
      reason: "Second save",
      actorId: "user_staff",
    });
    assert.equal(first.status, second.status);
    assert.equal(second.status, "suspended");
    const [rad] = await sql<{ enabled: boolean }>`select enabled from radius_accounts where id = 'rad_ex'`;
    assert.equal(rad?.enabled, false);
    const [cmds] = await sql<{ n: number }>`select count(*)::int as n from agent_commands where tenant_id = 'ten_ex'`;
    assert.ok((cmds?.n ?? 0) >= 1);
    const [kind] = await sql<{ kind: string }>`
      select kind from agent_commands where tenant_id = 'ten_ex' order by created_at desc limit 1`;
    assert.equal(kind?.kind, "pppoe.disable");

    for (const method of ["static", "hotspot"] as const) {
      await bypass();
      await sql`update services set access_method = ${method}, status = 'active', suspend_reason = '' where id = 'svc_ex'`;
      await asRole("ten_ex");
      const out = await setServiceExpiry(sql, "ten_ex", {
        serviceId: "svc_ex",
        ymd: "2021-03-01",
        reason: `${method} offline date`,
        actorId: "user_staff",
      });
      assert.equal(out.status, "suspended");
      const [last] = await sql<{ kind: string }>`
        select kind from agent_commands where tenant_id = 'ten_ex' order by created_at desc limit 1`;
      assert.equal(last?.kind, `${method}.disable`);
    }
  } finally {
    await close();
  }
});

test("billing cron does not overwrite a staff-controlled future date", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    const stale = new Date(Date.now() - 3 * 86400_000).toISOString();
    await sql`update services set period_end = ${stale} where id = 'svc_ex'`;
    await asRole("ten_ex");
    const future = nairobiDate(new Date(Date.now() + 10 * 86400_000));
    await setServiceExpiry(sql, "ten_ex", {
      serviceId: "svc_ex",
      ymd: future,
      reason: "Staff override while invoice is sorted",
      actorId: "user_staff",
    });
    const cycle = await applyAccessPolicy(sql, "ten_ex", "Expiry");
    const [row] = await sql<{ status: string; expiry_source: string; period_end: string; access_until: string }>`
      select status, expiry_source, period_end::text as period_end, access_until::text as access_until
      from services where id = 'svc_ex'`;
    assert.equal(row?.status, "active");
    assert.equal(row?.expiry_source, "staff");
    assert.equal(new Date(row?.period_end ?? 0).toISOString(), new Date(stale).toISOString());
    assert.equal(nairobiDate(row?.access_until || ""), future);
    const quiet = await countQuiet(sql);
    assert.equal(quiet.notes, 0);
    assert.equal(quiet.mail, 0);
    assert.equal(quiet.campaigns, 0);
    assert.equal(cycle.time, 0);
  } finally {
    await close();
  }
});

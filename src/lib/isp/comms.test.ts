import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCampaign,
  dispatchCampaign,
  ensureCommTemplates,
  listCampaigns,
  listCommTemplates,
  loadCampaign,
  phoneOk,
  recentDuplicate,
  resendFailed,
  resolveAudience,
  summarizeAudience,
} from "./comms.ts";
import { type AudienceFilter, filterSignature, parseAudienceFilter, renderCommTemplate, smsSegments } from "./comms-format.ts";
import { assertPermission, hasPermission } from "./rbac.ts";
import { openTestDb } from "./test-db.ts";

async function seed(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  await sql`insert into tenants (id, name, slug, support_phone) values ('ten_c', 'Imani Net', 'imani', '0800123123')`;
  await sql`insert into tenants (id, name, slug) values ('ten_x', 'Other', 'other')`;
  await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
    values ('pkg_10', 'ten_c', '10 Mbps', 'pppoe', 10, 10, 2500),
           ('pkg_20', 'ten_c', '20 Mbps', 'static', 20, 20, 4500),
           ('pkg_hs', 'ten_c', 'Hotspot Day', 'hotspot', 5, 5, 100),
           ('pkg_x', 'ten_x', 'Other 10', 'pppoe', 10, 10, 2500)`;
  const past = new Date(Date.now() - 3 * 86400_000).toISOString();
  const future = new Date(Date.now() + 5 * 86400_000).toISOString();
  const old = new Date(Date.now() - 400 * 86400_000).toISOString();
  await sql`insert into customers (id, tenant_id, name, phone, address, type, status, created_at) values
    ('cus_a', 'ten_c', 'Amina', '0711000001', 'Nanyuki', 'individual', 'active', now()),
    ('cus_o', 'ten_c', 'Otieno', '0711000002', 'Nanyuki', 'individual', 'suspended', now()),
    ('cus_w', 'ten_c', 'Wanjiku', '0711000003', 'Nyeri', 'business', 'suspended', now()),
    ('cus_k', 'ten_c', 'Kamau', '0711000004', 'Nanyuki', 'individual', 'active', now()),
    ('cus_n', 'ten_c', 'Njeri', '0711000005', 'Nairobi', 'individual', 'active', now()),
    ('cus_p', 'ten_c', 'NoPhone', '', 'Nanyuki', 'individual', 'active', now()),
    ('cus_l', 'ten_c', 'LongTerm', '0711000007', 'Nanyuki', 'individual', 'active', ${old}),
    ('cus_x', 'ten_x', 'Other', '0711999999', 'Kisumu', 'individual', 'active', now())`;
  await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end) values
    ('svc_a', 'ten_c', 'cus_a', 'pkg_10', 'pppoe', 'amina', 'active', ${future}),
    ('svc_o', 'ten_c', 'cus_o', 'pkg_10', 'pppoe', 'otieno', 'suspended', ${future}),
    ('svc_w', 'ten_c', 'cus_w', 'pkg_20', 'static', null, 'suspended', ${past}),
    ('svc_k', 'ten_c', 'cus_k', 'pkg_10', 'pppoe', 'kamau', 'grace', ${past}),
    ('svc_n', 'ten_c', 'cus_n', 'pkg_hs', 'hotspot', 'njeri', 'active', ${future}),
    ('svc_p', 'ten_c', 'cus_p', 'pkg_10', 'pppoe', 'nophone', 'active', ${future}),
    ('svc_l', 'ten_c', 'cus_l', 'pkg_10', 'pppoe', 'long', 'active', ${future}),
    ('svc_x', 'ten_x', 'cus_x', 'pkg_x', 'pppoe', 'other', 'active', ${future})`;
  await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date)
    values ('inv_o', 'ten_c', 'cus_o', 'INV-O', 2500, 0, 'overdue', ${past.slice(0, 10)})`;
}

function names(rows: { name: string }[]) {
  return rows.map((r) => r.name).sort();
}

test("SMS segmentation uses GSM 160/153 and UCS-2 70/67", () => {
  assert.equal(smsSegments("Hello").parts, 1);
  assert.equal(smsSegments("a".repeat(160)).parts, 1);
  assert.equal(smsSegments("a".repeat(161)).parts, 2);
  assert.equal(smsSegments("Safari 🐘").encoding, "ucs2");
  assert.ok(smsSegments("字".repeat(71)).parts >= 2);
  const sig = filterSignature({ statuses: ["active"], area: "Nanyuki" });
  const parsed = parseAudienceFilter(sig);
  assert.deepEqual(parsed.statuses, ["active"]);
  assert.equal(parsed.area, "nanyuki");
});

test("template variables render without leaking unknown tokens", () => {
  const out = renderCommTemplate("Dear {{customer_name}} of {{company_name}} {package_name}", {
    customer_name: "Amina",
    company_name: "Imani Net",
    package_name: "10 Mbps",
  });
  assert.equal(out, "Dear Amina of Imani Net 10 Mbps");
  assert.equal(phoneOk("0711000001"), true);
  assert.equal(phoneOk(""), false);
  assert.equal(phoneOk("abc"), false);
});

test("audience filters, combinations, phone skip, and isolation", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_c");
    const active = await resolveAudience(sql, "ten_c", { statuses: ["active"] });
    assert.deepEqual(names(active), ["Amina", "LongTerm", "Njeri", "NoPhone"]);
    const suspended = await resolveAudience(sql, "ten_c", { statuses: ["suspended"] });
    assert.ok(names(suspended).includes("Otieno"));
    const expired = await resolveAudience(sql, "ten_c", { statuses: ["expired"] });
    assert.deepEqual(names(expired), ["Wanjiku"]);
    const grace = await resolveAudience(sql, "ten_c", { statuses: ["grace"] });
    assert.deepEqual(names(grace), ["Kamau"]);
    const pppoe = await resolveAudience(sql, "ten_c", { access: ["pppoe"] });
    assert.ok(pppoe.every((r) => r.access_method === "pppoe"));
    const stat = await resolveAudience(sql, "ten_c", { access: ["static"] });
    assert.deepEqual(names(stat), ["Wanjiku"]);
    const hs = await resolveAudience(sql, "ten_c", { access: ["hotspot"] });
    assert.deepEqual(names(hs), ["Njeri"]);
    const combo = await resolveAudience(sql, "ten_c", {
      statuses: ["active"],
      access: ["pppoe"],
      package_ids: ["pkg_10"],
      area: "Nanyuki",
    });
    assert.deepEqual(names(combo), ["Amina", "LongTerm", "NoPhone"]);
    const summary = summarizeAudience(combo);
    assert.equal(summary.total, 3);
    assert.equal(summary.valid, 2);
    assert.equal(summary.skipped, 1);
    const overdue = await resolveAudience(sql, "ten_c", { overdue: true });
    assert.deepEqual(names(overdue), ["Otieno"]);
    const longTerm = await resolveAudience(sql, "ten_c", { long_term_days: 365 });
    assert.ok(names(longTerm).includes("LongTerm"));
    await asRole("ten_x");
    const other = await resolveAudience(sql, "ten_x", { statuses: ["active"] });
    assert.deepEqual(names(other), ["Other"]);
    assert.equal(other.some((r) => r.name === "Amina"), false);
  } finally {
    await close();
  }
});

test("campaign create, dispatch, duplicate, audit trail, concurrent send, resend failed", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_c");
    await ensureCommTemplates(sql, "ten_c");
    const templates = await listCommTemplates(sql, "ten_c", "planned_maintenance");
    assert.ok(templates.length >= 1);
    const filter: AudienceFilter = { statuses: ["active"], access: ["pppoe"], package_ids: ["pkg_10"], area: "Nanyuki" };
    const body = templates[0]?.body || "Dear {{customer_name}} {{company_name}}";
    const created = await createCampaign(sql, {
      tenantId: "ten_c",
      slug: "imani",
      company: "Imani Net",
      support: "0800123123",
      category: "planned_maintenance",
      name: "Nanyuki maintenance",
      body,
      extras: { maintenance_date: "14 September", maintenance_start: "00:00", maintenance_end: "04:00", area: "Nanyuki" },
      actorId: "user_john",
      actorLabel: "John",
      filter,
    });
    assert.equal(created.total, 3);
    assert.equal(created.valid, 2);
    assert.equal(created.skipped, 1);
    assert.ok(created.sms_count >= 2);
    const dup = await recentDuplicate(sql, "ten_c", "planned_maintenance", body.trim(), filter);
    assert.ok(dup);
    const sent = await dispatchCampaign(sql, "ten_c", created.id);
    assert.equal(sent.status, "sent");
    assert.notEqual(sent.status, "delivered");
    assert.equal(sent.sent_count, 2);
    const [sample] = await sql<{ body: string; status: string }>`
      select body, status from comm_recipients where campaign_id = ${created.id} and status = 'sent' limit 1`;
    assert.match(sample?.body ?? "", /Amina|LongTerm/);
    assert.match(sample?.body ?? "", /Imani Net/);
    assert.equal(sample?.body.includes("{{"), false);
    const logs = await sql<{ n: number }>`select count(*)::int as n from notification_logs where tenant_id = 'ten_c' and event_code = 'staff.campaign'`;
    assert.equal(logs[0]?.n, 2);
    const again = await dispatchCampaign(sql, "ten_c", created.id);
    assert.equal(again.sent_count, 2);
    await sql`update comm_recipients set status = 'failed', detail = 'provider' where campaign_id = ${created.id} and status = 'sent'`;
    const resent = await resendFailed(sql, "ten_c", created.id, {
      id: "user_john",
      label: "John",
      slug: "imani",
      company: "Imani Net",
      support: "0800123123",
    });
    assert.equal(resent.recipient_count, 2);
    assert.notEqual(resent.id, created.id);
    const history = await listCampaigns(sql, "ten_c");
    assert.ok(history.length >= 2);
    assert.equal(history.some((c) => c.status === "delivered"), false);
    const audit = await sql<{ n: number }>`
      insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
      values ('aud_c1', 'ten_c', 'user_john', 'campaign.created', 'campaign', ${created.id})
      returning 1 as n`;
    assert.equal(audit[0]?.n, 1);
    assert.equal(hasPermission("technician", "communications.send"), false);
    assert.throws(() => assertPermission("support", "communications.send"), /Forbidden/);
    await asRole("ten_x");
    await assert.rejects(loadCampaign(sql, "ten_x", created.id), /not found/);
  } finally {
    await close();
  }
});

test("large audience insert and filter signature stay stable", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await seed(sql);
    await asRole("ten_c");
    for (let i = 0; i < 40; i += 1) {
      const id = `cus_b${i}`;
      await sql`insert into customers (id, tenant_id, name, phone, address, status)
        values (${id}, 'ten_c', ${"Bulk" + i}, ${"0711888" + String(i).padStart(3, "0")}, 'Nanyuki', 'active')`;
      await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end)
        values (${"svc_b" + i}, 'ten_c', ${id}, 'pkg_10', 'pppoe', ${"u" + i}, 'active', ${new Date(Date.now() + 86400_000).toISOString()})`;
    }
    const filter: AudienceFilter = { statuses: ["active"], access: ["pppoe"], area: "Nanyuki" };
    const created = await createCampaign(sql, {
      tenantId: "ten_c",
      slug: "imani",
      company: "Imani Net",
      support: "0800",
      category: "general_announcement",
      body: "Notice {{customer_name}}",
      filter,
      actorId: "user_john",
      actorLabel: "John",
    });
    assert.ok(created.valid >= 40);
    const camp = await dispatchCampaign(sql, "ten_c", created.id);
    assert.ok(camp.sent_count >= 40);
    assert.equal(filterSignature(filter), filterSignature({ area: "Nanyuki", access: ["pppoe"], statuses: ["active"] }));
  } finally {
    await close();
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCampaign, dispatchCampaign, resolveAudience, summarizeAudience } from "./comms.ts";
import { channelAllowed, deliverEmail, emailOk, formatFrom, getMessagingSettings, saveMessagingSettings, toPublic } from "./messaging.ts";
import { queueEmail } from "./inbox.ts";
import { buildMime } from "./smtp.ts";
import { openTestDb } from "./test-db.ts";

test("emailOk and from-address formatting", () => {
  assert.equal(emailOk("billing@imani.co.ke"), true);
  assert.equal(emailOk("not-an-email"), false);
  assert.equal(emailOk("a@b\n@evil.com"), false);
  assert.equal(
    formatFrom({
      email_from_name: "Imani",
      email_from_address: "billing@imani.co.ke",
    } as never),
    "Imani <billing@imani.co.ke>",
  );
  assert.equal(formatFrom({ email_from_name: "", email_from_address: "bad" } as never), "");
});

test("channelAllowed respects per-tenant email flags", () => {
  const on = {
    payment_email: true,
    billing_email: false,
    payment_sms: true,
    billing_sms: true,
  } as never;
  assert.equal(channelAllowed("payment.received", "email", on), true);
  assert.equal(channelAllowed("invoice.created", "email", on), false);
});

test("MIME builder includes subject and attachments", () => {
  const mime = buildMime({
    host: "localhost",
    port: 25,
    secure: false,
    from: "Imani <billing@imani.co.ke>",
    to: "amina@example.com",
    subject: "Invoice INV-1",
    body: "Hello",
    attachments: [{ filename: "inv.pdf", content: Buffer.from("pdf").toString("base64"), contentType: "application/pdf" }],
  });
  assert.match(mime, /From: Imani <billing@imani.co.ke>/);
  assert.match(mime, /To: amina@example.com/);
  assert.match(mime, /Subject: Invoice INV-1/);
  assert.match(mime, /filename="inv.pdf"/);
});

test("tenant email settings, secrets, sandbox send, and outbox isolation", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_a', 'Imani', 'imani'), ('ten_b', 'North', 'north')`;
    await asRole("ten_a");
    const saved = await saveMessagingSettings(sql, "ten_a", {
      email_from_name: "Imani Networks",
      email_from_address: "billing@imani.co.ke",
      email_provider: "resend",
      email_api_key: "re_imani_secret",
      email_sandbox: true,
      payment_email: true,
      billing_email: true,
    });
    assert.equal(saved.email_from_address, "billing@imani.co.ke");
    const pub = toPublic(saved);
    assert.equal(pub.email_api_key_set, true);
    assert.equal(pub.email_api_key_hint.includes("re_imani_secret"), false);
    const stored = await sql<{ email_api_key: string }>`select email_api_key from messaging_settings where tenant_id = 'ten_a'`;
    assert.ok(stored[0]?.email_api_key.startsWith("enc:v1:") || stored[0]?.email_api_key === "re_imani_secret");

    const sandbox = await deliverEmail(saved, "amina@example.com", "Hi", "Body");
    assert.equal(sandbox.status, "sandbox");
    assert.match(sandbox.detail, /amina@example.com/);

    await queueEmail(sql, "ten_a", "amina@example.com", "Invoice", "Pay now");
    const aBox = await sql<{ to_addr: string; from_addr: string }>`select to_addr, from_addr from email_outbox where tenant_id = 'ten_a'`;
    assert.equal(aBox.length, 1);
    assert.match(aBox[0]?.from_addr ?? "", /imani/i);

    await asRole("ten_b");
    const b = await getMessagingSettings(sql, "ten_b");
    assert.equal(b.email_from_address, "");
    assert.equal(b.email_api_key, "");
    const leak = await sql<{ n: number }>`select count(*)::int as n from email_outbox`;
    assert.equal(leak[0]?.n, 0);
    await saveMessagingSettings(sql, "ten_b", {
      email_from_address: "hello@northline.ke",
      email_from_name: "Northline",
    });
    const b2 = await getMessagingSettings(sql, "ten_b");
    assert.equal(b2.email_from_address, "hello@northline.ke");
    assert.notEqual(b2.email_from_address, "billing@imani.co.ke");
  } finally {
    await close();
  }
});

test("email campaign skips missing addresses and stays tenant-scoped", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_c', 'Imani Net', 'imani'), ('ten_x', 'Other', 'other')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_10', 'ten_c', '10 Mbps', 'pppoe', 10, 10, 2500)`;
    await sql`insert into customers (id, tenant_id, name, phone, email, address, status) values
      ('cus_a', 'ten_c', 'Amina', '0711000001', 'amina@imani.test', 'Nanyuki', 'active'),
      ('cus_p', 'ten_c', 'NoMail', '0711000002', '', 'Nanyuki', 'active'),
      ('cus_x', 'ten_x', 'Other', '0711999999', 'other@x.test', 'Kisumu', 'active')`;
    const future = new Date(Date.now() + 86400_000).toISOString();
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end) values
      ('svc_a', 'ten_c', 'cus_a', 'pkg_10', 'pppoe', 'amina', 'active', ${future}),
      ('svc_p', 'ten_c', 'cus_p', 'pkg_10', 'pppoe', 'nomail', 'active', ${future})`;
    await asRole("ten_c");
    const audience = await resolveAudience(sql, "ten_c", { statuses: ["active"] });
    const summary = summarizeAudience(audience, "email");
    assert.equal(summary.valid, 1);
    assert.equal(summary.skipped, 1);
    const created = await createCampaign(sql, {
      tenantId: "ten_c",
      slug: "imani",
      company: "Imani Net",
      support: "0800",
      category: "general_announcement",
      body: "Hello {{customer_name}} from {{company_name}}",
      filter: { statuses: ["active"] },
      actorId: "user_j",
      actorLabel: "John",
      channel: "email",
    });
    assert.equal(created.valid, 1);
    assert.equal(created.skipped, 1);
    const sent = await dispatchCampaign(sql, "ten_c", created.id);
    assert.equal(sent.status, "sent");
    assert.equal(sent.sent_count, 1);
    const [row] = await sql<{ email: string; body: string; status: string }>`
      select email, body, status from comm_recipients where campaign_id = ${created.id} and status = 'sent'`;
    assert.equal(row?.email, "amina@imani.test");
    assert.match(row?.body ?? "", /Amina/);
    const logs = await sql<{ channel: string }>`select channel from notification_logs where tenant_id = 'ten_c' and event_code = 'staff.campaign'`;
    assert.ok(logs.some((l) => l.channel === "email"));
    await asRole("ten_x");
    const x = await sql<{ n: number }>`select count(*)::int as n from comm_recipients`;
    assert.equal(x[0]?.n, 0);
  } finally {
    await close();
  }
});

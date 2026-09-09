import assert from "node:assert/strict";
import { test } from "node:test";
import { restoreCustomerAccess } from "./access.ts";
import { enrollFields } from "./agent.ts";
import { issueInvoice } from "./billing.ts";
import { customerBalance } from "./ledger.ts";
import { approveCommand, pullCommands, queueCompiledCommand } from "./mikrotik.ts";
import { runBillingCycle } from "./notifications.ts";
import { applyConfirmedPayment } from "./payments.ts";
import { applyRls } from "./rls.ts";
import { openTestDb } from "./test-db.ts";
import { processMpesaCallback } from "./webhooks.ts";
import { generateWireGuardKeypair, generateX25519Pair, isWireGuardPublicKey, x25519Agree } from "./wireguard.ts";

function utcDate(offsetDays: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function darajaBody(opts: { checkout: string; amount: number; receipt: string; resultCode?: number }) {
  return {
    Body: {
      stkCallback: {
        CheckoutRequestID: opts.checkout,
        ResultCode: opts.resultCode ?? 0,
        ResultDesc: "Success",
        CallbackMetadata: {
          Item: [
            { Name: "Amount", Value: opts.amount },
            { Name: "MpesaReceiptNumber", Value: opts.receipt },
          ],
        },
      },
    },
  };
}

test("migrations apply on a clean Postgres-compatible database", async () => {
  const { sql, close } = await openTestDb();
  try {
    const tables = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name in ('customers','invoices','payments','routers','agent_commands')`;
    assert.ok((tables[0]?.n ?? 0) >= 5);
    const files = await sql<{ n: number }>`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`;
    assert.ok((files[0]?.n ?? 0) >= 40);
  } finally {
    await close();
  }
});

test("tenant A cannot read tenant B rows under RLS", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_a', 'Alpha', 'alpha'), ('ten_b', 'Beta', 'beta')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_a', 'ten_a', 'Ann', '0711000001'), ('cus_b', 'ten_b', 'Ben', '0711000002')`;

    await asRole("ten_a");
    const a = await sql<{ name: string }>`select name from customers`;
    assert.deepEqual(a.map((r) => r.name), ["Ann"]);
    const sneak = await sql<{ name: string }>`select name from customers where tenant_id = ${"ten_b"}`;
    assert.equal(sneak.length, 0);

    await asRole("ten_b");
    const b = await sql<{ name: string }>`select name from customers`;
    assert.deepEqual(b.map((r) => r.name), ["Ben"]);
  } finally {
    await close();
  }
});

test("M-Pesa callback confirms once and is idempotent; ledger stays consistent", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_p', 'Pay', 'pay')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_p', 'ten_p', 'Pam', '0711222333')`;
    const invoice = await issueInvoice(sql, {
      tenantId: "ten_p",
      customerId: "cus_p",
      amountKes: 1000,
      dueDate: "2026-09-01",
    });
    await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, checkout_id, status)
      values ('pi_p', 'ten_p', ${invoice.id}, 'cus_p', 'mpesa', 1000, 'ws_abc', 'pending')`;
    await asRole("ten_p");

    const body = darajaBody({ checkout: "ws_abc", amount: 1000, receipt: "QJK7XYZ" });
    const first = await processMpesaCallback(sql, "pay", body);
    assert.equal(first.ResultDesc, "confirmed");
    const second = await processMpesaCallback(sql, "pay", body);
    assert.equal(second.ResultDesc, "idempotent");

    const pays = await sql<{ reference: string }>`select reference from payments where tenant_id = ${"ten_p"}`;
    assert.equal(pays.length, 1);
    assert.equal(pays[0]?.reference, "QJK7XYZ");
    const [inv] = await sql<{ status: string }>`select status from invoices where id = ${invoice.id}`;
    assert.equal(inv?.status, "paid");
    const bal = await customerBalance(sql, "ten_p", "cus_p");
    assert.equal(bal, 0);
    const alloc = await sql<{ amount_kes: number }>`select amount_kes from payment_allocations where tenant_id = ${"ten_p"}`;
    assert.equal(alloc[0]?.amount_kes, 1000);

    await assert.rejects(
      () =>
        applyConfirmedPayment(sql, {
          tenantId: "ten_p",
          ispName: "Pay",
          invoiceId: invoice.id,
          provider: "mpesa",
          reference: "QJK7XYZ",
        }),
      /Duplicate/,
    );
  } finally {
    await close();
  }
});

test("M-Pesa amount mismatch goes to reconciliation and does not credit the ledger", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_m', 'Mismatch', 'mismatch')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_m', 'ten_m', 'Mo', '0711000099')`;
    const invoice = await issueInvoice(sql, {
      tenantId: "ten_m",
      customerId: "cus_m",
      amountKes: 2500,
      dueDate: "2026-09-01",
    });
    await sql`insert into payment_intents (id, tenant_id, invoice_id, customer_id, provider, amount_kes, checkout_id, status)
      values ('pi_m', 'ten_m', ${invoice.id}, 'cus_m', 'mpesa', 2500, 'ws_mis', 'pending')`;
    await asRole("ten_m");

    const result = await processMpesaCallback(
      sql,
      "mismatch",
      darajaBody({ checkout: "ws_mis", amount: 100, receipt: "QJKMIS" }),
    );
    assert.equal(result.ResultDesc, "reconciliation_required");
    const [intent] = await sql<{ status: string }>`select status from payment_intents where id = ${"pi_m"}`;
    assert.equal(intent?.status, "reconciliation_required");
    const pays = await sql<{ id: string }>`select id from payments where tenant_id = ${"ten_m"}`;
    assert.equal(pays.length, 0);
    assert.equal(await customerBalance(sql, "ten_m", "cus_m"), 2500);
  } finally {
    await close();
  }
});

test("WireGuard keys are real X25519 and agree both ways", () => {
  const keys = generateWireGuardKeypair();
  assert.equal(isWireGuardPublicKey(keys.publicKey), true);
  assert.match(keys.privateKeySealed, /^enc:v1:/);

  const a = generateX25519Pair();
  const b = generateX25519Pair();
  const ab = x25519Agree(a.privateKey, b.publicKey);
  const ba = x25519Agree(b.privateKey, a.publicKey);
  assert.equal(ab.length, 32);
  assert.deepEqual(ab, ba);
});

test("MikroTik agent enrollment, destructive approval, and audit", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_r', 'Net', 'net')`;
    const enroll = enrollFields("edge-01");
    await sql`insert into routers (id, tenant_id, name, identity, enroll_token, wg_public, wg_private_ref, wg_address, wg_status)
      values ('rtr_1', 'ten_r', 'edge-01', 'edge-01', ${enroll.token}, ${enroll.wg_public}, ${enroll.wg_private_sealed}, '10.200.0.2/32', 'enrolling')`;
    await asRole("ten_r");

    const queued = await queueCompiledCommand(sql, "ten_r", "rtr_1", "pppoe.upsert", { username: "pam" }, "user_1");
    assert.equal(queued.status, "queued");
    const destructive = await queueCompiledCommand(sql, "ten_r", "rtr_1", "raw.script", { script: "/system reboot" }, "user_1");
    assert.equal(destructive.status, "proposed");

    const before = await pullCommands(sql, enroll.token, true);
    assert.equal(before.commands.some((c) => c.kind === "raw.script"), false);
    assert.equal(before.router.id, "rtr_1");
    const [router] = await sql<{ wg_status: string }>`select wg_status from routers where id = ${"rtr_1"}`;
    assert.equal(router?.wg_status, "connected");

    await applyRls(sql, { tenantId: "ten_r", bypass: false });
    await approveCommand(sql, "ten_r", destructive.id, "user_1");
    const after = await pullCommands(sql, enroll.token, true);
    assert.ok(after.commands.some((c) => c.kind === "raw.script"));

    await applyRls(sql, { tenantId: "ten_r", bypass: false });
    const audits = await sql<{ action: string }>`select action from audit_logs where entity_id = ${destructive.id}`;
    assert.ok(audits.some((a) => a.action.startsWith("command.approved")));

    await assert.rejects(() => pullCommands(sql, "agt_not_a_real_token", true), /Unknown enroll token/);
  } finally {
    await close();
  }
});

test("billing cycle moves overdue services through grace then suspend; payment restores", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_s', 'Svc', 'svc')`;
    await sql`insert into customers (id, tenant_id, name, phone)
      values ('cus_s', 'ten_s', 'Sam', '0711999888'), ('cus_g', 'ten_s', 'Gia', '0711999777')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes, grace_days)
      values
        ('pkg_s', 'ten_s', 'Home 10', 'pppoe', 10, 10, 2500, 0),
        ('pkg_g', 'ten_s', 'Home 20', 'pppoe', 20, 20, 3500, 7)`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status)
      values
        ('svc_s', 'ten_s', 'cus_s', 'pkg_s', 'pppoe', 'sam', 'active'),
        ('svc_g', 'ten_s', 'cus_g', 'pkg_g', 'pppoe', 'gia', 'active')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values
        ('inv_s', 'ten_s', 'cus_s', 'INV-S', 2500, 'issued', '2020-01-01'),
        ('inv_g', 'ten_s', 'cus_g', 'INV-G', 3500, 'issued', ${utcDate(-3)})`;
    await asRole("ten_s");

    const cycle = await runBillingCycle(sql, "ten_s", "Svc");
    assert.ok(cycle.overdue >= 1);
    assert.ok(cycle.grace >= 1);
    assert.ok(cycle.suspended >= 1);
    const [suspended] = await sql<{ status: string }>`select status from services where id = ${"svc_s"}`;
    assert.equal(suspended?.status, "suspended");
    const [grace] = await sql<{ status: string }>`select status from services where id = ${"svc_g"}`;
    assert.equal(grace?.status, "grace");

    await restoreCustomerAccess(sql, "ten_s", "cus_s");
    await restoreCustomerAccess(sql, "ten_s", "cus_g");
    const [restored] = await sql<{ status: string }>`select status from services where id = ${"svc_s"}`;
    assert.equal(restored?.status, "active");
    const [restoredGrace] = await sql<{ status: string }>`select status from services where id = ${"svc_g"}`;
    assert.equal(restoredGrace?.status, "active");
  } finally {
    await close();
  }
});

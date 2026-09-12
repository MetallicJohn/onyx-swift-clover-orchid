import assert from "node:assert/strict";
import { test } from "node:test";
import { applySaasPayment, ensureSubscription, requestPlanChange } from "./saas.ts";
import { openTestDb } from "./test-db.ts";

test("paid plan change issues an invoice and does not activate until paid", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, support_phone) values ('ten_s', 'SaaS', 'saas', '0712555000')`;
    await asRole("ten_s");
    const trial = await ensureSubscription(sql, "ten_s");
    assert.equal(trial.plan, "trial");
    assert.equal(trial.status, "trial");

    const asked = await requestPlanChange(sql, "ten_s", "starter");
    assert.equal(asked.plan, "trial");
    assert.equal(asked.pending_plan, "starter");
    assert.ok(asked.invoice);
    assert.equal(asked.invoice?.amount_kes, 4999);
    assert.equal(asked.invoice?.status, "issued");

    const still = await ensureSubscription(sql, "ten_s");
    assert.equal(still.plan, "trial");

    const paid = await applySaasPayment(sql, {
      tenantId: "ten_s",
      invoiceId: asked.invoice!.id,
      provider: "mpesa",
      reference: "SAAS-OK",
    });
    assert.equal(paid.plan, "starter");
    assert.equal(paid.status, "active");
    const live = await ensureSubscription(sql, "ten_s");
    assert.equal(live.plan, "starter");
    assert.equal(live.pending_plan, "");
  } finally {
    await close();
  }
});

test("switching back to trial is immediate and voids the pending invoice", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_t', 'Trial', 'trialco')`;
    await asRole("ten_t");
    const asked = await requestPlanChange(sql, "ten_t", "growth");
    assert.equal(asked.pending_plan, "growth");
    const back = await requestPlanChange(sql, "ten_t", "trial");
    assert.equal(back.plan, "trial");
    assert.equal(back.pending_plan, "");
    const [inv] = await sql<{ status: string }>`select status from saas_invoices where id = ${asked.invoice!.id}`;
    assert.equal(inv?.status, "void");
  } finally {
    await close();
  }
});

test("expired trial cannot be restarted", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug, support_email, support_phone)
      values ('ten_x', 'X', 'xco', 'x@isp.test', '0712999000')`;
    await asRole("ten_x");
    const trial = await ensureSubscription(sql, "ten_x");
    assert.equal(trial.status, "trial");
    await sql`update tenant_subscriptions set period_end = ${new Date(Date.now() - 86400_000).toISOString()},
      status = 'expired' where tenant_id = ${"ten_x"}`;
    await assert.rejects(() => requestPlanChange(sql, "ten_x", "trial"), /already used a free trial/);
  } finally {
    await close();
  }
});

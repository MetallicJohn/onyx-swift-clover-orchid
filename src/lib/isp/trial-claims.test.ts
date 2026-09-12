import assert from "node:assert/strict";
import { test } from "node:test";
import { createCredentialAccount, provisionTenant } from "./accounts.ts";
import { assertSignupPhone, tenantTrialIdentity, trialAlreadyUsed } from "./trial-claims.ts";
import { assertTenantOperable, ensureSubscription, loadPlanDesk, requestPlanChange } from "./saas.ts";
import { openTestDb } from "./test-db.ts";

test("signup phone normalizes Kenyan mobiles", () => {
  assert.equal(assertSignupPhone("0712 000 000"), "254712000000");
  assert.equal(assertSignupPhone("+254712000000"), "254712000000");
  assert.equal(assertSignupPhone("0112000000"), "254112000000");
  assert.throws(() => assertSignupPhone("123"), /Kenyan mobile/);
});

test("the same phone cannot open a second trial", async () => {
  const { sql, asRole, close } = await openTestDb();
  try {
    const a = await createCredentialAccount(sql, {
      email: "first@isp.test",
      password: "FirstPass1",
      name: "First",
    });
    const first = await provisionTenant(sql, a.id, {
      ispName: "First Net",
      email: a.email,
      phone: "0712555001",
    });
    const trial = await ensureSubscription(sql, first.tenantId);
    assert.equal(trial.status, "trial");
    assert.ok(trial.days_left >= 13);

    const b = await createCredentialAccount(sql, {
      email: "second@isp.test",
      password: "SecondPass1",
      name: "Second",
    });
    const second = await provisionTenant(sql, b.id, {
      ispName: "Second Net",
      email: b.email,
      phone: "0712555001",
    });
    const blocked = await ensureSubscription(sql, second.tenantId);
    assert.equal(blocked.status, "expired");
    assert.equal(blocked.trial_expired, true);
    await assert.rejects(() => assertTenantOperable(sql, second.tenantId), /trial has ended/);
    await assert.rejects(() => requestPlanChange(sql, second.tenantId, "trial"), /already used a free trial/);

    await asRole(second.tenantId);
    const identity = await tenantTrialIdentity(sql, second.tenantId);
    assert.equal(await trialAlreadyUsed(sql, identity), true);
    const desk = await loadPlanDesk(sql, second.tenantId);
    assert.equal(desk.trial_available, false);
    assert.equal(desk.status, "expired");
  } finally {
    await close();
  }
});

test("the same email cannot open a second trial", async () => {
  const { sql, close } = await openTestDb();
  try {
    await sql`insert into tenants (id, name, slug, support_email, support_phone)
      values ('ten_e1', 'E1', 'e1', 'owner@isp.test', '0712000002')`;
    await sql`insert into tenant_subscriptions (id, tenant_id, plan, status, max_customers, max_routers, monthly_kes, period_end, trial_ends_at)
      values ('sub_e1', 'ten_e1', 'trial', 'trial', 50, 5, 0, ${new Date(Date.now() + 86400_000).toISOString()}, ${new Date(Date.now() + 86400_000).toISOString()})`;
    const user = await createCredentialAccount(sql, {
      email: "owner@isp.test",
      password: "OwnerPass1",
      name: "Owner",
    });
    await sql`insert into tenant_members (id, tenant_id, user_id, role)
      values ('mem_e1', 'ten_e1', ${user.id}, 'isp_owner')`;
    const { recordTrialClaims } = await import("./trial-claims.ts");
    await recordTrialClaims(sql, { email: "owner@isp.test", phone: "0712000002", tenantId: "ten_e1", userId: user.id });

    await sql`insert into tenants (id, name, slug, support_email, support_phone)
      values ('ten_e2', 'E2', 'e2', 'other@isp.test', '0712000003')`;
    await sql`insert into tenant_members (id, tenant_id, user_id, role)
      values ('mem_e2', 'ten_e2', ${user.id}, 'isp_owner')`;
    // same email, different phone — claim is on the email
    const blocked = await ensureSubscription(sql, "ten_e2");
    assert.equal(blocked.status, "expired");
  } finally {
    await close();
  }
});

test("cancelling a pending paid plan while the trial is live does not restart it", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_t', 'Trial', 'trialco')`;
    await asRole("ten_t");
    const first = await ensureSubscription(sql, "ten_t");
    const asked = await requestPlanChange(sql, "ten_t", "growth");
    assert.equal(asked.pending_plan, "growth");
    const back = await requestPlanChange(sql, "ten_t", "trial");
    assert.equal(back.plan, "trial");
    assert.equal(back.status, "trial");
    assert.equal(back.pending_plan, "");
    assert.equal(back.days_left, first.days_left);
    const [inv] = await sql<{ status: string }>`select status from saas_invoices where id = ${asked.invoice!.id}`;
    assert.equal(inv?.status, "void");
  } finally {
    await close();
  }
});

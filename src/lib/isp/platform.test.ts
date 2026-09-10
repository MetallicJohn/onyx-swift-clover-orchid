import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addStaffMember,
  createCredentialAccount,
  createIspWithOwner,
  isPlatformAdmin,
  provisionTenant,
} from "./accounts.ts";
import { assertFeature, listPlans, upsertPlan } from "./plans.ts";
import {
  assignTenantPlan,
  ingestNodeTelemetry,
  listPlatformTenantsPage,
  loadPlatformOverview,
  loadTenantDetail,
  reactivateTenant,
  registerInfraNode,
  requirePlatformActor,
  saveCatalogPlan,
  savePlatformSettings,
  startSupportAccess,
  suspendTenant,
} from "./platform.ts";
import { applySaasPayment, assertCustomerQuota, evaluateSubscription, requestPlanChange } from "./saas.ts";
import { openTestDb } from "./test-db.ts";

async function ownerAndAdmin(sql: Awaited<ReturnType<typeof openTestDb>>["sql"]) {
  const admin = await createCredentialAccount(sql, {
    email: "root@isp.solutions",
    password: "RootPass1!",
    name: "Platform",
  });
  const ws = await provisionTenant(sql, admin.id, { ispName: "Control Plane", email: admin.email });
  assert.equal(await isPlatformAdmin(sql, admin.id), true);
  const other = await createIspWithOwner(sql, {
    ispName: "Coast Fiber",
    ownerName: "Amina",
    ownerEmail: "amina@coast.test",
    ownerPassword: "CoastPass1!",
  });
  return { admin, ws, other };
}

test("tenant administrator is not a platform admin after bootstrap", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { other } = await ownerAndAdmin(sql);
    assert.equal(await isPlatformAdmin(sql, other.owner_id), false);
    await assert.rejects(() => requirePlatformActor(sql, other.owner_id), /Forbidden/);
    await assert.rejects(
      () => listPlatformTenantsPage(sql, other.owner_id, { page: 1 }),
      /Forbidden/,
    );
  } finally {
    await close();
  }
});

test("superadmin lists tenants without customer PII", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    await asRole(other.tenant_id);
    await sql`insert into customers (id, tenant_id, name, phone, email, address)
      values ('cus_x', ${other.tenant_id}, 'Secret Customer', '0712000000', 'secret@x.test', 'Nairobi')`;
    await bypass();
    const page = await listPlatformTenantsPage(sql, admin.id, { q: "coast", page: 1, pageSize: 10 });
    assert.ok(page.tenants.some((t) => t.id === other.tenant_id));
    const blob = JSON.stringify(page);
    assert.equal(blob.includes("Secret Customer"), false);
    assert.equal(blob.includes("0712000000"), false);
    const detail = await loadTenantDetail(sql, admin.id, other.tenant_id);
    const dumped = JSON.stringify(detail);
    assert.equal(dumped.includes("Secret Customer"), false);
    assert.equal(dumped.includes("0712000000"), false);
    assert.equal(detail.usage.customers, 1);
    assert.ok(detail.operators.some((o) => o.email === "amina@coast.test"));
  } finally {
    await close();
  }
});

test("plans are database-driven and entitlements are enforced", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    const catalog = await listPlans(sql, true);
    assert.ok(catalog.some((p) => p.code === "starter" && p.monthly_kes === 4999));
    const custom = await saveCatalogPlan(sql, admin.id, {
      code: "pro_plus",
      name: "Pro Plus",
      description: "Custom",
      monthly_kes: 19999,
      annual_kes: 199990,
      trial_days: 0,
      max_customers: 8000,
      max_routers: 80,
      max_services: 8000,
      max_admins: 20,
      max_storage_gb: 80,
      api_requests_per_day: 10000,
      support_level: "priority",
      entitlements: { pppoe: true, hotspot: false, reports: true },
    });
    assert.equal(custom.code, "pro_plus");
    assert.equal(custom.entitlements.hotspot, false);
    await assignTenantPlan(sql, admin.id, { tenantId: other.tenant_id, plan: "pro_plus" });
    await assert.rejects(() => assertFeature(sql, other.tenant_id, "hotspot"), /Hotspot/);
    await assertFeature(sql, other.tenant_id, "pppoe");
    await assert.rejects(
      () => upsertPlan(sql, { ...custom, name: "" }),
      /Plan name/,
    );
  } finally {
    await close();
  }
});

test("suspend keeps customer data and blocks quotas; reactivate restores", async () => {
  const { sql, asRole, bypass, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    await asRole(other.tenant_id);
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_keep', ${other.tenant_id}, 'Kept', '0700')`;
    await bypass();
    await suspendTenant(sql, admin.id, other.tenant_id, "Non-payment review");
    const [ten] = await sql<{ status: string }>`select status from tenants where id = ${other.tenant_id}`;
    assert.equal(ten?.status, "suspended");
    const [cus] = await sql<{ name: string }>`select name from customers where id = 'cus_keep'`;
    assert.equal(cus?.name, "Kept");
    await assert.rejects(() => assertCustomerQuota(sql, other.tenant_id), /suspended/);
    await reactivateTenant(sql, admin.id, other.tenant_id);
    const [live] = await sql<{ status: string }>`select status from tenants where id = ${other.tenant_id}`;
    assert.equal(live?.status, "trial");
  } finally {
    await close();
  }
});

test("subscription lifecycle expires a lapsed trial without deleting data", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    await sql`update tenant_subscriptions set period_end = ${new Date(Date.now() - 86400_000).toISOString()}
      where tenant_id = ${other.tenant_id}`;
    const next = await evaluateSubscription(sql, other.tenant_id);
    assert.equal(next.status, "expired");
    const [ten] = await sql<{ status: string }>`select status from tenants where id = ${other.tenant_id}`;
    assert.equal(ten?.status, "suspended");
    await assignTenantPlan(sql, admin.id, { tenantId: other.tenant_id, plan: "starter" });
    const detail = await loadTenantDetail(sql, admin.id, other.tenant_id);
    assert.equal(detail.subscription.plan, "starter");
    assert.equal(detail.subscription.status, "active");
  } finally {
    await close();
  }
});

test("owner paid plan change still waits for payment; superadmin override is immediate", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    const asked = await requestPlanChange(sql, other.tenant_id, "starter");
    assert.equal(asked.plan, "trial");
    assert.equal(asked.pending_plan, "starter");
    assert.ok(asked.invoice);
    await applySaasPayment(sql, {
      tenantId: other.tenant_id,
      invoiceId: asked.invoice!.id,
      provider: "mpesa",
      reference: "SAAS-PLAT",
    });
    const detail = await loadTenantDetail(sql, admin.id, other.tenant_id);
    assert.equal(detail.subscription.plan, "starter");
    await assignTenantPlan(sql, admin.id, { tenantId: other.tenant_id, plan: "growth" });
    const after = await loadTenantDetail(sql, admin.id, other.tenant_id);
    assert.equal(after.subscription.plan, "growth");
    assert.equal(after.subscription.status, "active");
  } finally {
    await close();
  }
});

test("support access is disabled until explicitly enabled and is audited", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    await assert.rejects(
      () => startSupportAccess(sql, admin.id, other.tenant_id, "Need to inspect RADIUS"),
      /disabled/,
    );
    await savePlatformSettings(sql, admin.id, { support_access_enabled: true, support_access_minutes: 15 });
    const session = await startSupportAccess(sql, admin.id, other.tenant_id, "Need to inspect RADIUS");
    assert.equal(session.tenant_id, other.tenant_id);
    const { resolveActiveTenant } = await import("./tenant-context.ts");
    const ctx = await resolveActiveTenant(sql, admin.id);
    assert.equal(ctx?.role, "support");
    assert.equal(ctx?.supportMode, true);
    assert.equal(ctx?.tenantId, other.tenant_id);
    const [log] = await sql<{ action: string }>`
      select action from platform_audit_log where action = 'support.started' order by created_at desc limit 1`;
    assert.equal(log?.action, "support.started");
  } finally {
    await close();
  }
});

test("infra telemetry rejects unknown tokens and does not invent metrics", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    await assert.rejects(() => ingestNodeTelemetry(sql, "nod_unknown", { cpu_pct: 12 }), /Unauthorized/);
    const node = await registerInfraNode(sql, admin.id, other.tenant_id, "nbo-edge-1");
    assert.match(node.token, /^nod_/);
    const ok = await ingestNodeTelemetry(sql, node.token, {
      cpu_pct: 22,
      ram_pct: 41,
      disk_pct: 18,
      reported_at: new Date().toISOString(),
    });
    assert.equal(ok.ok, true);
    const overview = await loadPlatformOverview(sql, admin.id);
    assert.equal(typeof overview.revenue.mrr, "number");
    assert.ok(["healthy", "warning", "critical", "offline", "unknown"].includes(overview.infrastructure.health));
    const detail = await loadTenantDetail(sql, admin.id, other.tenant_id);
    assert.equal(detail.infrastructure.ram, null);
    assert.ok(detail.nodes.some((n) => n.name === "nbo-edge-1" && n.cpu_pct === 22));
  } finally {
    await close();
  }
});

test("overview and tenant list stay authorized and paginated", async () => {
  const { sql, close } = await openTestDb();
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    const page = await listPlatformTenantsPage(sql, admin.id, { page: 1, pageSize: 1 });
    assert.equal(page.pageSize, 1);
    assert.ok(page.total >= 2);
    assert.equal(page.tenants.length, 1);
    const hit = await listPlatformTenantsPage(sql, admin.id, { q: other.slug, page: 1, pageSize: 25 });
    assert.ok(hit.tenants.some((t) => t.id === other.tenant_id));
    const overview = await loadPlatformOverview(sql, admin.id);
    assert.ok(overview.tenants.total >= 2);
  } finally {
    await close();
  }
});

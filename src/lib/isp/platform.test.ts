import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  createCredentialAccount,
  createIspWithOwner,
  isPlatformAdmin,
  provisionTenant,
} from "./accounts.ts";
import { annualSavingsPct, assertFeature, isSalesContactPlan, listPlans, publicCatalog, upsertPlan } from "./plans.ts";
import {
  assignTenantPlan,
  archiveCatalogPlan,
  ingestNodeTelemetry,
  listPlatformBackups,
  deletePlatformBackup,
  listPlatformTenantsPage,
  loadPlatformOverview,
  loadTenantDetail,
  overviewFromInfraNodes,
  reactivateTenant,
  registerInfraNode,
  requirePlatformActor,
  saveBackupRetention,
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

test("superadmin can list and delete backups; tenant admin cannot", async () => {
  const { sql, close } = await openTestDb();
  const dir = mkdtempSync(join(tmpdir(), "isp-plat-backups-"));
  const previous = process.env.ISPSOLUTIONS_BACKUP_DIR;
  process.env.ISPSOLUTIONS_BACKUP_DIR = dir;
  try {
    const { admin, other } = await ownerAndAdmin(sql);
    writeFileSync(join(dir, "ispsolutions-20260920T180000Z.dump"), "dump");
    writeFileSync(join(dir, "ispsolutions-20260920T180000Z.dump.meta"), "meta");
    await assert.rejects(() => listPlatformBackups(sql, other.owner_id), /Forbidden/);
    await assert.rejects(() => deletePlatformBackup(sql, other.owner_id, "ispsolutions-20260920T180000Z.dump"), /Forbidden/);
    await assert.rejects(() => saveBackupRetention(sql, other.owner_id, 7), /Forbidden/);

    const listed = await listPlatformBackups(sql, admin.id);
    assert.equal(listed.available, true);
    assert.equal(listed.backups[0]?.name, "ispsolutions-20260920T180000Z.dump");
    assert.equal(listed.backup_keep, 14);

    await assert.rejects(() => saveBackupRetention(sql, admin.id, 0), /at least 1/);
    const saved = await saveBackupRetention(sql, admin.id, 7);
    assert.equal(saved.backup_keep, 7);
    assert.equal((await listPlatformBackups(sql, admin.id)).backup_keep, 7);

    await assert.rejects(() => deletePlatformBackup(sql, admin.id, "../../etc/passwd"), /Invalid filename/);
    await deletePlatformBackup(sql, admin.id, "ispsolutions-20260920T180000Z.dump");
    assert.equal((await listPlatformBackups(sql, admin.id)).backups.length, 0);

    const audits = await sql<{ action: string; metadata: string }>`
      select action, metadata from platform_audit_log where actor_user_id = ${admin.id} order by created_at`;
    assert.ok(audits.some((a) => a.action === "DELETE_BACKUP" && a.metadata.includes("ispsolutions-20260920T180000Z.dump")));
    assert.ok(audits.some((a) => a.action === "BACKUP_RETENTION" && a.metadata.includes('"previous":14') && a.metadata.includes('"next":7')));
  } finally {
    if (previous === undefined) delete process.env.ISPSOLUTIONS_BACKUP_DIR;
    else process.env.ISPSOLUTIONS_BACKUP_DIR = previous;
    await close();
  }
});

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
    await archiveCatalogPlan(sql, admin.id, "starter", "archived");
    const publicPlans = await publicCatalog(sql);
    assert.ok(publicPlans.some((p) => p.code === "pro_plus"));
    assert.ok(!publicPlans.some((p) => p.code === "starter"));
    assert.ok(publicPlans.find((p) => p.code === "growth")?.features.some((f) => f.id === "whatsapp"));
    assert.equal(annualSavingsPct(4999, 49990), 17);
    assert.equal(annualSavingsPct(1000, 12000), 0);
    assert.equal(isSalesContactPlan({ monthly_kes: 0, annual_kes: 0, trial_days: 0 }), true);
    assert.equal(isSalesContactPlan({ monthly_kes: 0, annual_kes: 0, trial_days: 14 }), false);

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
      postgres_ok: true,
      redis_ok: true,
      genieacs_ok: false,
      reported_at: new Date().toISOString(),
    });
    assert.equal(ok.ok, true);
    const overview = await loadPlatformOverview(sql, admin.id);
    assert.equal(typeof overview.revenue.mrr, "number");
    assert.equal(overview.infrastructure.cpu, 22);
    assert.equal(overview.infrastructure.ram, 41);
    assert.equal(overview.infrastructure.disk, 18);
    assert.equal(overview.infrastructure.vps_name, "nbo-edge-1");
    assert.equal(overview.infrastructure.online, 1);
    assert.equal(overview.infrastructure.health, "healthy");
    assert.equal(overview.infrastructure.stale, false);
    assert.ok(overview.infrastructure.last_seen);
    assert.ok(overview.infrastructure.last_checked_at);
    assert.equal(overview.infrastructure.cpu_cores, null);
    assert.equal(overview.infrastructure.ram_used, null);
    assert.equal(overview.infrastructure.ram_total, null);
    assert.equal(overview.infrastructure.disk_used, null);
    assert.equal(overview.infrastructure.disk_total, null);
    assert.equal(overview.infrastructure.services?.healthy, 2);
    assert.equal(overview.infrastructure.services?.failed, 1);
    assert.ok(["healthy", "warning", "critical", "offline", "unknown"].includes(overview.infrastructure.health));
    const detail = await loadTenantDetail(sql, admin.id, other.tenant_id);
    assert.equal(detail.infrastructure.ram, null);
    assert.ok(detail.nodes.some((n) => n.name === "nbo-edge-1" && n.cpu_pct === 22));
    await assert.rejects(() => loadPlatformOverview(sql, other.owner_id), /Forbidden/);
  } finally {
    await close();
  }
});

test("overview infrastructure uses live telemetry and never invents capacity", async () => {
  const empty = overviewFromInfraNodes([]);
  assert.equal(empty.available, false);
  assert.equal(empty.cpu, null);
  assert.equal(empty.ram, null);
  assert.equal(empty.disk, null);
  assert.notEqual(empty.cpu, 0);
  assert.notEqual(empty.ram, 0);
  assert.notEqual(empty.disk, 0);
  assert.equal(empty.cpu_cores, null);
  assert.equal(empty.services, null);
  assert.equal(empty.health, "unknown");

  const now = Date.parse("2026-09-17T12:00:00.000Z");
  const live = overviewFromInfraNodes(
    [
      {
        name: "Application VPS",
        last_seen: new Date(now - 15_000).toISOString(),
        cpu_pct: 34,
        ram_pct: 61,
        disk_pct: 48,
        postgres_ok: true,
        redis_ok: true,
        genieacs_ok: true,
      },
    ],
    now,
  );
  assert.equal(live.cpu, 34);
  assert.equal(live.ram, 61);
  assert.equal(live.disk, 48);
  assert.equal(live.vps_name, "Application VPS");
  assert.equal(live.health, "healthy");
  assert.equal(live.stale, false);
  assert.equal(live.cpu_cores, null);

  const stale = overviewFromInfraNodes(
    [
      {
        name: "Application VPS",
        last_seen: new Date(now - 20 * 60_000).toISOString(),
        cpu_pct: 34,
        ram_pct: 61,
        disk_pct: 48,
        postgres_ok: true,
        redis_ok: null,
        genieacs_ok: false,
      },
    ],
    now,
  );
  assert.equal(stale.stale, true);
  assert.equal(stale.health, "offline");
  assert.equal(stale.available, true);
  assert.equal(stale.cpu, 34);
  assert.equal(stale.services?.healthy, 1);
  assert.equal(stale.services?.failed, 1);

  const fleet = overviewFromInfraNodes(
    [
      {
        name: "app-1",
        last_seen: new Date(now - 5_000).toISOString(),
        cpu_pct: 20,
        ram_pct: 40,
        disk_pct: 10,
        postgres_ok: true,
        redis_ok: true,
        genieacs_ok: true,
      },
      {
        name: "app-2",
        last_seen: new Date(now - 20 * 60_000).toISOString(),
        cpu_pct: 90,
        ram_pct: 90,
        disk_pct: 90,
        postgres_ok: false,
        redis_ok: false,
        genieacs_ok: false,
      },
    ],
    now,
  );
  assert.equal(fleet.vps_count, 2);
  assert.equal(fleet.online, 1);
  assert.equal(fleet.offline, 1);
  assert.equal(fleet.vps_name, "");
  assert.equal(fleet.cpu, 20);
  assert.equal(fleet.stale, true);
  assert.equal(fleet.health, "warning");

  const dash = readFileSync(new URL("../../routes/platform/index.tsx", import.meta.url), "utf8");
  assert.match(dash, /Not available/);
  assert.match(dash, /Infrastructure data unavailable/);
  assert.doesNotMatch(dash, /CPU:\s*34%/);
  assert.doesNotMatch(dash, /Math\.random/);
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

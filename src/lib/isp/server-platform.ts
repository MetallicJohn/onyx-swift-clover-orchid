import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  addStaffMember,
  createIspWithOwner,
  isPlatformAdmin,
  loadAuthUser,
  setCredentialPassword,
} from "./accounts";
import { listPlans, publicCatalog, type PlanInput } from "./plans";
import {
  archiveCatalogPlan,
  assignTenantPlan,
  cancelTenantSubscription,
  endSupportAccess,
  extendTrial,
  getPlatformSettings,
  listInfrastructure,
  listPlatformActivity,
  listPlatformTenantsPage,
  listSubscriptionsDesk,
  loadPlatformOverview,
  loadPlatformReports,
  loadRevenueDesk,
  loadTenantDetail,
  platformSearch,
  reactivateTenant,
  registerInfraNode,
  reportsToCsv,
  requirePlatformActor,
  saveCatalogPlan,
  savePlatformSettings,
  startSupportAccess,
  suspendTenant,
  updateTenantProfile,
  writePlatformAudit,
} from "./platform";
import { applyRls } from "./rls";

async function platformSql(userId: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const actor = await requirePlatformActor(sql, userId);
  return { sql, ...actor };
}

export const getPlatformGate = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    const admin = await isPlatformAdmin(sql, context.userId);
    if (!admin) return { admin: false as const, email: "", name: "" };
    const user = await loadAuthUser(sql, context.userId);
    return { admin: true as const, email: user?.email || "", name: user?.name || "" };
  });

export const getPlatformOverview = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return loadPlatformOverview(sql, context.userId);
  });

export const listSaasTenants = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; status?: string; plan?: string; page?: number; pageSize?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return listPlatformTenantsPage(sql, context.userId, data);
  });

export const getSaasTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return loadTenantDetail(sql, context.userId, data.tenant_id);
  });

export const createSaasTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { isp_name: string; owner_name: string; owner_email: string; owner_password: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, email } = await platformSql(context.userId);
    const created = await createIspWithOwner(sql, {
      ispName: data.isp_name,
      ownerName: data.owner_name,
      ownerEmail: data.owner_email,
      ownerPassword: data.owner_password,
    });
    await writePlatformAudit(sql, {
      actorUserId: context.userId,
      actorEmail: email,
      action: "tenant.created",
      entityType: "tenant",
      entityId: created.tenant_id,
      tenantId: created.tenant_id,
      metadata: { name: created.tenant_name, owner: created.owner_email },
    });
    return created;
  });

export const updateSaasTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      tenant_id: string;
      name?: string;
      support_email?: string;
      support_phone?: string;
      timezone?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return updateTenantProfile(sql, context.userId, data.tenant_id, data);
  });

export const suspendSaasTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return suspendTenant(sql, context.userId, data.tenant_id, data.reason);
  });

export const reactivateSaasTenant = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return reactivateTenant(sql, context.userId, data.tenant_id);
  });

export const assignSaasPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; plan: string; cycle?: "monthly" | "annual"; extend_days?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return assignTenantPlan(sql, context.userId, {
      tenantId: data.tenant_id,
      plan: data.plan,
      cycle: data.cycle,
      extend_days: data.extend_days,
    });
  });

export const extendSaasTrial = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; days: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return extendTrial(sql, context.userId, data.tenant_id, data.days);
  });

export const cancelSaasSubscription = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return cancelTenantSubscription(sql, context.userId, data.tenant_id);
  });

export const addSaasOperator = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; email: string; name: string; password: string; role: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, email } = await platformSql(context.userId);
    const member = await addStaffMember(sql, data.tenant_id, {
      email: data.email,
      name: data.name,
      password: data.password,
      role: data.role || "isp_owner",
    });
    await writePlatformAudit(sql, {
      actorUserId: context.userId,
      actorEmail: email,
      action: "operator.created",
      entityType: "user",
      entityId: member.user_id,
      tenantId: data.tenant_id,
      metadata: { email: member.email, role: member.role },
    });
    return member;
  });

export const resetSaasOperatorPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { email: string; password: string; tenant_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, email } = await platformSql(context.userId);
    const user = await setCredentialPassword(sql, data.email, data.password);
    await writePlatformAudit(sql, {
      actorUserId: context.userId,
      actorEmail: email,
      action: "operator.password_reset",
      entityType: "user",
      entityId: user.id,
      tenantId: data.tenant_id,
      metadata: { email: user.email },
    });
    return { email: user.email };
  });

export const listPublicPlans = createServerFn({ method: "GET" }).handler(async () => {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const plans = await publicCatalog(sql);
  await applyRls(sql, { bypass: false });
  return { plans };
});

export const listSaasPlans = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return { plans: await listPlans(sql, true) };
  });

export const saveSaasPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: PlanInput) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return saveCatalogPlan(sql, context.userId, data);
  });

export const setSaasPlanStatus = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { code: string; status: "active" | "archived" }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return archiveCatalogPlan(sql, context.userId, data.code, data.status);
  });

export const listSaasSubscriptions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return { rows: await listSubscriptionsDesk(sql, context.userId) };
  });

export const getSaasRevenue = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return loadRevenueDesk(sql, context.userId);
  });

export const getSaasInfrastructure = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return listInfrastructure(sql, context.userId);
  });

export const enrollSaasNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return registerInfraNode(sql, context.userId, data.tenant_id, data.name);
  });

export const getSaasReports = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from?: string; to?: string; plan?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return loadPlatformReports(sql, context.userId, data);
  });

export const exportSaasReportsCsv = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { from?: string; to?: string; plan?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const report = await loadPlatformReports(sql, context.userId, data);
    return { filename: `isp-solutions-report-${report.from}-to-${report.to}.csv`, csv: reportsToCsv(report) };
  });

export const getSaasActivity = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; page?: number; pageSize?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return listPlatformActivity(sql, context.userId, data);
  });

export const searchSaas = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return platformSearch(sql, context.userId, data.q);
  });

export const getSaasSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return getPlatformSettings(sql);
  });

export const saveSaasSettings = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      grace_days?: number;
      past_due_days?: number;
      trial_days?: number;
      support_access_enabled?: boolean;
      support_access_minutes?: number;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return savePlatformSettings(sql, context.userId, data);
  });

export const startSaasSupport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return startSupportAccess(sql, context.userId, data.tenant_id, data.reason);
  });

export const endSaasSupport = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    return endSupportAccess(sql, context.userId);
  });

export const getMyEntitlements = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, workspace } = await import("./workspace").then((m) => m.requireWs(context.userId));
    const { entitlementsForTenant } = await import("./plans");
    const features = await entitlementsForTenant(sql, tenantId);
    return { features, supportMode: Boolean(workspace.supportMode), supportReason: workspace.supportReason || "", supportExpiresAt: workspace.supportExpiresAt || "", tenantStatus: workspace.status };
  });

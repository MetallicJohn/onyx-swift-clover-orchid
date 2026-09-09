import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { queueAcsTask } from "./acs";
import { generateMikrotikScript } from "./ai-mikrotik";
import { redeemLoyalty } from "./loyalty";
import { assertPermission } from "./rbac";
import { attachCustomerReseller } from "./resellers";
import { applySaasPayment, createSaasStkIntent, loadPlanDesk, requestPlanChange, type PlanCode } from "./saas";
import { assignTicket, commentTicket, listStaff } from "./tickets";
import { loadAudit, loadReports, loadStatement } from "./reports";
import { addBranch, addMemberByEmail, listBranches, setMemberRole } from "./members";
import { addStaffMember, createIspWithOwner, isPlatformAdmin, listAllTenants, setCredentialPassword } from "./accounts";
import { requireWorkspace as requireWs } from "./workspace";

export const assignOpenTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; user_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "tickets.manage");
    await assignTicket(sql, tenantId, data.id, data.user_id);
    return { ok: true };
  });

export const commentOpenTicket = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; body: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, role === "technician" ? "jobs.update" : "tickets.manage");
    await commentTicket(sql, tenantId, data.id, context.userId, data.body);
    return { ok: true };
  });

export const listTicketStaff = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return { staff: await listStaff(sql, tenantId) };
  });

export const queueCpeTask = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { cpe_id: string; kind: string; ssid?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return queueAcsTask(sql, tenantId, data.cpe_id, data.kind, { ssid: data.ssid || "" });
  });

export const listCpeTasks = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const tasks = await sql<{
      id: string;
      kind: string;
      status: string;
      result: string;
      serial: string;
      created_at: string;
    }>`select t.id, t.kind, t.status, t.result, d.serial, t.created_at::text as created_at
       from acs_tasks t join cpe_devices d on d.id = t.cpe_id
       where t.tenant_id = ${tenantId} order by t.created_at desc limit 30`;
    return { tasks };
  });

export const redeemPoints = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; points: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.manage");
    return redeemLoyalty(sql, tenantId, data.customer_id, data.points);
  });

export const linkReseller = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; reseller_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.manage");
    await attachCustomerReseller(sql, tenantId, data.customer_id, data.reseller_id);
    return { ok: true };
  });

export const getPlan = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return loadPlanDesk(sql, tenantId);
  });

export const setPlan = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { plan: PlanCode }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await requestPlanChange(sql, tenantId, data.plan);
    return loadPlanDesk(sql, tenantId);
  });

export const recordPlanPayment = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoice_id: string; provider: string; reference: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await applySaasPayment(sql, {
      tenantId,
      invoiceId: data.invoice_id,
      provider: data.provider || "mpesa",
      reference: data.reference.trim(),
    });
    return loadPlanDesk(sql, tenantId);
  });

export const sendPlanStk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoice_id: string; provider: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return createSaasStkIntent(sql, {
      tenantId,
      invoiceId: data.invoice_id,
      provider: data.provider || "mpesa",
    });
  });

export const askRouterOs = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { prompt: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return generateMikrotikScript(sql, tenantId, data.prompt);
  });

export const getReports = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return loadReports(sql, tenantId);
  });

export const getAuditLog = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "audit.read");
    return { rows: await loadAudit(sql, tenantId) };
  });

export const getStatement = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.read");
    return loadStatement(sql, tenantId, data.customer_id);
  });

export const getBranches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return { branches: await listBranches(sql, tenantId) };
  });

export const createBranch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return addBranch(sql, tenantId, data.name);
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { email: string; role: string; name?: string; password?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    if (data.password) {
      return addStaffMember(sql, tenantId, data);
    }
    return addMemberByEmail(sql, tenantId, data.email, data.role);
  });

export const createStaffAccount = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { email: string; role: string; name: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    if (!data.password || data.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }
    return addStaffMember(sql, tenantId, data);
  });

export const platformStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { applyRls } = await import("./rls");
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    return { admin: await isPlatformAdmin(sql, context.userId) };
  });

export const listPlatformTenants = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { getSql } = await import("@/lib/db");
    const { applyRls } = await import("./rls");
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    if (!(await isPlatformAdmin(sql, context.userId))) throw new Error("Forbidden");
    return { tenants: await listAllTenants(sql) };
  });

export const createIspAsAdmin = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { isp_name: string; owner_name: string; owner_email: string; owner_password: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { applyRls } = await import("./rls");
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    if (!(await isPlatformAdmin(sql, context.userId))) throw new Error("Forbidden");
    return createIspWithOwner(sql, {
      ispName: data.isp_name,
      ownerName: data.owner_name,
      ownerEmail: data.owner_email,
      ownerPassword: data.owner_password,
    });
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ context, data }) => {
    const { getSql } = await import("@/lib/db");
    const { applyRls } = await import("./rls");
    const sql = await getSql();
    await applyRls(sql, { bypass: true });
    if (!(await isPlatformAdmin(sql, context.userId))) throw new Error("Forbidden");
    const user = await setCredentialPassword(sql, data.email, data.password);
    return { email: user.email };
  });


export const changeMemberRole = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { user_id: string; role: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return setMemberRole(sql, tenantId, data.user_id, data.role);
  });

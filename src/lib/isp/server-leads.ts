import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  archiveLead,
  assignLead,
  convertLead,
  createLead,
  ensureLeadSources,
  exportLeadsCsv,
  findLeadCustomerMatches,
  getLead,
  leadReport,
  listLeads,
  logLeadActivity,
  recordCoverage,
  recordInstallation,
  scheduleFollowUp,
  setLeadStatus,
  updateLead,
  type LeadInput,
} from "./leads";
import { assertPermission, hasPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

function can(role: string) {
  return {
    view: hasPermission(role, "leads.view"),
    create: hasPermission(role, "leads.create"),
    update: hasPermission(role, "leads.update"),
    remove: hasPermission(role, "leads.delete"),
    assign: hasPermission(role, "leads.assign") || hasPermission(role, "leads.update"),
    coverage: hasPermission(role, "leads.coverage"),
    installation: hasPermission(role, "leads.installation"),
    convert: hasPermission(role, "leads.convert"),
    export: hasPermission(role, "leads.export"),
  };
}

export const listLeadsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; status?: string; coverage?: string; installation?: string; source?: string; assigned_to?: string; page?: number; sort?: string }) => d ?? {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.view");
    const list = await listLeads(sql, tenantId, data);
    const sources = await ensureLeadSources(sql, tenantId);
    const report = await leadReport(sql, tenantId);
    const packages = await sql<{ id: string; name: string; access_method: string; price_kes: number }>`
      select id, name, access_method, price_kes from packages where tenant_id = ${tenantId} and active = true order by name`;
    const staff = await sql<{ id: string; name: string; role: string }>`
      select m.user_id as id, coalesce(u.name, m.user_id) as name, m.role
      from tenant_members m left join "user" u on u.id = m.user_id
      where m.tenant_id = ${tenantId} order by 2`;
    return { ...list, sources, report, packages, staff, can: can(role) };
  });

export const getLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.view");
    const detail = await getLead(sql, tenantId, data.id);
    const matches = await findLeadCustomerMatches(sql, tenantId, detail.lead);
    return { ...detail, matches, can: can(role) };
  });

export const createLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: LeadInput) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.create");
    return createLead(sql, { tenantId, actorId: context.userId, input: data });
  });

export const updateLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string } & LeadInput) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.update");
    const { id, ...input } = data;
    return updateLead(sql, { tenantId, actorId: context.userId, leadId: id, input });
  });

export const setLeadStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; status: string; lost_reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.update");
    return setLeadStatus(sql, { tenantId, actorId: context.userId, leadId: data.id, status: data.status, lost_reason: data.lost_reason });
  });

export const recordCoverageFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; coverage_status: string; coverage_notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.coverage");
    return recordCoverage(sql, { tenantId, actorId: context.userId, leadId: data.id, coverage_status: data.coverage_status, coverage_notes: data.coverage_notes });
  });

export const recordInstallationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; installation_status: string; scheduled_installation_at?: string | null; assigned_technician?: string; installation_notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.installation");
    return recordInstallation(sql, {
      tenantId,
      actorId: context.userId,
      leadId: data.id,
      installation_status: data.installation_status,
      scheduled_installation_at: data.scheduled_installation_at,
      assigned_technician: data.assigned_technician,
      installation_notes: data.installation_notes,
    });
  });

export const scheduleFollowUpFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; next_follow_up_at: string; assigned_to?: string; note?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "leads.update") && !hasPermission(role, "leads.assign")) throw new Error("Forbidden");
    return scheduleFollowUp(sql, { tenantId, actorId: context.userId, leadId: data.id, next_follow_up_at: data.next_follow_up_at, assigned_to: data.assigned_to, note: data.note });
  });

export const logLeadActivityFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; activity_type: string; body?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.update");
    return logLeadActivity(sql, { tenantId, actorId: context.userId, leadId: data.id, activity_type: data.activity_type, body: data.body });
  });

export const assignLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; assigned_to: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "leads.assign") && !hasPermission(role, "leads.update")) throw new Error("Forbidden");
    return assignLead(sql, { tenantId, actorId: context.userId, leadId: data.id, assigned_to: data.assigned_to });
  });

export const archiveLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.delete");
    return archiveLead(sql, { tenantId, actorId: context.userId, leadId: data.id });
  });

export const convertLeadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: string;
      useCustomerId?: string;
      acknowledgeDuplicates?: boolean;
      expiryYmd?: string;
      onboardingType?: "new" | "continuing";
      activation?: "active" | "after_payment" | "after_partial";
      sendNotification?: boolean;
      confirmed?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWs(context.userId);
    assertPermission(role, "leads.convert");
    return convertLead(sql, {
      tenantId,
      tenantName,
      actorId: context.userId,
      leadId: data.id,
      useCustomerId: data.useCustomerId,
      acknowledgeDuplicates: data.acknowledgeDuplicates,
      expiryYmd: data.expiryYmd,
      onboardingType: data.onboardingType,
      activation: data.activation,
      sendNotification: data.sendNotification,
      confirmed: data.confirmed === true,
      canActivateNow: hasPermission(role, "services.activate_now"),
      canOverrideExpiry: hasPermission(role, "services.expiry.update"),
    });
  });

export const exportLeadsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "leads.export");
    return { csv: await exportLeadsCsv(sql, tenantId) };
  });

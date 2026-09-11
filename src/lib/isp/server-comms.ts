import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { loadAuthUser } from "./accounts";
import {
  audienceOptions,
  createCampaign,
  deleteCommTemplate,
  dispatchCampaign,
  listCampaignRecipients,
  listCampaigns,
  listCommTemplates,
  loadCampaign,
  recentDuplicate,
  resendFailed,
  resolveAudience,
  saveCommTemplate,
  summarizeAudience,
} from "./comms";
import type { AudienceFilter, CommCategory, CommExtras } from "./comms-format";
import { getMessagingSettings } from "./messaging";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

async function actorLabel(sql: Awaited<ReturnType<typeof requireWs>>["sql"], userId: string) {
  const profile = await loadAuthUser(sql, userId);
  return profile?.name || profile?.email || userId;
}

async function audit(
  sql: Awaited<ReturnType<typeof requireWs>>["sql"],
  tenantId: string,
  userId: string,
  action: string,
  entityId: string,
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, 'campaign', ${entityId})`;
}

export const getCommsMetaFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, tenantName, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "communications.view");
    const settings = await getMessagingSettings(sql, tenantId);
    const templates = await listCommTemplates(sql, tenantId);
    const options = await audienceOptions(sql, tenantId);
    return {
      company: tenantName,
      slug: workspace.slug,
      support: workspace.supportPhone || workspace.supportEmail || "",
      sender_id: settings.sms_sender_id || "not set",
      provider: settings.sms_provider,
      sandbox: settings.sms_sandbox,
      templates,
      packages: options.packages,
      areas: options.areas,
      types: options.types,
      tags: options.tags,
      role,
    };
  });

export const previewAudienceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { filter: AudienceFilter; page?: number; pageSize?: number; skipped?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.view");
    const all = await resolveAudience(sql, tenantId, data.filter);
    const summary = summarizeAudience(all);
    const skippedOnly = Boolean(data.skipped);
    const pool = skippedOnly ? all.filter((r) => !r.phone_ok) : all;
    const page = Math.max(1, data.page ?? 1);
    const pageSize = Math.min(50, Math.max(1, data.pageSize ?? 20));
    const start = (page - 1) * pageSize;
    const rows = pool.slice(start, start + pageSize).map((r) => ({
      customer_id: r.customer_id,
      name: r.name,
      phone: r.phone_ok ? r.phone : r.phone || "—",
      service: r.access_method,
      package_name: r.package_name,
      status: r.service_status,
      location: r.address,
      phone_ok: r.phone_ok,
    }));
    return { ...summary, page, pageSize, rows, pool: pool.length };
  });

export const sendCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      category: CommCategory;
      name?: string;
      body: string;
      template_id?: string;
      filter: AudienceFilter;
      extras?: CommExtras;
      confirm_duplicate?: boolean;
      restore_of?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "communications.send");
    const dup = await recentDuplicate(sql, tenantId, data.category, data.body.trim(), data.filter);
    if (dup && !data.confirm_duplicate) {
      return {
        duplicate: true as const,
        previous: dup,
        message: "You recently sent this message to the same group.",
      };
    }
    const label = await actorLabel(sql, context.userId);
    const created = await createCampaign(sql, {
      tenantId,
      slug: workspace.slug,
      company: tenantName,
      support: workspace.supportPhone || workspace.supportEmail || "",
      category: data.category,
      name: data.name,
      body: data.body,
      templateId: data.template_id,
      filter: data.filter,
      extras: data.extras,
      actorId: context.userId,
      actorLabel: label,
      restoreOf: data.restore_of,
    });
    await audit(sql, tenantId, context.userId, "campaign.created", created.id);
    const campaign = await dispatchCampaign(sql, tenantId, created.id);
    await audit(sql, tenantId, context.userId, "campaign.sent", created.id);
    return { duplicate: false as const, campaign };
  });

export const tickCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.send");
    return dispatchCampaign(sql, tenantId, data.id);
  });

export const listCampaignsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.view");
    return { campaigns: await listCampaigns(sql, tenantId) };
  });

export const getCampaignFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; page?: number; status?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.view");
    const campaign = await loadCampaign(sql, tenantId, data.id);
    const recipients = await listCampaignRecipients(sql, tenantId, data.id, {
      page: data.page,
      status: data.status,
    });
    return { campaign, recipients };
  });

export const resendFailedFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "communications.send");
    const label = await actorLabel(sql, context.userId);
    const campaign = await resendFailed(sql, tenantId, data.id, {
      id: context.userId,
      label,
      slug: workspace.slug,
      company: tenantName,
      support: workspace.supportPhone || workspace.supportEmail || "",
    });
    await audit(sql, tenantId, context.userId, "campaign.resend", campaign.id);
    return { campaign };
  });

export const listCommTemplatesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.view");
    return { templates: await listCommTemplates(sql, tenantId) };
  });

export const saveCommTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id?: string; category: CommCategory; name: string; body: string; enabled?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.templates.manage");
    const id = await saveCommTemplate(sql, tenantId, data);
    await audit(sql, tenantId, context.userId, data.id ? "template.updated" : "template.created", id);
    return { id };
  });

export const deleteCommTemplateFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "communications.templates.manage");
    await deleteCommTemplate(sql, tenantId, data.id);
    await audit(sql, tenantId, context.userId, "template.deleted", data.id);
    return { ok: true };
  });

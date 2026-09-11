import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { assertPermission } from "./rbac";
import {
  broadcastToCustomers,
  bulkAssignTags,
  createTag,
  deleteTag,
  listTags,
  renameTag,
  setCustomerTags,
  setTagEnabled,
} from "./tags";
import { requireWorkspace as requireWs } from "./workspace";

async function audit(
  sql: Awaited<ReturnType<typeof requireWs>>["sql"],
  tenantId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${entityType}, ${entityId})`;
}

export const listCustomerTagsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.read");
    return { tags: await listTags(sql, tenantId) };
  });

export const createCustomerTagFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const tag = await createTag(sql, tenantId, data.name);
    await audit(sql, tenantId, context.userId, "tag.created", "customer_tag", tag.id);
    return tag;
  });

export const renameCustomerTagFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; name: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const tag = await renameTag(sql, tenantId, data.id, data.name);
    await audit(sql, tenantId, context.userId, "tag.renamed", "customer_tag", tag.id);
    return tag;
  });

export const setCustomerTagEnabledFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; enabled: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await setTagEnabled(sql, tenantId, data.id, data.enabled);
    await audit(sql, tenantId, context.userId, data.enabled ? "tag.enabled" : "tag.disabled", "customer_tag", data.id);
    return { ok: true };
  });

export const deleteCustomerTagFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await deleteTag(sql, tenantId, data.id);
    await audit(sql, tenantId, context.userId, "tag.deleted", "customer_tag", data.id);
    return { ok: true };
  });

export const setCustomerTagsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; tag_ids: string[] }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.manage");
    await setCustomerTags(sql, tenantId, data.customer_id, data.tag_ids);
    await audit(sql, tenantId, context.userId, "customer.tags", "customer", data.customer_id);
    return { ok: true };
  });

export const bulkCustomerTagsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_ids: string[]; tag_ids: string[]; op: "add" | "remove" }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.manage");
    const result = await bulkAssignTags(sql, tenantId, data.customer_ids, data.tag_ids, data.op);
    await audit(sql, tenantId, context.userId, data.op === "add" ? "customer.tags.bulk_add" : "customer.tags.bulk_remove", "customer", data.customer_ids[0] || "");
    return result;
  });

export const broadcastCustomersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_ids: string[]; channels: Array<"sms" | "in_app">; subject: string; body: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "customers.manage");
    const result = await broadcastToCustomers(sql, {
      tenantId,
      customerIds: data.customer_ids,
      channels: data.channels,
      subject: data.subject,
      body: data.body,
    });
    await audit(sql, tenantId, context.userId, "customer.broadcast", "customer", data.customer_ids[0] || "");
    return result;
  });

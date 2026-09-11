import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { loadAuthUser } from "./accounts";
import {
  extendGrace,
  getGracePolicy,
  grantGrace,
  revokeGrace,
  saveGracePolicy,
  type GracePolicy,
} from "./grace";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

async function actorLabel(sql: Awaited<ReturnType<typeof requireWs>>["sql"], userId: string) {
  const profile = await loadAuthUser(sql, userId);
  return profile?.name || profile?.email || userId;
}

export const getGracePolicyFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    return getGracePolicy(sql, tenantId);
  });

export const saveGracePolicyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: Partial<Omit<GracePolicy, "tenant_id" | "staff_preset_days" | "customer_preset_days">> & {
      staff_preset_days?: number[] | string;
      customer_preset_days?: number[] | string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return saveGracePolicy(sql, tenantId, data);
  });

export const grantGraceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; days: number; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWs(context.userId);
    assertPermission(role, "services.grace.grant");
    const policy = await getGracePolicy(sql, tenantId);
    if (!policy.allow_custom_days && !policy.staff_preset_days.includes(Math.round(data.days))) {
      throw new Error("That number of days is not in the allowed list.");
    }
    const label = await actorLabel(sql, context.userId);
    return grantGrace(sql, {
      tenantId,
      serviceId: data.service_id,
      days: data.days,
      reason: data.reason,
      actorType: "staff",
      actorId: context.userId,
      actorLabel: label,
      ispName: tenantName,
      maxDays: policy.allow_custom_days ? policy.staff_max_days : Math.max(...policy.staff_preset_days, 1),
    });
  });

export const extendGraceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; days: number; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWs(context.userId);
    assertPermission(role, "services.grace.extend");
    const policy = await getGracePolicy(sql, tenantId);
    const label = await actorLabel(sql, context.userId);
    return extendGrace(sql, {
      tenantId,
      serviceId: data.service_id,
      days: data.days,
      reason: data.reason,
      actorType: "staff",
      actorId: context.userId,
      actorLabel: label,
      ispName: tenantName,
      maxDays: policy.staff_max_days,
    });
  });

export const revokeGraceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "services.grace.revoke");
    return revokeGrace(sql, {
      tenantId,
      serviceId: data.service_id,
      reason: data.reason,
      actorId: context.userId,
    });
  });

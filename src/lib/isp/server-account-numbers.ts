import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  auditAccountChange,
  changeServiceAccountNumber,
  defaultsForSlug,
  formatFromSettings,
  getAccountNumberSettings,
  previewNextAccountNumber,
  resetAccountNumberSettings,
  saveAccountNumberSettings,
  sequenceKind,
  type AccountNumberPatch,
} from "./account-numbers";
import { hasPermission, assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

export const getAccountNumberSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    if (!hasPermission(role, "settings.manage") && !hasPermission(role, "customers.read")) {
      throw new Error("Forbidden");
    }
    const desk = await previewNextAccountNumber(sql, tenantId, workspace.slug);
    return {
      ...desk,
      slug_prefix: defaultsForSlug(workspace.slug).prefix,
    };
  });

export const saveAccountNumberSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: AccountNumberPatch) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const saved = await saveAccountNumberSettings(sql, tenantId, workspace.slug, data);
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.settings_updated",
      entityId: tenantId,
      details: `${saved.enabled ? "auto" : "manual"} ${
        sequenceKind(saved) === "random" ? "random 5-char" : formatFromSettings(saved, 0, "next")
      }`,
    });
    const desk = await previewNextAccountNumber(sql, tenantId, workspace.slug);
    return {
      ...desk,
      slug_prefix: defaultsForSlug(workspace.slug).prefix,
    };
  });

export const resetAccountNumberSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await resetAccountNumberSettings(sql, tenantId, workspace.slug);
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.settings_reset",
      entityId: tenantId,
    });
    const desk = await previewNextAccountNumber(sql, tenantId, workspace.slug);
    return {
      ...desk,
      slug_prefix: defaultsForSlug(workspace.slug).prefix,
    };
  });

export const changeServiceAccountNumberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; account_number: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "services.manage");
    const settings = await getAccountNumberSettings(sql, tenantId);
    const changed = await changeServiceAccountNumber(sql, {
      tenantId,
      serviceId: data.service_id,
      next: data.account_number,
      allowManual: settings.allow_manual,
    });
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.service_changed",
      entityId: data.service_id,
      entityType: "service",
      details: `${changed.previous || "(none)"} → ${changed.next}`,
    });
    return changed;
  });

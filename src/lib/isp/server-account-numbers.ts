import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  auditAccountChange,
  defaultsForSlug,
  formatAccountNumber,
  previewNextAccountNumber,
  resetAccountNumberSettings,
  saveAccountNumberSettings,
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
      example_start: formatAccountNumber({ ...desk, n: desk.start_n }),
      example_next: formatAccountNumber({ ...desk, n: desk.start_n + 1 }),
      example_third: formatAccountNumber({ ...desk, n: desk.start_n + 2 }),
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
      details: `${saved.enabled ? "auto" : "manual"} ${formatAccountNumber({ ...saved, n: saved.next_n })}`,
    });
    const desk = await previewNextAccountNumber(sql, tenantId, workspace.slug);
    return {
      ...desk,
      example_start: formatAccountNumber({ ...desk, n: desk.start_n }),
      example_next: formatAccountNumber({ ...desk, n: desk.start_n + 1 }),
      example_third: formatAccountNumber({ ...desk, n: desk.start_n + 2 }),
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
      example_start: formatAccountNumber({ ...desk, n: desk.start_n }),
      example_next: formatAccountNumber({ ...desk, n: desk.start_n + 1 }),
      example_third: formatAccountNumber({ ...desk, n: desk.start_n + 2 }),
      slug_prefix: defaultsForSlug(workspace.slug).prefix,
    };
  });

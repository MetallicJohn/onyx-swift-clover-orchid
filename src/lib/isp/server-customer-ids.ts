import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { auditAccountChange } from "./account-numbers";
import { getCustomerIdSettings, saveCustomerIdStart } from "./customer-ids";
import { hasPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

export const getCustomerIdSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "settings.manage") && !hasPermission(role, "customers.read") && !hasPermission(role, "customers.manage")) {
      throw new Error("Forbidden");
    }
    return getCustomerIdSettings(sql, tenantId);
  });

export const saveCustomerIdSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { start_n: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "settings.manage") && !hasPermission(role, "customers.manage")) {
      throw new Error("Forbidden");
    }
    const saved = await saveCustomerIdStart(sql, tenantId, data.start_n);
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "customer_id.settings_updated",
      entityId: tenantId,
      details: `start ${saved.start_n}; next ${saved.next_preview}`,
    });
    return saved;
  });

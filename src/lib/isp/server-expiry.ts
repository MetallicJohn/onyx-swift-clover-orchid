import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { loadAuthUser } from "./accounts";
import { assertPermission } from "./rbac";
import { setServiceExpiry } from "./service-expiry";
import { requireWorkspace } from "./workspace";

export const setServiceExpiryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; date: string; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "services.expiry.update");
    const profile = await loadAuthUser(sql, context.userId);
    return setServiceExpiry(sql, tenantId, {
      serviceId: data.id,
      ymd: data.date,
      reason: data.reason,
      actorId: context.userId,
      actorLabel: profile?.name || profile?.email || context.userId,
    });
  });

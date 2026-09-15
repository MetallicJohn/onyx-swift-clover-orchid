import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { queryCustomersDesk } from "./customer-desk";
import type { DeskFilters } from "./customer-desk-format";
import { queryServicesDesk } from "./service-desk";
import type { ServiceDeskFilters } from "./service-desk-format";
import { getGracePolicy } from "./grace";
import { assertPermission } from "./rbac";
import { requireWorkspace } from "./workspace";

export const queryCustomersDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: Partial<DeskFilters> | undefined) => d ?? {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "customers.read");
    const desk = await queryCustomersDesk(sql, tenantId, data);
    return { workspace, ...desk };
  });

export const queryServicesDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: Partial<ServiceDeskFilters> | undefined) => d ?? {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "services.read");
    const desk = await queryServicesDesk(sql, tenantId, data);
    const gracePolicy = await getGracePolicy(sql, tenantId);
    return { workspace, gracePolicy, ...desk };
  });

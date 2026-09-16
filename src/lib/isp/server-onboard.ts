import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertFeature, featureForAccess } from "./plans";
import { assertPermission, hasPermission } from "./rbac";
import { assertCustomerQuota, assertTenantOperable } from "./saas";
import {
  createOnboard,
  findCustomerDuplicates,
  loadOnboardCatalog,
  searchOnboardCustomers,
} from "./onboard-create";
import { sanitizeCustomer, sanitizePayload, type OnboardPayload } from "./onboard";
import { requireWorkspace } from "./workspace";

export const loadOnboardCatalogFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "customers.manage") && !hasPermission(role, "services.manage")) {
      throw new Error("Forbidden");
    }
    const catalog = await loadOnboardCatalog(sql, tenantId, workspace.slug);
    return {
      workspace,
      canCreateCustomer: hasPermission(role, "customers.manage"),
      canCreateService: hasPermission(role, "services.manage"),
      ...catalog,
    };
  });

export const searchOnboardCustomersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { q: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "customers.read") && !hasPermission(role, "services.manage")) {
      throw new Error("Forbidden");
    }
    const customers = await searchOnboardCustomers(sql, tenantId, data.q || "");
    return { customers };
  });

export const findOnboardDuplicatesFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; phone: string; email: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "customers.manage");
    const matches = await findCustomerDuplicates(sql, tenantId, sanitizeCustomer(data));
    return { matches };
  });

export const createOnboardFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: OnboardPayload) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    const payload = sanitizePayload(data);
    if (payload.customer_mode === "new") {
      assertPermission(role, "customers.manage");
      await assertCustomerQuota(sql, tenantId);
    } else if (!hasPermission(role, "services.manage") && !hasPermission(role, "customers.manage")) {
      throw new Error("Forbidden");
    }
    if (payload.include_service) {
      assertPermission(role, "services.manage");
      await assertTenantOperable(sql, tenantId);
      const method = payload.service?.access_method || "pppoe";
      await assertFeature(sql, tenantId, featureForAccess(method));
    }
    return createOnboard(sql, {
      tenantId,
      tenantName: workspace.tenantName,
      actorId: context.userId,
      input: payload,
    });
  });

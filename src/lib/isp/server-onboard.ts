import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertFeature, featureForAccess } from "./plans";
import { assertPermission, hasPermission } from "./rbac";
import { assertCustomerQuota, assertTenantOperable } from "./saas";
import { createOnboard, findCustomerDuplicates, loadOnboardCatalog, searchOnboardCustomers } from "./onboard-create";
import { confirmCustomerImport, previewCustomerImport } from "./onboard-import";
import { importTemplateCsv, isImportMode, type ImportColumnKey, type ImportMode } from "./onboard-import-format";
import { sanitizeCustomer, sanitizePayload, type OnboardPayload } from "./onboard";
import { allocatePppoeUsername, generatePppoePassword, pppoeUsernameFromName, suggestPppoeUsername } from "./pppoe-credentials";
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
      canActivateNow: hasPermission(role, "services.activate_now"),
      canOverrideExpiry: hasPermission(role, "services.expiry.update"),
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

export const suggestPppoeCredentialsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id?: string; name?: string; except_service_id?: string; skip_username?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "services.manage") && !hasPermission(role, "customers.manage")) {
      throw new Error("Forbidden");
    }
    let name = String(data.name || "").trim();
    if (data.customer_id) {
      const [cus] = await sql<{ name: string }>`
        select name from customers where id = ${data.customer_id} and tenant_id = ${tenantId} and deleted_at is null`;
      if (cus?.name) name = cus.name;
    }
    const preferred = pppoeUsernameFromName(name) || suggestPppoeUsername({ name, serviceId: data.except_service_id || "new" });
    const username = await allocatePppoeUsername(
      sql,
      tenantId,
      data.except_service_id || "",
      preferred,
      data.skip_username || "",
    );
    return { username, password: generatePppoePassword() };
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
      canActivateNow: hasPermission(role, "services.activate_now"),
      canOverrideExpiry: hasPermission(role, "services.expiry.update"),
    });
  });

export const previewCustomerImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string; mode: ImportMode; map?: Record<ImportColumnKey, string> }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "customers.manage");
    if (!isImportMode(data.mode)) throw new Error("Choose an import mode");
    return previewCustomerImport(sql, tenantId, {
      text: data.text || "",
      mode: data.mode,
      map: data.map,
    });
  });

export const confirmCustomerImportFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { text: string; mode: ImportMode; map?: Record<ImportColumnKey, string> }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "customers.manage");
    await assertTenantOperable(sql, tenantId);
    await assertCustomerQuota(sql, tenantId);
    if (!isImportMode(data.mode)) throw new Error("Choose an import mode");
    return confirmCustomerImport(sql, {
      tenantId,
      tenantName: workspace.tenantName,
      actorId: context.userId,
      input: { text: data.text || "", mode: data.mode, map: data.map },
      canActivateNow: hasPermission(role, "services.activate_now"),
    });
  });

export const importTemplateCsvFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "customers.manage") && !hasPermission(role, "customers.read")) {
      throw new Error("Forbidden");
    }
    return { csv: importTemplateCsv() };
  });

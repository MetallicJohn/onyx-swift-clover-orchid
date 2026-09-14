import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { loadAuthUser } from "./accounts";
import { assertPermission, hasPermission } from "./rbac";
import {
  archiveCustomer,
  archiveService,
  listArchivedServicesForCustomer,
  listRecycleBin,
  PERMANENT_DELETE_PHRASE,
  purgeCustomer,
  purgeService,
  recycleCounts,
  restoreCustomer,
  restoreService,
} from "./recycle-bin";
import { requireWorkspace } from "./workspace";

async function actorLabel(sql: Awaited<ReturnType<typeof requireWorkspace>>["sql"], userId: string) {
  const profile = await loadAuthUser(sql, userId);
  return profile?.name || profile?.email || userId;
}

export const listRecycleBinFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      kind?: "all" | "customer" | "service";
      q?: string;
      access_method?: string;
      original_status?: string;
      deleted_by?: string;
      from?: string;
      to?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.view");
    const rows = await listRecycleBin(sql, tenantId, data || {});
    const counts = await recycleCounts(sql, tenantId);
    const customers = await sql<{ id: string; name: string; account_number: string }>`
      select id, name, coalesce(account_number,'') as account_number
      from customers where tenant_id = ${tenantId} and deleted_at is null
      order by name`;
    const packages = await sql<{ id: string; name: string }>`
      select id, name from packages where tenant_id = ${tenantId} and active = true order by name`;
    return {
      workspace,
      rows,
      counts,
      customers,
      packages,
      canRestoreCustomer: hasPermission(role, "recycle_bin.restore_customer"),
      canRestoreService: hasPermission(role, "recycle_bin.restore_service"),
      canPurge: hasPermission(role, "recycle_bin.permanent_delete"),
      confirmPhrase: PERMANENT_DELETE_PHRASE,
    };
  });

export const listArchivedServicesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.view");
    return listArchivedServicesForCustomer(sql, tenantId, data.customer_id);
  });

export const restoreCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; reason: string; service_ids?: string[]; restore_all?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.restore_customer");
    const label = await actorLabel(sql, context.userId);
    return restoreCustomer(sql, tenantId, data.id, {
      actorId: context.userId,
      actorLabel: label,
      reason: data.reason,
      serviceIds: data.service_ids,
      restoreAllServices: Boolean(data.restore_all),
    });
  });

export const restoreServiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; reason: string; customer_id?: string; package_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.restore_service");
    const label = await actorLabel(sql, context.userId);
    return restoreService(sql, tenantId, data.id, {
      actorId: context.userId,
      actorLabel: label,
      reason: data.reason,
      assignCustomerId: data.customer_id,
      packageId: data.package_id,
    });
  });

export const purgeCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; reason: string; confirm_phrase: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.permanent_delete");
    const label = await actorLabel(sql, context.userId);
    return purgeCustomer(sql, tenantId, data.id, {
      actorId: context.userId,
      actorLabel: label,
      reason: data.reason,
      confirmPhrase: data.confirm_phrase,
    });
  });

export const purgeServiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; reason: string; confirm_phrase: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "recycle_bin.permanent_delete");
    const label = await actorLabel(sql, context.userId);
    return purgeService(sql, tenantId, data.id, {
      actorId: context.userId,
      actorLabel: label,
      reason: data.reason,
      confirmPhrase: data.confirm_phrase,
    });
  });

export { archiveCustomer, archiveService };

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { loadAuthUser } from "./accounts";
import {
  customerTraffic,
  deleteCustomer,
  deleteService,
  listAssignedServices,
  loadCustomerRecord,
  loadServiceRecord,
  reassignService,
  searchReassignCustomers,
  updateService,
} from "./customer-lifecycle";
import { assertPermission, hasPermission } from "./rbac";
import { requireWorkspace } from "./workspace";

async function writeAudit(
  sql: Awaited<ReturnType<typeof requireWorkspace>>["sql"],
  tenantId: string,
  userId: string,
  action: string,
  entityType: string,
  entityId: string,
  details = "",
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${entityType}, ${entityId}, ${details})`;
}

export const getCustomerFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "customers.read");
    const record = await loadCustomerRecord(sql, tenantId, data.id);
    return { workspace, ...record };
  });

export const getServiceFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "services.read");
    const record = await loadServiceRecord(sql, tenantId, data.id);
    return { workspace, ...record };
  });

export const deleteServiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; reason: string; confirm?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "services.delete") && !hasPermission(role, "services.manage")) {
      throw new Error("Forbidden");
    }
    if (!data.confirm) throw new Error("Confirm deleting this service");
    const reason = String(data.reason || "").trim();
    if (!reason) throw new Error("A reason is required");
    const profile = await loadAuthUser(sql, context.userId);
    const out = await deleteService(sql, tenantId, data.id, {
      actorId: context.userId,
      actorLabel: profile?.name || profile?.email || context.userId,
      reason,
    });
    return { ...out, reason };
  });

export const searchReassignCustomersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { q: string; excludeCustomerId?: string; limit?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "services.reassign") && !hasPermission(role, "services.manage") && !hasPermission(role, "customers.read")) {
      throw new Error("Forbidden");
    }
    const customers = await searchReassignCustomers(sql, tenantId, data.q || "", {
      excludeCustomerId: data.excludeCustomerId,
      limit: data.limit,
    });
    return { customers };
  });

export const reassignServiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; customer_id: string; confirm?: boolean; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "services.reassign") && !hasPermission(role, "services.manage")) {
      throw new Error("Forbidden");
    }
    if (!data.confirm) throw new Error("Confirm moving this service");
    const out = await reassignService(sql, tenantId, data.id, data.customer_id, { reason: data.reason });
    await writeAudit(
      sql,
      tenantId,
      context.userId,
      "service.reassigned",
      "service",
      data.id,
      JSON.stringify({
        service_id: out.id,
        service_account_number: out.service_account,
        from: out.from,
        from_name: out.from_name,
        to: out.to,
        to_name: out.to_name,
        reason: out.reason,
        trigger_billing: false,
        send_customer_notifications: false,
      }),
    );
    return out;
  });

export const updateServiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: string;
      package_id?: string;
      username?: string | null;
      static_ip?: string | null;
      mac_address?: string;
      customer_id?: string;
      notes?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "services.manage");
    if (data.customer_id) {
      if (!hasPermission(role, "services.reassign") && !hasPermission(role, "services.manage")) {
        throw new Error("Forbidden");
      }
    }
    const out = await updateService(sql, tenantId, data);
    await writeAudit(sql, tenantId, context.userId, "service.updated", "service", data.id, JSON.stringify({
      package_id: data.package_id || "",
      customer_id: data.customer_id || "",
    }));
    return out;
  });

export const deleteCustomerFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; delete_services?: boolean; confirm?: boolean; reason: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "customers.delete") && !hasPermission(role, "customers.manage")) {
      throw new Error("Forbidden");
    }
    if (!data.confirm) throw new Error("Confirm deleting this customer");
    const reason = String(data.reason || "").trim();
    if (!reason) throw new Error("A reason is required");
    if (data.delete_services) {
      if (!hasPermission(role, "services.delete") && !hasPermission(role, "services.manage") && !hasPermission(role, "customers.manage")) {
        throw new Error("Forbidden");
      }
    }
    const leftover = await listAssignedServices(sql, tenantId, data.id);
    const profile = await loadAuthUser(sql, context.userId);
    const out = await deleteCustomer(sql, tenantId, data.id, {
      deleteServices: Boolean(data.delete_services),
      actorId: context.userId,
      actorLabel: profile?.name || profile?.email || context.userId,
      reason,
    });
    return { ...out, leftover_before: leftover.map((s) => s.id) };
  });

export const customerTrafficFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; service_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "traffic.view") && !hasPermission(role, "services.read")) {
      throw new Error("Forbidden");
    }
    const traffic = await customerTraffic(sql, tenantId, data.customer_id);
    if (data.service_id) {
      return { ...traffic, lines: traffic.lines.filter((l) => l.service_id === data.service_id) };
    }
    return traffic;
  });

export const customerTrafficHistoryFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; service_id?: string; hours?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    if (!hasPermission(role, "traffic.view") && !hasPermission(role, "services.read")) {
      throw new Error("Forbidden");
    }
    const { customerTrafficHistory, serviceTrafficHistory } = await import("./traffic-aggregate.ts");
    if (data.service_id) return serviceTrafficHistory(sql, tenantId, data.service_id, { hours: data.hours });
    return customerTrafficHistory(sql, tenantId, data.customer_id, { hours: data.hours });
  });

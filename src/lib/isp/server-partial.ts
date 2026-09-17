import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  approvePartialPayment,
  describePartialDesk,
  getPartialPolicy,
  saveCustomerPartial,
  savePartialPolicy,
  saveServicePartial,
  type PartialPaymentPolicy,
} from "./partial-payment";
import type { PartialPolicySnapshot } from "./partial-payment-format.ts";
import { assertPermission, hasPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

export const getPartialPolicyFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return getPartialPolicy(sql, tenantId);
  });

export const savePartialPolicyFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: Partial<PartialPolicySnapshot>) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return savePartialPolicy(sql, tenantId, data, context.userId);
  });

export const getPartialDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { customer_id?: string; service_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "invoices.read") && !hasPermission(role, "customers.read") && !hasPermission(role, "services.read")) {
      throw new Error("Forbidden");
    }
    return describePartialDesk(sql, tenantId, { customerId: data.customer_id, serviceId: data.service_id });
  });

export const saveCustomerPartialFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; enabled?: boolean | null; min_pct?: number | null; notes?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "billing.partial.manage");
    return saveCustomerPartial(sql, {
      tenantId,
      customerId: data.customer_id,
      actorId: context.userId,
      enabled: data.enabled,
      minPct: data.min_pct,
      notes: data.notes,
    });
  });

export const saveServicePartialFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; enabled?: boolean | null; min_pct?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "billing.partial.manage");
    return saveServicePartial(sql, {
      tenantId,
      serviceId: data.service_id,
      actorId: context.userId,
      enabled: data.enabled,
      minPct: data.min_pct,
    });
  });

export const approvePartialFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { event_id: string; approve: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, tenantName } = await requireWs(context.userId);
    assertPermission(role, "billing.partial.approve");
    return approvePartialPayment(sql, {
      tenantId,
      eventId: data.event_id,
      actorId: context.userId,
      approve: data.approve,
      ispName: tenantName,
    });
  });

export type { PartialPaymentPolicy };

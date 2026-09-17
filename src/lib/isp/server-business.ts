import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  describeCreditDesk,
  listBusinessCreditReport,
  saveCustomerCredit,
  saveServiceCredit,
  staffRestoreCredit,
  staffSuspendCredit,
} from "./business-credit";
import { assertPermission, hasPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

export const getCreditDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { customer_id?: string; service_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "billing.business_credit.view") && !hasPermission(role, "invoices.read")) {
      throw new Error("Forbidden");
    }
    return describeCreditDesk(sql, tenantId, { customerId: data.customer_id, serviceId: data.service_id });
  });

export const saveCustomerCreditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { customer_id: string; enabled?: boolean | null; max_kes?: number | null; warning_kes?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "billing.business_credit.manage");
    return saveCustomerCredit(sql, {
      tenantId,
      customerId: data.customer_id,
      actorId: context.userId,
      enabled: data.enabled,
      maxKes: data.max_kes,
      warningKes: data.warning_kes,
    });
  });

export const saveServiceCreditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; enabled?: boolean | null; max_kes?: number | null; warning_kes?: number | null }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "billing.business_credit.manage");
    if (data.max_kes != null) {
      const desk = await describeCreditDesk(sql, tenantId, { serviceId: data.service_id });
      if (desk.kind === "service" && data.max_kes > (desk.service.package_max_kes || 0)) {
        assertPermission(role, "billing.business_credit.approve");
      }
    }
    return saveServiceCredit(sql, {
      tenantId,
      serviceId: data.service_id,
      actorId: context.userId,
      enabled: data.enabled,
      maxKes: data.max_kes,
      warningKes: data.warning_kes,
    });
  });

export const suspendCreditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, tenantName } = await requireWs(context.userId);
    assertPermission(role, "billing.business_credit.suspend");
    return staffSuspendCredit(sql, {
      tenantId,
      serviceId: data.service_id,
      actorId: context.userId,
      ispName: tenantName,
    });
  });

export const restoreCreditFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; force?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, tenantName } = await requireWs(context.userId);
    assertPermission(role, "billing.business_credit.restore");
    if (data.force) assertPermission(role, "billing.business_credit.override");
    return staffRestoreCredit(sql, {
      tenantId,
      serviceId: data.service_id,
      actorId: context.userId,
      ispName: tenantName,
      force: Boolean(data.force),
    });
  });

export const getCreditReportFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "billing.business_credit.view") && !hasPermission(role, "invoices.read")) {
      throw new Error("Forbidden");
    }
    return listBusinessCreditReport(sql, tenantId);
  });

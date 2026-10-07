import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  apiPaymentPermission,
  exportApiPayments,
  exportApiPaymentsPdf,
  loadApiPaymentPayload,
  loadApiPayments,
  retryApiPayment,
  searchApiPaymentAccounts,
  type ApiPaymentQuery,
} from "./api-payments";
import { assignIncomingPayments } from "./incoming-payments";
import { requireWorkspace } from "./workspace";

function assertApi(role: string, action: "view" | "match" | "retry" | "export" | "payload") {
  if (!apiPaymentPermission(role, action)) throw new Error("Forbidden");
}

export const getApiPaymentsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: ApiPaymentQuery) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertApi(role, "view");
    const desk = await loadApiPayments(sql, tenantId, data);
    return {
      ...desk,
      role,
      canMatch: apiPaymentPermission(role, "match"),
      canRetry: apiPaymentPermission(role, "retry"),
      canExport: apiPaymentPermission(role, "export"),
      canPayload: apiPaymentPermission(role, "payload"),
    };
  });

export const searchApiPaymentAccountsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { q: string }) => ({ q: String(d?.q || "").slice(0, 80) }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertApi(role, "match");
    return { rows: await searchApiPaymentAccounts(sql, tenantId, data.q) };
  });

export const matchApiPaymentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; customer_id: string; service_id?: string }) => ({
    id: String(d?.id || ""),
    customer_id: String(d?.customer_id || ""),
    service_id: String(d?.service_id || ""),
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWorkspace(context.userId);
    assertApi(role, "match");
    return assignIncomingPayments(sql, {
      tenantId,
      ispName: tenantName,
      userId: context.userId,
      ids: [data.id],
      customerId: data.customer_id,
      serviceId: data.service_id || undefined,
    });
  });

export const retryApiPaymentFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => ({ id: String(d?.id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, tenantName, role } = await requireWorkspace(context.userId);
    assertApi(role, "retry");
    return retryApiPayment(sql, { tenantId, ispName: tenantName, userId: context.userId, id: data.id });
  });

export const exportApiPaymentsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: ApiPaymentQuery) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertApi(role, "export");
    return exportApiPayments(sql, tenantId, data);
  });

export const exportApiPaymentsPdfFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: ApiPaymentQuery) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertApi(role, "export");
    const file = await exportApiPaymentsPdf(sql, tenantId, data);
    return {
      filename: file.filename,
      base64: file.pdf.toString("base64"),
      truncated: file.truncated,
      exported: file.exported,
      total: file.total,
    };
  });

export const apiPaymentPayloadFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => ({ id: String(d?.id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertApi(role, "payload");
    return loadApiPaymentPayload(sql, tenantId, data.id);
  });

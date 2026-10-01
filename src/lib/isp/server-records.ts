import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertPermission } from "./rbac";
import { requireWorkspace } from "./workspace";

export const getPaymentRecordFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string }) => ({ id: String(data?.id || "").trim() }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "payments.read");
    const [row] = await sql<{
      id: string;
      customer_id: string;
      customer_name: string;
      invoice_id: string | null;
      invoice_number: string;
      provider: string;
      amount_kes: number;
      reference: string;
      status: string;
      paid_at: string;
    }>`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id,
             coalesce(i.number, '') as invoice_number, p.provider, p.amount_kes, p.reference, p.status,
             p.paid_at::text as paid_at
      from payments p
      join customers c on c.id = p.customer_id
      left join invoices i on i.id = p.invoice_id
      where p.id = ${data.id} and p.tenant_id = ${tenantId}`;
    if (!row) throw new Error("Payment not found");
    return { payment: row };
  });

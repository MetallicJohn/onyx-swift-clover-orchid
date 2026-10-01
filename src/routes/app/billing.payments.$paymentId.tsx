import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getPaymentRecordFn } from "@/lib/isp/server-records";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/billing/payments/$paymentId")({
  component: PaymentRecordPage,
});

function PaymentRecordPage() {
  const { paymentId } = Route.useParams();
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<Awaited<ReturnType<typeof getPaymentRecordFn>>["payment"] | null>(null);

  useEffect(() => {
    let cancel = false;
    getPaymentRecordFn({ data: { id: paymentId } })
      .then((row) => {
        if (!cancel) setPayment(row.payment);
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not open the payment");
      });
    return () => {
      cancel = true;
    };
  }, [paymentId]);

  return (
    <div className="space-y-4">
      <Link to="/app/billing" className="text-sm text-accent hover:underline">
        Billing
      </Link>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!payment && !error ? <p className="text-sm text-muted">Loading payment…</p> : null}
      {payment ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Payment</p>
          <h1 className="text-2xl font-semibold">{payment.provider} {payment.reference}</h1>
          <p className="mt-1 text-sm">
            {payment.customer_name} · {kes(payment.amount_kes)}
          </p>
          <div className="mt-2">
            <Badge>{payment.status}</Badge>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Paid</dt>
              <dd>{payment.paid_at}</dd>
            </div>
            <div>
              <dt className="text-muted">Invoice</dt>
              <dd>
                {payment.invoice_id ? (
                  <Link to="/app/billing/invoices/$invoiceId" params={{ invoiceId: payment.invoice_id }} className="text-accent hover:underline">
                    {payment.invoice_number || payment.invoice_id}
                  </Link>
                ) : (
                  "Not linked"
                )}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}

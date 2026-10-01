import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { getInvoice } from "@/lib/isp/server";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/billing/invoices/$invoiceId")({
  component: InvoiceRecordPage,
});

function InvoiceRecordPage() {
  const { invoiceId } = Route.useParams();
  const [error, setError] = useState("");
  const [data, setData] = useState<Awaited<ReturnType<typeof getInvoice>> | null>(null);

  useEffect(() => {
    let cancel = false;
    getInvoice({ data: { id: invoiceId } })
      .then((row) => {
        if (!cancel) setData(row);
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not open the invoice");
      });
    return () => {
      cancel = true;
    };
  }, [invoiceId]);

  return (
    <div className="space-y-4">
      <Link to="/app/billing" className="text-sm text-accent hover:underline">
        Billing
      </Link>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">Loading invoice…</p> : null}
      {data ? (
        <section className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">Invoice</p>
          <h1 className="font-mono text-2xl font-semibold">{data.invoice.number}</h1>
          <p className="mt-1 text-sm">
            {data.customer?.name || data.invoice.customer_name} · {kes(data.invoice.amount_kes)}
          </p>
          <div className="mt-2">
            <Badge>{data.invoice.status}</Badge>
          </div>
          <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">Due</dt>
              <dd>{data.invoice.due_date}</dd>
            </div>
            <div>
              <dt className="text-muted">Remaining</dt>
              <dd>{kes(data.invoice.remaining_kes)}</dd>
            </div>
          </dl>
          {data.items.length ? (
            <ul className="mt-4 divide-y divide-border text-sm">
              {data.items.map((item) => (
                <li key={item.id} className="flex justify-between gap-3 py-2">
                  <span>{item.description}</span>
                  <span className="font-mono">{kes(item.amount_kes)}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {data.payments.length ? (
            <div className="mt-4">
              <h2 className="text-sm font-medium">Payments</h2>
              <ul className="mt-2 space-y-1 text-sm">
                {data.payments.map((payment) => (
                  <li key={payment.id}>
                    <Link to="/app/billing/payments/$paymentId" params={{ paymentId: payment.id }} className="text-accent hover:underline">
                      {payment.reference}
                    </Link>
                    <span className="text-muted"> · {kes(payment.amount_kes)} · {payment.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

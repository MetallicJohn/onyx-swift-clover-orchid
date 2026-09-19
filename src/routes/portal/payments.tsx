import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmptyState, ErrorBanner, LoadingBlock, PaymentRow, PortalCard } from "@/components/isp/portal-ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { DateYmdInput } from "@/components/isp/date-ymd-input";
import type { PortalPaymentPage } from "@/lib/isp/customer-portal-dto";
import { getPortalPayments } from "@/lib/isp/server-portal";
import { usePortal } from "@/lib/isp/portal-context";

export const Route = createFileRoute("/portal/payments")({ component: PortalPayments });

function PortalPayments() {
  const { token } = usePortal();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PortalPaymentPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      getPortalPayments({ data: { token, q, status: status || undefined, from: from || undefined, to: to || undefined, page } })
        .then((r) => {
          setData(r);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Could not load payments"))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [token, q, status, from, to, page]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Payments</h1>
        <p className="mt-1 text-sm text-muted">Your payment history on this account only.</p>
      </div>
      <PortalCard>
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Search">
            <Input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Invoice or method" />
          </Field>
          <Field label="Status">
            <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">All</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
            </Select>
          </Field>
          <Field label="From">
            <DateYmdInput value={from} onChange={(ymd) => { setFrom(ymd); setPage(1); }} aria-label="From date" />
          </Field>
          <Field label="To">
            <DateYmdInput value={to} onChange={(ymd) => { setTo(ymd); setPage(1); }} aria-label="To date" />
          </Field>
        </div>
      </PortalCard>
      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingBlock label="Loading payments" /> : null}
      {!loading && data && data.rows.length === 0 ? (
        <EmptyState title="No payments yet" body="Confirmed payments for this account will appear here." />
      ) : null}
      {data && data.rows.length > 0 ? (
        <PortalCard>
          <ul>
            {data.rows.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
          {data.total > data.page_size ? (
            <div className="mt-3 flex items-center justify-between text-sm">
              <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <span className="text-muted">
                Page {data.page} of {Math.ceil(data.total / data.page_size)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= Math.ceil(data.total / data.page_size)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          ) : null}
        </PortalCard>
      ) : null}
    </div>
  );
}

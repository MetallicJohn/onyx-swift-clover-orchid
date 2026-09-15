import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorBanner, PortalCard, SupportLine } from "@/components/isp/portal-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { PortalStkPoll } from "@/lib/isp/customer-portal-dto";
import { portalPay, portalPayStatus } from "@/lib/isp/server-portal";
import { kes } from "@/lib/utils";
import { usePortal } from "@/lib/isp/portal-context";

export const Route = createFileRoute("/portal/pay")({
  component: PortalPay,
});

function PortalPay() {
  const { home, token, refresh } = usePortal();
  const unpaid = home.invoices.filter((i) => i.balance_kes > 0);
  const stkMethods = home.methods.filter((m) => m.stk_available);
  const searchInvoice =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("invoice") || "" : "";
  const [invoiceId, setInvoiceId] = useState(searchInvoice || unpaid[0]?.id || "");
  const [phone, setPhone] = useState(home.customer.phone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PortalStkPoll | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const inflight = useRef(false);

  const invoice = useMemo(() => unpaid.find((i) => i.id === invoiceId) ?? unpaid[0], [unpaid, invoiceId]);

  useEffect(() => {
    if (!checkout || poll?.status === "confirmed" || poll?.status === "cancelled" || poll?.status === "failed") return;
    const id = window.setInterval(async () => {
      try {
        const r = await portalPayStatus({ data: { token, checkout_id: checkout } });
        setPoll(r);
        if (r.status === "confirmed") await refresh();
      } catch {
        /* keep pending */
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [checkout, poll?.status, token, refresh]);

  if (!home.methods.length) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Pay now</h1>
        <EmptyState
          title="No payment methods yet"
          body="This network has not enabled a customer payment method. Contact support."
        />
        <SupportLine phone={home.isp.support_phone} email={home.isp.support_email} />
      </div>
    );
  }

  if (!unpaid.length && poll?.status !== "confirmed") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Pay now</h1>
        <EmptyState title="Nothing to pay" body="This account has no unpaid invoices." />
        <PaymentMethods />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pay now</h1>
        <p className="mt-1 text-sm text-muted">M-Pesa is confirmed only after the prompt on your phone succeeds.</p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {poll?.status === "confirmed" ? (
        <PortalCard title="Payment confirmed">
          <p className="text-sm text-ok">{poll.note}</p>
          {poll.reference_masked ? <p className="mt-1 font-mono text-sm text-muted">{poll.reference_masked}</p> : null}
          {poll.amount_kes ? <p className="mt-2 text-lg font-semibold tabular-nums">{kes(poll.amount_kes)}</p> : null}
        </PortalCard>
      ) : (
        <PortalCard title="M-Pesa STK Push">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!invoice || inflight.current) return;
              inflight.current = true;
              setBusy(true);
              setError(null);
              setPoll({ status: "pending", note: "Sending the M-Pesa prompt…" });
              try {
                const started = await portalPay({
                  data: { token, invoice_id: invoice.id, phone, provider: stkMethods[0]?.kind || "mpesa" },
                });
                setCheckout(started.checkout_id);
                setPoll({ status: "pending", note: started.note });
              } catch (ex) {
                setPoll(null);
                setError(ex instanceof Error ? ex.message : "Could not start payment");
              } finally {
                inflight.current = false;
                setBusy(false);
              }
            }}
          >
            <Field label="Invoice">
              <Select value={invoice?.id || ""} onChange={(e) => setInvoiceId(e.target.value)}>
                {unpaid.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.number} · {kes(inv.balance_kes)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="M-Pesa phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
            </Field>
            {invoice ? (
              <div className="rounded-lg bg-elevated/60 px-3 py-3 text-sm">
                <p>
                  Amount <span className="font-semibold tabular-nums">{kes(invoice.balance_kes)}</span>
                </p>
                <p className="text-muted">Reference {invoice.number}</p>
              </div>
            ) : null}
            {poll ? (
              <div className="flex items-center gap-2 text-sm">
                <Badge tone={statusTone(poll.status)}>{poll.status}</Badge>
                <span className="text-muted">{poll.note}</span>
              </div>
            ) : null}
            <Button type="submit" disabled={busy || !stkMethods.length || poll?.status === "pending"}>
              {busy || poll?.status === "pending" ? "Waiting for M-Pesa…" : "Pay with M-Pesa"}
            </Button>
            {!stkMethods.length ? (
              <p className="text-sm text-muted">STK Push is not enabled. Use a paybill, till or bank method below, or contact support.</p>
            ) : null}
            {poll?.status === "timeout" || poll?.status === "cancelled" || poll?.status === "failed" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPoll(null);
                  setCheckout(null);
                }}
              >
                Try again
              </Button>
            ) : null}
          </form>
        </PortalCard>
      )}

      <PaymentMethods />
    </div>
  );
}

function PaymentMethods() {
  const { home } = usePortal();
  if (!home.methods.length) return null;
  return (
    <PortalCard title="Payment methods">
      <ul className="space-y-3">
        {home.methods.map((m) => (
          <li key={m.id} className="rounded-lg bg-elevated/50 px-3 py-3 text-sm">
            <p className="font-medium">{m.label}</p>
            <p className="mt-1 text-muted">{m.instructions}</p>
            {m.public_number ? <p className="mt-1 font-mono text-xs">{m.public_number}</p> : null}
          </li>
        ))}
      </ul>
    </PortalCard>
  );
}

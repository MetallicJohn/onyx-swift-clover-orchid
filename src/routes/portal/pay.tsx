import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, ErrorBanner, PortalCard, SupportLine } from "@/components/isp/portal-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import type { PortalStkPoll } from "@/lib/isp/customer-portal-dto";
import { portalPay, portalPayStatus } from "@/lib/isp/server-portal";
import { formatDate } from "@/lib/isp/display";
import { expectedExpiryYmd, portalMinKes, previewPartial } from "@/lib/isp/partial-payment-format";
import { kes } from "@/lib/utils";
import { usePortal } from "@/lib/isp/portal-context";

export const Route = createFileRoute("/portal/pay")({
  component: PortalPay,
});

function PortalPay() {
  const { home, token, refresh } = usePortal();
  const payable = home.services.filter((s) => s.outstanding_kes > 0);
  const stkMethods = home.methods.filter((m) => m.stk_available);
  const search =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const searchService = search.get("service") || "";
  const searchInvoice = search.get("invoice") || "";
  const invoiceService =
    searchInvoice ? home.invoices.find((i) => i.id === searchInvoice)?.service_id || "" : "";
  const [serviceId, setServiceId] = useState(searchService || invoiceService || (payable.length === 1 ? payable[0]!.id : ""));
  const [phone, setPhone] = useState(home.customer.phone);
  const [confirmed, setConfirmed] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PortalStkPoll | null>(null);
  const [checkout, setCheckout] = useState<string | null>(null);
  const inflight = useRef(false);

  const service = useMemo(
    () => home.services.find((s) => s.id === serviceId) ?? payable.find((s) => s.id === serviceId),
    [home.services, payable, serviceId],
  );
  const invoice = useMemo(() => {
    if (searchInvoice) return home.invoices.find((i) => i.id === searchInvoice && i.balance_kes > 0);
    return home.invoices.find((i) => i.service_id === serviceId && i.balance_kes > 0);
  }, [home.invoices, searchInvoice, serviceId]);

  const partial = useMemo(() => {
    if (!service?.partial_available) return null;
    const full = service.partial_full_kes || service.package_price_kes || invoice?.amount_kes || 0;
    const paid = service.partial_paid_kes ?? Math.max(0, full - (invoice?.balance_kes || service.outstanding_kes));
    const remaining = invoice?.balance_kes || service.outstanding_kes;
    const entered = Math.round(Number(amount) || 0);
    const preview = previewPartial({
      fullKes: full,
      paidBeforeKes: paid,
      thisKes: entered || 0,
      minPct: service.partial_min_pct || 50,
      periodMs: service.partial_period_ms || 30 * 86_400_000,
      hourly: Boolean(service.partial_hourly),
    });
    const minEnter = portalMinKes({ remaining_to_qualify_kes: preview.remaining_to_qualify_kes, remaining_kes: remaining });
    return {
      preview,
      minEnter,
      remaining,
      expected: expectedExpiryYmd({
        days: preview.grant_days,
        hourly: Boolean(service.partial_hourly),
        hours: preview.grant_hours,
        currentEnd: service.expiry_date,
        awaiting: service.status === "pending",
      }),
    };
  }, [service, invoice, amount]);

  useEffect(() => {
    setConfirmed(false);
    if (service?.partial_available && service.partial_min_kes) {
      setAmount(String(Math.min(service.outstanding_kes, Math.max(service.partial_min_kes - (service.partial_paid_kes || 0), 1))));
    } else {
      setAmount("");
    }
  }, [serviceId, service?.partial_available, service?.partial_min_kes, service?.outstanding_kes, service?.partial_paid_kes]);

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

  if (!payable.length && poll?.status !== "confirmed") {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Pay now</h1>
        <EmptyState title="Nothing to pay" body="No service on this account has an unpaid invoice." />
        <PaymentMethods account={service?.account_number || ""} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Pay now</h1>
        <p className="mt-1 text-sm text-muted">
          {home.services.length > 1
            ? "Select the service you want to pay for. Paying one service does not change the others."
            : "Confirm the account number, then send the M-Pesa prompt."}
        </p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {poll?.status === "confirmed" ? (
        <PortalCard title="Payment confirmed">
          <p className="text-sm text-ok">{poll.note}</p>
          {poll.reference_masked ? <p className="mt-1 font-mono text-sm text-muted">{poll.reference_masked}</p> : null}
          {poll.amount_kes ? <p className="mt-2 text-lg font-semibold tabular-nums">{kes(poll.amount_kes)}</p> : null}
          {service ? (
            <p className="mt-1 text-sm text-muted">
              {service.name} · {service.account_number || service.reference}
            </p>
          ) : null}
        </PortalCard>
      ) : (
        <PortalCard title="Pay this service">
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!service || inflight.current) return;
              if (service.account_number && !confirmed) {
                setError("Confirm the service account number before sending the prompt.");
                return;
              }
              inflight.current = true;
              setBusy(true);
              setError(null);
              setPoll({ status: "pending", note: "Sending the M-Pesa prompt…" });
              try {
                const started = await portalPay({
                  data: {
                    token,
                    service_id: service.id,
                    invoice_id: invoice?.id,
                    phone,
                    provider: stkMethods[0]?.kind || "mpesa",
                    confirm_account: service.account_number,
                    amount_kes: partial ? Math.round(Number(amount) || 0) : undefined,
                  },
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
            <Field label="Service">
              <Select value={service?.id || ""} onChange={(e) => setServiceId(e.target.value)}>
                {payable.length === 0 ? <option value="">No unpaid service</option> : null}
                {payable.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.account_number || s.reference} · {kes(s.outstanding_kes)}
                  </option>
                ))}
              </Select>
            </Field>
            {service ? (
              <div className="rounded-lg bg-elevated/60 px-3 py-3 text-sm">
                <p className="font-medium">{service.name}</p>
                <dl className="mt-2 grid gap-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Account number</dt>
                    <dd className="font-mono">{service.account_number || service.reference}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Type</dt>
                    <dd>{service.access_type}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Package</dt>
                    <dd>{service.package_name}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Status</dt>
                    <dd>
                      <Badge tone={statusTone(service.status)}>{service.status_label}</Badge>
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Expiry</dt>
                    <dd>{service.expiry_date ? formatDate(service.expiry_date) : "—"}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Amount due</dt>
                    <dd className="font-semibold tabular-nums">{kes(service.outstanding_kes)}</dd>
                  </div>
                  {service.credit_enabled ? (
                    <>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Credit limit</dt>
                        <dd className="tabular-nums">{kes(service.credit_max_kes || 0)}</dd>
                      </div>
                      <div className="flex justify-between gap-3">
                        <dt className="text-muted">Available credit</dt>
                        <dd className="tabular-nums">{kes(service.credit_available_kes || 0)}</dd>
                      </div>
                    </>
                  ) : null}
                </dl>
              </div>
            ) : (
              <p className="text-sm text-muted">Select the service you want to pay for.</p>
            )}
            {partial && service ? (
              <div className="rounded-lg border border-border px-3 py-3 text-sm">
                <p className="font-medium">Partial payment available</p>
                <dl className="mt-2 grid gap-1">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Full package</dt>
                    <dd>{kes(partial.preview.full_kes)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Required minimum</dt>
                    <dd>
                      {partial.preview.min_pct}% · {kes(partial.preview.min_kes)}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">Remaining to qualify</dt>
                    <dd>{kes(partial.preview.remaining_to_qualify_kes)}</dd>
                  </div>
                </dl>
                <div className="mt-3">
                  <Field label="Amount to pay">
                    <Input
                      type="number"
                      min={partial.minEnter}
                      max={partial.remaining}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                    />
                  </Field>
                </div>
                {Number(amount) > 0 ? (
                  <dl className="mt-2 grid gap-1">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Payment percentage</dt>
                      <dd>{partial.preview.this_pct}%</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Estimated validity</dt>
                      <dd>
                        {service.partial_hourly ? `${partial.preview.grant_hours} hours` : `${partial.preview.grant_days} days`}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Estimated expiry</dt>
                      <dd>{formatDate(partial.expected)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Remaining after this payment</dt>
                      <dd>{kes(Math.max(0, partial.remaining - Math.round(Number(amount) || 0)))}</dd>
                    </div>
                  </dl>
                ) : null}
                {Number(amount) > 0 && Number(amount) < partial.minEnter ? (
                  <p className="mt-2 text-sm text-danger">
                    This payment is below the minimum required amount and will not activate or restore the service.
                  </p>
                ) : (
                  <p className="mt-2 text-xs text-muted">
                    Paying less than the minimum does not activate the service. Partial payment gives proportionate validity
                    for this service account only. Full payment gives the full package period.
                  </p>
                )}
              </div>
            ) : null}
            {service?.account_number ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-accent"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>
                  I confirm I am paying account <span className="font-mono">{service.account_number}</span> for{" "}
                  {service.name} only.
                </span>
              </label>
            ) : null}
            <Field label="M-Pesa phone">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" required />
            </Field>
            {poll ? (
              <div className="flex items-center gap-2 text-sm">
                <Badge tone={statusTone(poll.status)}>{poll.status}</Badge>
                <span className="text-muted">{poll.note}</span>
              </div>
            ) : null}
            <Button type="submit" disabled={busy || !stkMethods.length || !service || poll?.status === "pending" || (Boolean(service?.account_number) && !confirmed)}>
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

      <PaymentMethods account={service?.account_number || ""} />
    </div>
  );
}

function PaymentMethods({ account }: { account: string }) {
  const { home } = usePortal();
  if (!home.methods.length) return null;
  return (
    <PortalCard title="Payment methods">
      <ul className="space-y-3">
        {home.methods.map((m) => (
          <li key={m.id} className="rounded-lg bg-elevated/50 px-3 py-3 text-sm">
            <p className="font-medium">{m.label}</p>
            <p className="mt-1 text-muted">
              {account && (m.mode === "paybill" || m.mode === "till")
                ? `${m.instructions} Account ${account}.`
                : m.instructions}
            </p>
            {m.public_number ? <p className="mt-1 font-mono text-xs">{m.public_number}</p> : null}
          </li>
        ))}
      </ul>
    </PortalCard>
  );
}

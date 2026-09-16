import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState, ErrorBanner, PortalCard, ServiceCard } from "@/components/isp/portal-ui";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { downloadPdf } from "@/lib/isp/pdf-client";
import { portalStatementPdf } from "@/lib/isp/server-docs";
import { portalRequestGrace } from "@/lib/isp/server-portal";
import { formatDate } from "@/lib/isp/display";
import { usePortal } from "@/lib/isp/portal-context";

export const Route = createFileRoute("/portal/services")({ component: PortalServices });

function PortalServices() {
  const { home, token, refresh } = usePortal();
  const navigate = useNavigate();
  const [graceDays, setGraceDays] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!home.services.length) {
    return <EmptyState title="No services yet" body="When this network assigns a package to your account, it will show here." />;
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">My services</h1>
        <p className="mt-1 text-sm text-muted">
          Select the service you want to pay for. Each line has its own account number and amount due.
        </p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {msg ? <p className="text-sm text-ok">{msg}</p> : null}
      <PortalCard>
        <ul className="space-y-3">
          {home.services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              onPay={s.outstanding_kes > 0 ? () => void navigate({ to: "/portal/pay", search: { service: s.id } as never }) : undefined}
              onInvoice={() => {
                const inv = home.invoices.find((i) => i.service_id === s.id && i.balance_kes > 0) || home.invoices.find((i) => i.service_id === s.id);
                if (inv && inv.balance_kes > 0) {
                  void navigate({ href: `/portal/pay?invoice=${encodeURIComponent(inv.id)}` });
                  return;
                }
                void navigate({ to: "/portal/invoices" as never });
              }}
              onStatement={() => {
                void (async () => {
                  setError(null);
                  try {
                    const file = await portalStatementPdf({ data: { token, service_id: s.id } });
                    downloadPdf(file);
                  } catch (ex) {
                    setError(ex instanceof Error ? ex.message : "Could not download statement");
                  }
                })();
              }}
              grace={
                s.can_request_grace ? (
                  <form
                    className="mt-3 flex flex-wrap items-end gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setError(null);
                      setMsg(null);
                      try {
                        const days = graceDays[s.id] || s.allowed_grace_days[0];
                        const r = await portalRequestGrace({ data: { token, service_id: s.id, days } });
                        setMsg(`Grace Period granted until ${formatDate(r.expires_at)}. Renewal date is unchanged.`);
                        await refresh();
                      } catch (ex) {
                        setError(ex instanceof Error ? ex.message : "Could not add grace");
                      }
                    }}
                  >
                    <Field label="Add Grace Period">
                      <Select
                        value={String(graceDays[s.id] || s.allowed_grace_days[0])}
                        onChange={(e) => setGraceDays((m) => ({ ...m, [s.id]: Number(e.target.value) }))}
                      >
                        {s.allowed_grace_days.map((d) => (
                          <option key={d} value={d}>
                            {d} day{d === 1 ? "" : "s"}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Button type="submit" size="sm" variant="secondary">
                      Add grace
                    </Button>
                  </form>
                ) : s.grace_reason ? (
                  <p className="mt-2 text-xs text-subtle">{s.grace_reason}</p>
                ) : null
              }
            />
          ))}
        </ul>
      </PortalCard>
    </div>
  );
}

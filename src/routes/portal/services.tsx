import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState, ErrorBanner, PortalCard, ServiceCard } from "@/components/isp/portal-ui";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { portalRequestGrace } from "@/lib/isp/server-portal";
import { usePortal } from "../portal";

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
        <p className="mt-1 text-sm text-muted">Each line is listed separately. Dates are for viewing only.</p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {msg ? <p className="text-sm text-ok">{msg}</p> : null}
      <PortalCard>
        <ul className="space-y-3">
          {home.services.map((s) => (
            <ServiceCard
              key={s.id}
              service={s}
              onPay={s.outstanding_kes > 0 ? () => void navigate({ to: "/portal/pay" as never }) : undefined}
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
                        setMsg(`Grace Period granted until ${String(r.expires_at).slice(0, 10)}. Renewal date is unchanged.`);
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

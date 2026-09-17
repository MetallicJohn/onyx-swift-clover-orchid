import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import { accessLabel, creditStateLabel, tierLabel } from "@/lib/isp/business-credit-format";
import {
  getCreditDeskFn,
  restoreCreditFn,
  saveCustomerCreditFn,
  saveServiceCreditFn,
  suspendCreditFn,
} from "@/lib/isp/server-business";
import { kes } from "@/lib/utils";

export function BusinessCreditPanel({
  role,
  customerId,
  serviceId,
}: {
  role: string;
  customerId?: string;
  serviceId?: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getCreditDeskFn>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [maxKes, setMaxKes] = useState("");
  const [warningKes, setWarningKes] = useState("");
  const canView = hasPermission(role, "billing.business_credit.view") || hasPermission(role, "invoices.read");
  const canManage = hasPermission(role, "billing.business_credit.manage");
  const canSuspend = hasPermission(role, "billing.business_credit.suspend");
  const canRestore = hasPermission(role, "billing.business_credit.restore");

  async function load() {
    const next = await getCreditDeskFn({ data: { customer_id: customerId, service_id: serviceId } });
    setData(next);
    if (next.kind === "service") {
      setMaxKes(next.service.service_max_kes != null ? String(next.service.service_max_kes) : "");
      setWarningKes(next.service.service_warning_kes != null ? String(next.service.service_warning_kes) : "");
    } else {
      setMaxKes(next.customer.max_kes != null ? String(next.customer.max_kes) : "");
      setWarningKes(next.customer.warning_kes != null ? String(next.customer.warning_kes) : "");
    }
  }

  useEffect(() => {
    if (!canView) return;
    load().catch((err) => setError(err instanceof Error ? err.message : "Cannot load business credit"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, serviceId]);

  if (!canView) return null;
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading business credit…</p>;

  const service = data.kind === "service" ? data.service : data.services[0];
  const effective = data.kind === "service" ? data.service.effective : service?.effective;
  const snapshot = data.kind === "service" ? data.service.snapshot : service?.snapshot;
  const inherit =
    data.kind === "service" ? data.service.service_enabled : data.customer.enabled;

  async function saveEnabled(enabled: boolean | null) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      const max = maxKes === "" ? null : Number(maxKes);
      const warn = warningKes === "" ? null : Number(warningKes);
      if (serviceId) {
        await saveServiceCreditFn({ data: { service_id: serviceId, enabled, max_kes: max, warning_kes: warn } });
      } else if (customerId) {
        await saveCustomerCreditFn({ data: { customer_id: customerId, enabled, max_kes: max, warning_kes: warn } });
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">Business credit</h3>
          <p className="text-xs text-muted">
            Business and enterprise lines stay online after expiry until a configured maximum outstanding is reached.
          </p>
        </div>
        {snapshot ? (
          <Badge tone={statusTone(snapshot.state)}>{snapshot.label}</Badge>
        ) : (
          <Badge>Residential</Badge>
        )}
      </div>
      {data.kind === "customer" ? (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {data.services.length === 0 ? (
            <li className="px-3 py-2 text-muted">No services on this customer.</li>
          ) : (
            data.services.map((s) => (
              <li key={s.service_id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span>
                  {s.name}
                  <span className="mt-0.5 block font-mono text-xs text-muted">{s.account_number || "no account"}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge tone={statusTone(s.snapshot.state)}>{s.label}</Badge>
                  <span className="font-mono text-xs">{kes(s.snapshot.outstanding_kes)}</span>
                </span>
              </li>
            ))
          )}
        </ul>
      ) : null}
      {effective ? (
        <dl className="grid gap-1 text-sm sm:grid-cols-2">
          <Row label="Service tier" value={tierLabel(effective.tier)} />
          <Row label="Credit terms" value={effective.configured ? "Enabled" : effective.enabled ? "Not configured" : "Off"} />
          <Row label="Maximum credit" value={kes(effective.max_kes)} />
          <Row label="Current outstanding" value={kes(snapshot?.outstanding_kes || 0)} />
          <Row label="Available credit" value={kes(snapshot?.available_kes || 0)} />
          <Row label="Utilization" value={`${snapshot?.utilization_pct || 0}%`} />
          <Row label="Warning at" value={kes(effective.warning_kes)} />
          <Row
            label="Credit status"
            value={
              data.kind === "service"
                ? accessLabel(data.service.status, data.service.suspend_reason, data.service.snapshot)
                : snapshot
                  ? creditStateLabel(snapshot.state)
                  : "—"
            }
          />
          {data.kind === "service" && data.service.last_credit_check_at ? (
            <Row label="Last check" value={formatDateTime(data.service.last_credit_check_at)} />
          ) : null}
          {data.kind === "service" && data.service.suspend_reason ? (
            <Row label="Suspension reason" value={data.service.suspend_reason.replace(/_/g, " ")} />
          ) : null}
        </dl>
      ) : null}
      {effective?.enabled && !effective.configured ? (
        <p className="text-xs text-warn">Set a maximum credit before this line can operate on credit terms. Unlimited credit is never granted.</p>
      ) : null}
      {canManage ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Override">
            <select
              className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm"
              value={inherit === true ? "on" : inherit === false ? "off" : "inherit"}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                saveEnabled(v === "on" ? true : v === "off" ? false : null);
              }}
            >
              <option value="inherit">Inherit ({effective?.enabled ? "enabled" : "disabled"})</option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </Field>
          <Field label="Maximum credit (KES)">
            <Input
              type="number"
              min={0}
              value={maxKes}
              placeholder={String(effective?.max_kes ?? 0)}
              onChange={(e) => setMaxKes(e.target.value)}
              onBlur={() => saveEnabled(inherit ?? null)}
            />
          </Field>
          <Field label="Warning threshold (KES)">
            <Input
              type="number"
              min={0}
              value={warningKes}
              placeholder={String(effective?.warning_kes ?? 0)}
              onChange={(e) => setWarningKes(e.target.value)}
              onBlur={() => saveEnabled(inherit ?? null)}
            />
          </Field>
        </div>
      ) : (
        <p className="text-xs text-muted">Only authorised billing staff can change credit terms.</p>
      )}
      {data.kind === "service" ? (
        <div className="flex flex-wrap gap-2">
          {canSuspend && data.service.status !== "terminated" && data.service.status !== "suspended" ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await suspendCreditFn({ data: { service_id: data.service.service_id } });
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not suspend");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Suspend at credit limit
            </Button>
          ) : null}
          {canRestore && data.service.status === "suspended" ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await restoreCreditFn({ data: { service_id: data.service.service_id } });
                  await load();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Could not restore");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Restore if eligible
            </Button>
          ) : null}
        </div>
      ) : null}
      {data.kind === "service" && data.unpaid.length ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted">Unpaid billing periods</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.unpaid.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <span>
                  {inv.number}
                  <span className="mt-0.5 block text-xs text-muted">Due {formatDate(inv.due_date)}</span>
                </span>
                <span className="font-mono text-xs">{kes(Math.max(0, inv.amount_kes - inv.paid_kes))}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {data.kind === "service" && data.events.length ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted">Credit history</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p className="capitalize">{ev.action.replace(/_/g, " ")}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(ev.created_at)} · outstanding {kes(ev.outstanding_kes)} / {kes(ev.max_credit_kes)}
                  </p>
                </div>
                <Badge>{ev.new_status || ev.previous_status || "—"}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { formatDate, formatDateTime } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import {
  kesPercent,
  outcomeLabel,
  validityLabel,
  type PartialPolicySnapshot,
} from "@/lib/isp/partial-payment-format";
import {
  approvePartialFn,
  getPartialDeskFn,
  saveCustomerPartialFn,
  saveServicePartialFn,
} from "@/lib/isp/server-partial";
import { kes } from "@/lib/utils";

export function PartialPaymentPanel({
  role,
  customerId,
  serviceId,
}: {
  role: string;
  customerId?: string;
  serviceId?: string;
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getPartialDeskFn>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [minPct, setMinPct] = useState("");
  const canManage = hasPermission(role, "billing.partial.manage");
  const canApprove = hasPermission(role, "billing.partial.approve");

  async function load() {
    const next = await getPartialDeskFn({ data: { customer_id: customerId, service_id: serviceId } });
    setData(next);
    setNotes(next.customer?.partial_notes || "");
    const pct = serviceId ? next.service?.partial_min_pct : next.customer?.partial_min_pct;
    setMinPct(pct != null ? String(pct) : "");
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Cannot load partial payment"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId, serviceId]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <p className="text-sm text-muted">Loading partial payment…</p>;

  const effective = data.effective;
  const preview = data.preview;
  const inheritLabel = serviceId ? data.service?.partial_enabled : data.customer?.partial_enabled;

  async function saveEnabled(enabled: boolean | null) {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    try {
      if (serviceId) {
        await saveServicePartialFn({
          data: { service_id: serviceId, enabled, min_pct: minPct === "" ? null : Number(minPct) },
        });
      } else if (customerId) {
        await saveCustomerPartialFn({
          data: {
            customer_id: customerId,
            enabled,
            min_pct: minPct === "" ? null : Number(minPct),
            notes,
          },
        });
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
          <h3 className="text-sm font-semibold">Partial payment</h3>
          <p className="text-xs text-muted">
            Optional. A qualifying percentage of this service invoice can restore or activate only this line.
          </p>
        </div>
        <Badge tone={effective.enabled ? "ok" : "muted"}>{effective.enabled ? "Enabled" : "Disabled"}</Badge>
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        <Row label="Partial payment" value={effective.enabled ? "Enabled" : "Disabled"} />
        <Row label="Minimum payment" value={`${effective.min_pct}%`} />
        <Row label="Set from" value={effective.source} />
        <Row
          label="Service eligible"
          value={effective.enabled ? (serviceId ? "Yes" : "If the service allows it") : "No"}
        />
        {preview ? (
          <>
            <Row label="Package amount" value={kes(preview.full_kes)} />
            <Row label="Minimum amount" value={kes(preview.min_kes)} />
            <Row label="Paid so far" value={kes(preview.paid_kes)} />
            <Row label="Remaining" value={kes(preview.remaining_kes)} />
            <Row
              label="Min. validity"
              value={validityLabel(
                preview.grant_ms || 0,
                Boolean(data.service?.hourly),
              )}
            />
          </>
        ) : null}
        {data.service?.last_partial_payment_id ? (
          <>
            <Row label="Last partial" value={`${data.service.last_partial_pct}%`} />
            <Row
              label="Last validity"
              value={validityLabel(data.service.last_partial_validity_ms, Boolean(data.service.hourly))}
            />
          </>
        ) : null}
      </dl>
      {canManage ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="Override">
            <select
              className="h-10 w-full rounded-lg border border-border bg-bg px-3 text-sm"
              value={inheritLabel === true ? "on" : inheritLabel === false ? "off" : "inherit"}
              disabled={busy}
              onChange={(e) => {
                const v = e.target.value;
                saveEnabled(v === "on" ? true : v === "off" ? false : null);
              }}
            >
              <option value="inherit">Inherit ({effective.enabled ? "enabled" : "disabled"})</option>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </select>
          </Field>
          <Field label="Minimum %">
            <Input
              type="number"
              min={effective.tenant_min_pct}
              max={effective.tenant_max_pct}
              value={minPct}
              placeholder={String(effective.min_pct)}
              onChange={(e) => setMinPct(e.target.value)}
              onBlur={() => saveEnabled(inheritLabel ?? null)}
            />
          </Field>
          {!serviceId ? (
            <div className="sm:col-span-2">
              <Field label="Notes">
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => saveEnabled(inheritLabel ?? null)} />
              </Field>
              {data.customer?.partial_enabled_at ? (
                <p className="mt-1 text-xs text-muted">
                  Last updated {formatDateTime(data.customer.partial_updated_at || data.customer.partial_enabled_at)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-xs text-muted">Only authorised billing staff can change partial payment.</p>
      )}
      {data.events.length ? (
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-muted">Partial payment history</p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {data.events.map((ev) => (
              <li key={ev.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p>
                    {kes(ev.amount_kes)} · {ev.actual_pct}% of {kes(ev.full_amount_kes)}
                  </p>
                  <p className="text-xs text-muted">
                    {formatDate(ev.created_at)} · {ev.service_account_number || "this service"} · {ev.reference || "no ref"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(ev.outcome)}>{outcomeLabel(ev.outcome)}</Badge>
                  {ev.approval_status === "pending" && canApprove ? (
                    <>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await approvePartialFn({ data: { event_id: ev.id, approve: true } });
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Approve failed");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await approvePartialFn({ data: { event_id: ev.id, approve: false } });
                            await load();
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "Reject failed");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                </div>
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

export function PartialPaymentSettingsForm({
  policy,
  onChange,
  onSave,
  busy,
}: {
  policy: PartialPolicySnapshot;
  onChange: (next: PartialPolicySnapshot) => void;
  onSave: () => void;
  busy: boolean;
}) {
  function patch(p: Partial<PartialPolicySnapshot>) {
    onChange({ ...policy, ...p });
  }
  const example = kesPercent(2000, policy.default_min_pct);
  return (
    <form
      className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave();
      }}
    >
      <p className="sm:col-span-2 text-sm text-muted">
        Off by default. A qualifying percentage of a service invoice can activate or restore that service only, with
        pro-rata validity rounded down. Full payment still grants the full package period.
      </p>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.enabled_default}
          onChange={(e) => patch({ enabled_default: e.target.checked })}
        />
        Enable partial payments by default
      </label>
      <Field label="Default minimum %">
        <Input
          type="number"
          min={policy.min_pct}
          max={policy.max_pct}
          value={policy.default_min_pct}
          onChange={(e) => patch({ default_min_pct: Number(e.target.value) })}
        />
      </Field>
      <p className="self-end text-xs text-muted">Example: Ksh 2,000 at {policy.default_min_pct}% → {kes(example)}.</p>
      <Field label="Minimum permitted %">
        <Input type="number" min={1} max={100} value={policy.min_pct} onChange={(e) => patch({ min_pct: Number(e.target.value) })} />
      </Field>
      <Field label="Maximum permitted %">
        <Input type="number" min={1} max={100} value={policy.max_pct} onChange={(e) => patch({ max_pct: Number(e.target.value) })} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.allow_customer_override}
          onChange={(e) => patch({ allow_customer_override: e.target.checked })}
        />
        Allow customer-level override
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.allow_service_override}
          onChange={(e) => patch({ allow_service_override: e.target.checked })}
        />
        Allow service-level override
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.can_activate_new}
          onChange={(e) => patch({ can_activate_new: e.target.checked })}
        />
        Can activate a new service
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.can_restore_expired}
          onChange={(e) => patch({ can_restore_expired: e.target.checked })}
        />
        Can restore an expired service
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.can_renew_active}
          onChange={(e) => patch({ can_renew_active: e.target.checked })}
        />
        Can renew an active service
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.can_extend_active}
          onChange={(e) => patch({ can_extend_active: e.target.checked })}
        />
        Can extend an active service
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input
          type="checkbox"
          className="size-4 accent-accent"
          checked={policy.requires_approval}
          onChange={(e) => patch({ requires_approval: e.target.checked })}
        />
        Require staff approval before access is granted
      </label>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save partial payment policy"}
        </Button>
      </div>
    </form>
  );
}

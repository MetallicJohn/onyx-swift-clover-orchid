import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { ExpiryEditor, type ExpiryForm } from "@/components/isp/service-expiry-editor";
import { PartialPaymentPanel } from "@/components/isp/partial-payment-panel";
import { BusinessCreditPanel } from "@/components/isp/business-credit-panel";
import { TrafficDrawer } from "@/components/isp/traffic-drawer";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { accessMethodLabel, formatBytes, formatDate, formatDateTime, formatMac, remainingLabel } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { setServiceExpiryFn } from "@/lib/isp/server-expiry";
import { disconnectService, rotateServiceSecret, setServiceStatus } from "@/lib/isp/server";
import { changeServiceAccountNumberFn, getAccountNumberSettingsFn } from "@/lib/isp/server-account-numbers";
import { deleteServiceFn, getServiceFn, reassignServiceFn, updateServiceFn } from "@/lib/isp/server-lifecycle";
import { effectiveAccessIso, expirySourceLabel, openExpiryForm } from "@/lib/isp/service-expiry-format";
import { onboardingTypeLabel } from "@/lib/isp/onboard-import-format";
import type { ServiceStatus } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/services/$serviceId")({ component: ServiceRecordPage });

type RecordData = Awaited<ReturnType<typeof getServiceFn>>;

function ServiceRecordPage() {
  const { serviceId } = Route.useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [trafficOpen, setTrafficOpen] = useState(false);
  const [expiry, setExpiry] = useState<ExpiryForm | null>(null);
  const [grace, setGrace] = useState<"grant" | "extend" | "revoke" | null>(null);
  const [reassignTo, setReassignTo] = useState<string | null>(null);
  const [dropReason, setDropReason] = useState<string | null>(null);
  const [form, setForm] = useState({
    package_id: "",
    username: "",
    static_ip: "",
    mac_address: "",
    notes: "",
    account_number: "",
  });
  const [allowManualAccount, setAllowManualAccount] = useState(false);

  async function load() {
    const rec = await getServiceFn({ data: { id: serviceId } });
    setData(rec);
    setForm({
      package_id: rec.service.package_id,
      username: rec.service.username || "",
      static_ip: rec.service.static_ip || "",
      mac_address: rec.service.mac_address || "",
      notes: rec.service.notes || "",
      account_number: rec.service.account_number || "",
    });
    try {
      const acc = await getAccountNumberSettingsFn();
      setAllowManualAccount(Boolean(acc.allow_manual));
    } catch {
      setAllowManualAccount(false);
    }
  }

  useEffect(() => {
    setError(null);
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load service"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceId]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
      if (ok) setNote(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-danger">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="space-y-4">
        <BackLink />
        <p className="text-sm text-muted">Loading service…</p>
      </div>
    );
  }

  const s = data.service;
  const role = data.workspace.role;
  const canManage = hasPermission(role, "services.manage");
  const canDelete = hasPermission(role, "services.delete") || canManage;
  const canReassign = hasPermission(role, "services.reassign") || canManage;
  const canExpiry = hasPermission(role, "services.expiry.update");
  const canGrant = hasPermission(role, "services.grace.grant");
  const canExtend = hasPermission(role, "services.grace.extend");
  const canRevoke = hasPermission(role, "services.grace.revoke");
  const canTraffic = hasPermission(role, "traffic.view") || hasPermission(role, "services.read");
  const canRecycle = hasPermission(role, "recycle_bin.view");
  const activeGrace = Boolean(s.grace_active && s.grace_expires_at);
  const identity = s.username || s.static_ip || "—";
  const sessionLive = Boolean(data.session && !data.session.stopped_at);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <BackLink />
          <h1 className="text-2xl font-semibold tracking-tight">
            {s.package_name} · {accessMethodLabel(s.access_method)}
          </h1>
          <p className="text-sm text-muted">
            <Link
              to="/app/customers/$customerId"
              params={{ customerId: s.customer_id }}
              className="font-medium text-fg hover:text-accent hover:underline"
            >
              {s.customer_name}
            </Link>
            {s.account_number ? ` · ${s.account_number}` : ""}
            {s.customer_account_number && s.customer_account_number !== s.account_number
              ? ` · Customer ${s.customer_account_number}`
              : ""}
            {s.customer_phone ? ` · ${s.customer_phone}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canTraffic ? (
            <Button variant="secondary" onClick={() => setTrafficOpen(true)}>
              Realtime traffic
            </Button>
          ) : null}
          {canManage ? (
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
              {editing ? "Close editor" : "Edit"}
            </Button>
          ) : null}
          {canReassign ? (
            <Button variant="secondary" onClick={() => setReassignTo(data.others[0]?.id || "")}>
              Reassign
            </Button>
          ) : null}
          {canRecycle ? (
            <Link
              to="/app/recycle-bin"
              className="inline-flex h-11 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-surface"
            >
              Recycle Bin
            </Link>
          ) : null}
          {canDelete ? (
            <Button variant="danger" onClick={() => setDropReason("")}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(s.status)}>{s.status === "grace" ? "Grace Period" : s.status}</Badge>
        {s.suspend_reason ? <span className="text-sm text-muted">{s.suspend_reason}</span> : null}
        {activeGrace && s.grace_expires_at ? (
          <span className="text-sm text-warn">{remainingLabel(s.grace_expires_at)}</span>
        ) : null}
      </div>
      {note ? <p className="text-sm text-accent">{note}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Line</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <Fact label="Account" value={s.account_number || "—"} mono />
            <Fact label="Due" value={kes(s.outstanding_kes || 0)} />
            <Fact label="Username" value={s.username || "—"} mono />
            <Fact label="Static IP" value={s.static_ip || "—"} mono />
            <Fact label="MAC" value={formatMac(s.mac_address)} mono />
            <Fact label="Speed" value={`${s.download_mbps}/${s.upload_mbps} Mbps`} />
            <Fact label="Price" value={`${kes(s.price_kes)} / ${s.billing_interval}`} />
            <Fact label="Started" value={formatDate(s.created_at)} />
            <Fact label="Expiry" value={`${formatDate(effectiveAccessIso(s))} · ${expirySourceLabel(s.expiry_source, s.grace_active)}`} />
            <Fact label="Paid through" value={formatDate(s.period_end)} />
            {s.bundle_mb > 0 ? (
              <Fact label="Bundle" value={`${s.bundle_used_mb} / ${s.bundle_mb} MB`} />
            ) : null}
          </dl>
          {s.notes ? <p className="mt-3 whitespace-pre-wrap text-sm">{s.notes}</p> : null}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Onboarding</h2>
          <dl className="mt-3 grid gap-2 text-sm">
            <Fact label="Type" value={onboardingTypeLabel(s.onboarding_type || "new")} />
            <Fact label="Subscription start" value={s.subscription_start_date ? formatDate(s.subscription_start_date) : "—"} />
            <Fact label="Billing expiry" value={formatDate(s.period_end)} />
            <Fact label="First renewal" value={s.billing_anchor_date ? formatDate(s.billing_anchor_date) : "Package cycle"} />
            <Fact
              label="First renewal invoice"
              value={s.first_renewal_invoiced_at ? formatDateTime(s.first_renewal_invoiced_at) : "Not issued"}
            />
            <Fact label="Onboarding SMS" value={s.send_onboarding_notification ? "Sent / opted in" : "Not sent"} />
            {s.import_source ? <Fact label="Import source" value={s.import_source} /> : null}
            {s.import_batch_id ? <Fact label="Import batch" value={s.import_batch_id} mono /> : null}
          </dl>
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Provisioning</h2>
          {data.provision ? (
            <dl className="mt-3 grid gap-2 text-sm">
              <Fact label="Overall" value={data.provision.overall || "—"} />
              <Fact label="RADIUS" value={data.provision.radius_status || "—"} />
              <Fact label="Queue" value={data.provision.queue_status || "—"} />
              <Fact label="Session" value={data.provision.session_status || "—"} />
              <Fact label="Framed IP" value={data.provision.framed_ip || "—"} mono />
              {data.provision.last_error ? <Fact label="Last error" value={data.provision.last_error} /> : null}
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">No provisioning record yet.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Last RADIUS session</h2>
          {data.session ? (
            <dl className="mt-3 grid gap-2 text-sm">
              <Fact label="Status" value={sessionLive ? "Online" : "Stopped"} />
              <Fact label="Started" value={formatDateTime(data.session.started_at)} />
              <Fact label="Stopped" value={data.session.stopped_at ? formatDateTime(data.session.stopped_at) : "—"} />
              <Fact label="Framed IP" value={data.session.framed_ip || "—"} mono />
              <Fact label="NAS" value={data.session.nas_ip || "—"} mono />
              <Fact label="Downloaded" value={formatBytes(data.session.bytes_out)} />
              <Fact label="Uploaded" value={formatBytes(data.session.bytes_in)} />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">No RADIUS session recorded. Traffic is not estimated.</p>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <h2 className="text-sm font-medium">Grace period</h2>
          {activeGrace ? (
            <dl className="mt-3 grid gap-2 text-sm">
              <Fact label="Days granted" value={String(s.grace_days_granted ?? "—")} />
              <Fact label="Until" value={formatDateTime(s.grace_expires_at)} />
              <Fact label="By" value={s.grace_granted_by || "—"} />
              <Fact label="Reason" value={s.grace_reason || "—"} />
            </dl>
          ) : (
            <p className="mt-3 text-sm text-muted">No active grace period.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {canGrant && !activeGrace && s.status !== "terminated" ? (
              <Button size="sm" variant="secondary" onClick={() => setGrace("grant")}>
                Grant
              </Button>
            ) : null}
            {canExtend && activeGrace ? (
              <Button size="sm" variant="secondary" onClick={() => setGrace("extend")}>
                Extend
              </Button>
            ) : null}
            {canRevoke && activeGrace ? (
              <Button size="sm" variant="secondary" onClick={() => setGrace("revoke")}>
                Revoke
              </Button>
            ) : null}
            {canExpiry ? (
              <Button size="sm" variant="secondary" onClick={() => setExpiry(openExpiryForm(s))}>
                Edit expiry
              </Button>
            ) : null}
          </div>
        </section>
      </div>

      <PartialPaymentPanel role={data.workspace.role} customerId={s.customer_id} serviceId={s.id} />
      <BusinessCreditPanel role={data.workspace.role} customerId={s.customer_id} serviceId={s.id} />

      {canManage ? (
        <div className="flex flex-wrap gap-2">
          {s.status !== "active" ? (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => setServiceStatus({ data: { id: s.id, status: "active" as ServiceStatus } }), "Restored")}>
              Restore
            </Button>
          ) : (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => setServiceStatus({ data: { id: s.id, status: "suspended" as ServiceStatus } }), "Suspended")}>
              Suspend
            </Button>
          )}
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => void run(() => disconnectService({ data: { id: s.id } }), `Disconnect queued for ${identity}`)}
          >
            Disconnect
          </Button>
          {s.access_method === "pppoe" ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!window.confirm("Rotate the PPPoE password? The current password stops working immediately.")) return;
                  const r = await rotateServiceSecret({ data: { id: s.id, confirm: true } });
                  setNote(`New PPPoE password for ${r.username}: ${r.password}`);
                })
              }
            >
              New password
            </Button>
          ) : null}
        </div>
      ) : null}

      {editing && canManage ? (
        <form
          className="grid gap-3 rounded-xl bg-surface p-5 shadow-card md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              if (form.account_number !== (s.account_number || "") && allowManualAccount) {
                await changeServiceAccountNumberFn({
                  data: { service_id: s.id, account_number: form.account_number },
                });
              }
              await updateServiceFn({
                data: {
                  id: s.id,
                  package_id: form.package_id,
                  username: form.username,
                  static_ip: form.static_ip,
                  mac_address: form.mac_address,
                  notes: form.notes,
                },
              });
              setEditing(false);
            }, "Service updated");
          }}
        >
          <h2 className="font-medium md:col-span-2">Edit service</h2>
          <Field label="Package">
            <Select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
              {data.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {accessMethodLabel(p.access_method)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Account number">
            <Input
              value={form.account_number}
              onChange={(e) => setForm({ ...form, account_number: e.target.value.toUpperCase() })}
              disabled={!allowManualAccount}
            />
          </Field>
          {!allowManualAccount ? (
            <p className="text-xs text-muted md:col-span-2">
              Manual account-number edits are off. Enable them in Settings → Account numbers.
            </p>
          ) : null}
          <Field label="Username">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Static IP">
            <Input value={form.static_ip} onChange={(e) => setForm({ ...form, static_ip: e.target.value })} />
          </Field>
          <Field label="MAC address">
            <Input value={form.mac_address} onChange={(e) => setForm({ ...form, mac_address: e.target.value })} />
          </Field>
          <div className="md:col-span-2">
            <Field label="Notes">
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
            </Field>
          </div>
          <p className="text-sm text-muted md:col-span-2">
            Saving updates RADIUS and MikroTik for this line. Invoices and payments are not changed. Reassignment is a
            separate action.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <section className="rounded-xl border border-border bg-surface p-4">
        <h2 className="text-sm font-medium">Activity</h2>
        {data.activity.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No audit entries for this service.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {data.activity.map((a) => (
              <li key={a.id} className="py-2 text-sm">
                <div className="font-medium">{a.action}</div>
                {a.details ? <p className="break-all text-xs text-muted">{a.details}</p> : null}
                <p className="text-xs text-subtle">{formatDateTime(a.created_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TrafficDrawer
        open={trafficOpen}
        onOpenChange={setTrafficOpen}
        customerId={s.customer_id}
        customerName={s.customer_name}
        serviceId={s.id}
      />

      <Dialog
        open={Boolean(expiry)}
        onOpenChange={(next) => {
          if (!next && !busy) setExpiry(null);
        }}
        title="Edit expiry date"
        description="Changes access only. Paid-through date, invoices, and customer messages stay as they are."
      >
        {expiry ? (
          <ExpiryEditor
            form={expiry}
            setForm={setExpiry}
            busy={busy}
            error={error}
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const out = await setServiceExpiryFn({
                  data: { id: expiry.service.id, date: expiry.date, reason: expiry.reason },
                });
                setExpiry(null);
                setNote(
                  `Expiry date updated for ${out.customer_name}. Status: ${out.status === "grace" ? "Grace Period" : out.status}. No billing or customer message was sent.`,
                );
              });
            }}
            onClose={() => setExpiry(null)}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(grace)}
        onOpenChange={(next) => {
          if (!next) setGrace(null);
        }}
        title={grace === "grant" ? "Grant Grace Period" : grace === "extend" ? "Extend Grace Period" : "Revoke Grace Period"}
      >
        {grace ? (
          <GraceMini
            mode={grace}
            busy={busy}
            onCancel={() => setGrace(null)}
            onSubmit={(days, reason) =>
              void run(async () => {
                if (grace === "grant") await grantGraceFn({ data: { service_id: s.id, days, reason } });
                else if (grace === "extend") await extendGraceFn({ data: { service_id: s.id, days, reason } });
                else await revokeGraceFn({ data: { service_id: s.id, reason } });
                setGrace(null);
              }, "Grace period updated")
            }
          />
        ) : null}
      </Dialog>

      <Dialog
        open={reassignTo !== null}
        onOpenChange={(next) => {
          if (!next) setReassignTo(null);
        }}
        title="Reassign service"
        description="The line keeps its package, credentials, expiry, and history. Invoices and payments stay on the current customer."
      >
        {reassignTo !== null ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await reassignServiceFn({ data: { id: s.id, customer_id: reassignTo, confirm: true } });
                setReassignTo(null);
              }, "Service reassigned");
            }}
          >
            <Field label="Destination customer">
              <Select value={reassignTo} onChange={(e) => setReassignTo(e.target.value)} required>
                <option value="">Select customer</option>
                {data.others.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.account_number ? ` · ${o.account_number}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !reassignTo}>
                Confirm reassignment
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReassignTo(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={dropReason !== null}
        onOpenChange={(next) => {
          if (!next) setDropReason(null);
        }}
        title="Move service to Recycle Bin"
        description="The line leaves live searches and network access is revoked. The customer, other services, invoices, and payments stay."
      >
        {dropReason !== null ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await deleteServiceFn({ data: { id: s.id, reason: dropReason, confirm: true } });
                setDropReason(null);
                await navigate({ to: "/app/recycle-bin" });
              });
            }}
          >
            <Field label="Reason">
              <Input required value={dropReason} onChange={(e) => setDropReason(e.target.value)} placeholder="Why this line is being removed" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || !dropReason.trim()}>
                Move to Recycle Bin
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDropReason(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/app/services" className="inline-flex min-h-11 items-center gap-1 text-sm text-muted hover:text-fg">
      <ArrowLeft className="size-4" strokeWidth={1.75} />
      Services
    </Link>
  );
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-right"}>{value}</dd>
    </div>
  );
}

function GraceMini({
  mode,
  busy,
  onCancel,
  onSubmit,
}: {
  mode: "grant" | "extend" | "revoke";
  busy: boolean;
  onCancel: () => void;
  onSubmit: (days: number, reason: string) => void;
}) {
  const [days, setDays] = useState(3);
  const [reason, setReason] = useState("");
  return (
    <form
      className="grid gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(days, reason);
      }}
    >
      <p className="text-sm text-muted">
        {mode === "revoke"
          ? "Revoking makes this line eligible for normal suspension. The renewal date does not change."
          : "Grace Period is temporary access only. The paid-through / renewal date stays the same."}
      </p>
      {mode !== "revoke" ? (
        <Field label="Days">
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 5, 7].map((d) => (
              <option key={d} value={d}>
                {d} day{d === 1 ? "" : "s"}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}
      <Field label="Reason (optional)">
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          {mode === "grant" ? "Grant" : mode === "extend" ? "Extend" : "Revoke"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

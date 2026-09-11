import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { createService, disconnectService, listServices, rotateServiceSecret, setServiceStatus } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import type { GracePolicy } from "@/lib/isp/grace";
import type { PackageRow, ServiceRow, ServiceStatus, Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/services")({ component: ServicesPage });

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 10);
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}

function remainingLabel(expiresAt: string) {
  const ms = Date.parse(expiresAt) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const days = Math.floor(ms / 86400_000);
  const hours = Math.floor((ms % 86400_000) / 3600_000);
  if (days > 1) return `${days} days remaining`;
  if (days === 1) return hours > 0 ? `1 day ${hours}h remaining` : "1 day remaining";
  if (hours >= 1) return `${hours} hour${hours === 1 ? "" : "s"} remaining`;
  return "Less than an hour remaining";
}

type Panel = { id: string; mode: "grant" | "extend" | "revoke" };

function ServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [policy, setPolicy] = useState<GracePolicy | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", package_id: "", username: "", static_ip: "" });
  const [secretNote, setSecretNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [days, setDays] = useState(3);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await listServices();
    setServices(res.services);
    setCustomers(res.customers);
    setPackages(res.packages);
    setWorkspace(res.workspace);
    setPolicy(res.gracePolicy);
    if (!form.customer_id && res.customers[0]) {
      setForm((f) => ({ ...f, customer_id: res.customers[0].id, package_id: res.packages[0]?.id ?? "" }));
    }
  }

  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await createService({ data: form });
    setOpen(false);
    await load();
  }

  async function setStatus(id: string, status: ServiceStatus) {
    await setServiceStatus({ data: { id, status } });
    await load();
  }

  const role = workspace?.role || "";
  const canGrant = hasPermission(role, "services.grace.grant");
  const canExtend = hasPermission(role, "services.grace.extend");
  const canRevoke = hasPermission(role, "services.grace.revoke");
  const presets = policy?.staff_preset_days?.length ? policy.staff_preset_days : [1, 2, 3, 5, 7];

  async function submitGrace(e: React.FormEvent) {
    e.preventDefault();
    if (!panel) return;
    setBusy(true);
    setError(null);
    try {
      const chosen = custom ? Number(custom) : days;
      if (panel.mode === "grant") {
        await grantGraceFn({ data: { service_id: panel.id, days: chosen, reason } });
      } else if (panel.mode === "extend") {
        await extendGraceFn({ data: { service_id: panel.id, days: chosen, reason } });
      } else {
        await revokeGraceFn({ data: { service_id: panel.id, reason } });
      }
      setPanel(null);
      setReason("");
      setCustom("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update grace period");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted">
            Access goes offline on unpaid invoices, expired time, or a used-up data cap. A confirmed payment restores
            and extends the period. Grace Period keeps a line online temporarily without changing the renewal date.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>Provision service</Button>
      </div>

      {open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <Field label="Customer">
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Package">
            <Select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.access_method}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="PPPoE / voucher username">
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          </Field>
          <Field label="Static IP (blank = auto from pool)">
            <Input value={form.static_ip} onChange={(e) => setForm({ ...form, static_ip: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button type="submit">Activate</Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {secretNote ? <p className="text-sm text-accent">{secretNote}</p> : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[60rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Identity</th>
              <th className="px-4 py-3 font-medium">Package</th>
              <th className="px-4 py-3 font-medium">Paid through</th>
              <th className="px-4 py-3 font-medium">Grace Period</th>
              <th className="px-4 py-3 font-medium">Data</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((s) => {
              const activeGrace = Boolean(s.grace_active && s.grace_expires_at);
              return (
                <tr key={s.id}>
                  <td className="px-4 py-3">{s.customer_name}</td>
                  <td className="px-4 py-3 uppercase">{s.access_method}</td>
                  <td className="px-4 py-3 font-mono text-xs">{s.username || s.static_ip || "—"}</td>
                  <td className="px-4 py-3">{s.package_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {s.period_end ? s.period_end.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {activeGrace && s.grace_expires_at ? (
                      <div className="space-y-0.5">
                        <Badge tone="warn">Grace Period — {remainingLabel(s.grace_expires_at)}</Badge>
                        <div className="text-xs text-muted">
                          {s.grace_days_granted}d · until {formatDate(s.grace_expires_at)}
                          {s.grace_granted_by ? ` · ${s.grace_granted_by}` : ""}
                        </div>
                        {s.grace_reason ? <div className="text-xs text-subtle">{s.grace_reason}</div> : null}
                      </div>
                    ) : s.status === "suspended" && s.suspend_reason !== "bundle" ? (
                      <span className="text-xs text-muted">Grace Period expired — service suspended</span>
                    ) : (
                      <span className="text-xs text-muted">Not active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">
                    {s.bundle_mb > 0 ? `${s.bundle_used_mb}/${s.bundle_mb} MB` : "unlimited"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <Badge tone={statusTone(s.status)}>{s.status === "grace" ? "Grace Period" : s.status}</Badge>
                      {s.suspend_reason ? <span className="text-xs text-muted">{s.suspend_reason}</span> : null}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {s.status !== "active" ? (
                        <Button size="sm" variant="secondary" onClick={() => setStatus(s.id, "active")}>
                          Restore
                        </Button>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(s.id, "suspended")}>
                          Suspend
                        </Button>
                      )}
                      {canGrant && !activeGrace && s.status !== "terminated" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPanel({ id: s.id, mode: "grant" });
                            setDays(presets[2] ?? 3);
                            setError(null);
                          }}
                        >
                          Grant Grace Period
                        </Button>
                      ) : null}
                      {canExtend && activeGrace ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPanel({ id: s.id, mode: "extend" });
                            setDays(presets[0] ?? 1);
                            setError(null);
                          }}
                        >
                          Extend Grace Period
                        </Button>
                      ) : null}
                      {canRevoke && activeGrace ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setPanel({ id: s.id, mode: "revoke" });
                            setError(null);
                          }}
                        >
                          Revoke Grace Period
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          await disconnectService({ data: { id: s.id } });
                          setSecretNote(`Disconnect queued for ${s.username || s.static_ip || s.id}`);
                        }}
                      >
                        Disconnect
                      </Button>
                      {s.access_method === "pppoe" ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const r = await rotateServiceSecret({ data: { id: s.id } });
                            setSecretNote(`New PPPoE password for ${r.username}: ${r.password}`);
                          }}
                        >
                          New password
                        </Button>
                      ) : null}
                    </div>
                    {panel?.id === s.id ? (
                      <form onSubmit={submitGrace} className="mt-3 grid max-w-sm gap-2 rounded-lg border border-border bg-bg p-3">
                        <p className="text-xs text-muted">
                          {panel.mode === "revoke"
                            ? "Revoking makes this line eligible for normal suspension. The renewal date does not change."
                            : "Grace Period is temporary access only. The paid-through / renewal date stays the same."}
                        </p>
                        {panel.mode !== "revoke" ? (
                          <>
                            <Field label="Days">
                              <Select
                                value={custom ? "custom" : String(days)}
                                onChange={(e) => {
                                  if (e.target.value === "custom") {
                                    setCustom(String(days));
                                  } else {
                                    setCustom("");
                                    setDays(Number(e.target.value));
                                  }
                                }}
                              >
                                {presets.map((d) => (
                                  <option key={d} value={d}>
                                    {d} day{d === 1 ? "" : "s"}
                                  </option>
                                ))}
                                {policy?.allow_custom_days ? <option value="custom">Custom</option> : null}
                              </Select>
                            </Field>
                            {custom ? (
                              <Field label="Custom days">
                                <Input
                                  type="number"
                                  min={1}
                                  max={policy?.staff_max_days ?? 14}
                                  value={custom}
                                  onChange={(e) => setCustom(e.target.value)}
                                />
                              </Field>
                            ) : null}
                          </>
                        ) : null}
                        <Field label="Reason (optional)">
                          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note for the audit log" />
                        </Field>
                        {error ? <p className="text-sm text-danger">{error}</p> : null}
                        <div className="flex gap-2">
                          <Button type="submit" size="sm" disabled={busy}>
                            {panel.mode === "grant" ? "Grant" : panel.mode === "extend" ? "Extend" : "Revoke"}
                          </Button>
                          <Button type="button" size="sm" variant="ghost" onClick={() => setPanel(null)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

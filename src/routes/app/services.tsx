import { createFileRoute, Link } from "@tanstack/react-router";
import { MoreHorizontal, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ExpiryEditor, type ExpiryForm } from "@/components/isp/service-expiry-editor";
import { TrafficDrawer } from "@/components/isp/traffic-drawer";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, Input, Select } from "@/components/ui/input";
import { TablePad, VirtualTableFrame } from "@/components/ui/virtual-scroller";
import { useTableVirtualizer } from "@/components/ui/use-virtual-scroller";
import { formatDate, formatMac, remainingLabel } from "@/lib/isp/display";
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { setServiceExpiryFn } from "@/lib/isp/server-expiry";
import { createService, disconnectService, listServices, rotateServiceSecret, setServiceStatus } from "@/lib/isp/server";
import { deleteServiceFn, reassignServiceFn } from "@/lib/isp/server-lifecycle";
import { effectiveAccessIso, expirySourceLabel, openExpiryForm } from "@/lib/isp/service-expiry-format";
import { hasPermission } from "@/lib/isp/rbac";
import type { GracePolicy } from "@/lib/isp/grace";
import type { PackageRow, ServiceRow, ServiceStatus, Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/services")({ component: ServicesPage });

const COLS = 7;

function matchesQuery(s: ServiceRow, q: string) {
  if (!q) return true;
  const hay = [
    s.customer_name,
    s.customer_phone,
    s.account_number,
    s.access_method,
    s.username,
    s.static_ip,
    s.mac_address,
    s.package_name,
    s.status,
    s.suspend_reason,
    s.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

type Panel = { id: string; mode: "grant" | "extend" | "revoke" };

function ServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [policy, setPolicy] = useState<GracePolicy | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", package_id: "", username: "", static_ip: "", notes: "" });
  const [secretNote, setSecretNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [expiry, setExpiry] = useState<ExpiryForm | null>(null);
  const [days, setDays] = useState(3);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [traffic, setTraffic] = useState<ServiceRow | null>(null);
  const [reassign, setReassign] = useState<{ id: string; to: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; label: string; reason: string } | null>(null);

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

  async function submitExpiry(e: React.FormEvent) {
    e.preventDefault();
    if (!expiry || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await setServiceExpiryFn({ data: { id: expiry.service.id, date: expiry.date, reason: expiry.reason } });
      setExpiry(null);
      setSecretNote(
        `Expiry date updated for ${out.customer_name}. Status: ${out.status === "grace" ? "Grace Period" : out.status}. No billing or customer message was sent.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update expiry date");
    } finally {
      setBusy(false);
    }
  }

  const role = workspace?.role || "";
  const canGrant = hasPermission(role, "services.grace.grant");
  const canExtend = hasPermission(role, "services.grace.extend");
  const canRevoke = hasPermission(role, "services.grace.revoke");
  const canManage = hasPermission(role, "services.manage");
  const canExpiry = hasPermission(role, "services.expiry.update");
  const canDelete = hasPermission(role, "services.delete") || canManage;
  const canReassign = hasPermission(role, "services.reassign") || canManage;
  const canTraffic = hasPermission(role, "traffic.view") || hasPermission(role, "services.read");
  const canRecycle = hasPermission(role, "recycle_bin.view");
  const presets = policy?.staff_preset_days?.length ? policy.staff_preset_days : [1, 2, 3, 5, 7];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return services;
    return services.filter((s) => matchesQuery(s, q));
  }, [services, query]);

  const { parentRef, virtualizer, rows: vis, padTop, padBottom } = useTableVirtualizer(filtered.length, 48);

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

  const panelService = panel ? services.find((s) => s.id === panel.id) : null;

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
        <div className="flex flex-wrap gap-2">
          {canRecycle ? (
            <Link
              to="/app/recycle-bin"
              className="inline-flex h-11 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-surface"
            >
              Recycle Bin
            </Link>
          ) : null}
          {canManage ? <Button onClick={() => setOpen(true)}>Provision service</Button> : null}
        </div>
      </div>

      {canManage && open ? (
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
          <Field label="Service notes">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
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

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">Search services</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone, package, MAC, status…"
            className="pl-10"
            autoComplete="off"
          />
        </label>
        <p className="shrink-0 text-xs text-muted sm:text-right">
          {filtered.length === services.length
            ? `${services.length} line${services.length === 1 ? "" : "s"}`
            : `${filtered.length} of ${services.length}`}
        </p>
      </div>

      <VirtualTableFrame parentRef={parentRef} className="rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Phone</th>
              <th className="px-3 py-2 font-medium">Package</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">MAC address</th>
              <th className="px-3 py-2 font-medium">Expiry date</th>
              <th className="sticky right-0 bg-surface px-2 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            <TablePad height={padTop} colSpan={COLS} />
            {vis.map((v) => {
              const s = filtered[v.index];
              const activeGrace = Boolean(s.grace_active && s.grace_expires_at);
              const identity = s.username || s.static_ip || "—";
              return (
                <tr key={s.id} data-index={v.index} ref={virtualizer.measureElement} className="h-12">
                  <td className="max-w-48 px-3 py-1.5">
                    <Link
                      to="/app/customers/$customerId"
                      params={{ customerId: s.customer_id }}
                      className="inline-flex min-h-11 max-w-full items-center truncate font-medium hover:text-accent hover:underline"
                    >
                      {s.customer_name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{s.customer_phone || "—"}</td>
                  <td className="max-w-40 px-3 py-1.5">
                    <div className="truncate">{s.package_name}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-1">
                      <Badge tone={statusTone(s.status)}>{s.status === "grace" ? "Grace Period" : s.status}</Badge>
                      {activeGrace && s.grace_expires_at ? (
                        <span className="hidden text-xs text-warn xl:inline">{remainingLabel(s.grace_expires_at)}</span>
                      ) : null}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{formatMac(s.mac_address)}</td>
                  <td className="whitespace-nowrap px-3 py-1.5">
                    <div>{formatDate(effectiveAccessIso(s))}</div>
                    <div className="text-xs text-subtle">{expirySourceLabel(s.expiry_source, s.grace_active)}</div>
                  </td>
                  <td className="sticky right-0 bg-surface px-1 py-1 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          aria-label={`Actions for ${s.customer_name}`}
                          className="size-11"
                        >
                          <MoreHorizontal className="size-4" strokeWidth={1.75} />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" side="bottom">
                        <DropdownMenuLabel>{s.customer_name}</DropdownMenuLabel>
                        <div className="px-3 pb-2 text-xs text-muted">
                          {s.access_method.toUpperCase()} · {identity}
                          {s.suspend_reason ? ` · ${s.suspend_reason}` : ""}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link to="/app/customers/$customerId" params={{ customerId: s.customer_id }}>
                            View customer
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/app/services/$serviceId" params={{ serviceId: s.id }}>
                            View service
                          </Link>
                        </DropdownMenuItem>
                        {canTraffic ? (
                          <DropdownMenuItem onSelect={() => setTraffic(s)}>Realtime traffic</DropdownMenuItem>
                        ) : null}
                        <DropdownMenuSeparator />
                        {canExpiry ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setError(null);
                              setExpiry(openExpiryForm(s));
                            }}
                          >
                            Edit expiry date
                          </DropdownMenuItem>
                        ) : null}
                        {canManage && s.status !== "active" ? (
                          <DropdownMenuItem onSelect={() => void setStatus(s.id, "active")}>Restore</DropdownMenuItem>
                        ) : null}
                        {canManage && s.status === "active" ? (
                          <DropdownMenuItem onSelect={() => void setStatus(s.id, "suspended")}>Suspend</DropdownMenuItem>
                        ) : null}
                        {canGrant && !activeGrace && s.status !== "terminated" ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setPanel({ id: s.id, mode: "grant" });
                              setDays(presets[2] ?? 3);
                              setError(null);
                            }}
                          >
                            Grant Grace Period
                          </DropdownMenuItem>
                        ) : null}
                        {canExtend && activeGrace ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setPanel({ id: s.id, mode: "extend" });
                              setDays(presets[0] ?? 1);
                              setError(null);
                            }}
                          >
                            Extend Grace Period
                          </DropdownMenuItem>
                        ) : null}
                        {canRevoke && activeGrace ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              setPanel({ id: s.id, mode: "revoke" });
                              setError(null);
                            }}
                          >
                            Revoke Grace Period
                          </DropdownMenuItem>
                        ) : null}
                        {canManage ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              void disconnectService({ data: { id: s.id } }).then(() => {
                                setSecretNote(`Disconnect queued for ${identity}`);
                              });
                            }}
                          >
                            Disconnect
                          </DropdownMenuItem>
                        ) : null}
                        {canManage && s.access_method === "pppoe" ? (
                          <DropdownMenuItem
                            onSelect={() => {
                              if (!window.confirm("Rotate the PPPoE password? The current password stops working immediately.")) return;
                              void rotateServiceSecret({ data: { id: s.id, confirm: true } }).then((r) => {
                                setSecretNote(`New PPPoE password for ${r.username}: ${r.password}`);
                              });
                            }}
                          >
                            New password
                          </DropdownMenuItem>
                        ) : null}
                        {canReassign ? (
                          <DropdownMenuItem
                            onSelect={() => setReassign({ id: s.id, to: customers.find((c) => c.id !== s.customer_id)?.id || "" })}
                          >
                            Reassign
                          </DropdownMenuItem>
                        ) : null}
                        {canDelete ? (
                          <DropdownMenuItem
                            danger
                            onSelect={() =>
                              setDrop({
                                id: s.id,
                                label: `${s.customer_name} · ${s.package_name}`,
                                reason: "",
                              })
                            }
                          >
                            Move to Recycle Bin
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
            <TablePad height={padBottom} colSpan={COLS} />
          </tbody>
        </table>
        {filtered.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">
            {services.length === 0 ? "No services yet." : "No lines match that search."}
          </p>
        ) : null}
      </VirtualTableFrame>

      <Dialog
        open={Boolean(panel)}
        onOpenChange={(next) => {
          if (!next) setPanel(null);
        }}
        title={panel?.mode === "grant" ? "Grant Grace Period" : panel?.mode === "extend" ? "Extend Grace Period" : "Revoke Grace Period"}
        description={panelService ? `${panelService.customer_name} · ${panelService.package_name}` : undefined}
      >
        {panel ? (
          <form onSubmit={submitGrace} className="grid gap-3">
            <p className="text-sm text-muted">
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
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {panel.mode === "grant" ? "Grant" : panel.mode === "extend" ? "Extend" : "Revoke"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

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
            onSubmit={submitExpiry}
            onClose={() => setExpiry(null)}
          />
        ) : null}
      </Dialog>

      <TrafficDrawer
        open={Boolean(traffic)}
        onOpenChange={(open) => {
          if (!open) setTraffic(null);
        }}
        customerId={traffic?.customer_id || ""}
        customerName={traffic?.customer_name}
        serviceId={traffic?.id}
      />

      <Dialog
        open={Boolean(reassign)}
        onOpenChange={(next) => {
          if (!next) setReassign(null);
        }}
        title="Reassign service"
        description="The line keeps its package, credentials, expiry, and history. Invoices and payments stay on the current customer."
      >
        {reassign ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!reassign.to) return;
              setBusy(true);
              setError(null);
              try {
                await reassignServiceFn({ data: { id: reassign.id, customer_id: reassign.to, confirm: true } });
                setReassign(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not reassign");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Destination customer">
              <Select value={reassign.to} onChange={(e) => setReassign({ ...reassign, to: e.target.value })} required>
                <option value="">Select customer</option>
                {customers
                  .filter((c) => c.id !== services.find((row) => row.id === reassign.id)?.customer_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !reassign.to}>
                Confirm reassignment
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReassign(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(drop)}
        onOpenChange={(next) => {
          if (!next) setDrop(null);
        }}
        title="Move service to Recycle Bin"
        description="The line leaves live searches and network access is revoked. The customer, other services, invoices, and payments stay. Staff can restore it from the Recycle Bin."
      >
        {drop ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await deleteServiceFn({ data: { id: drop.id, reason: drop.reason, confirm: true } });
                setDrop(null);
                setSecretNote("Service moved to the Recycle Bin. Customer kept. No invoice or message was sent.");
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not delete service");
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-sm">{drop.label}</p>
            <Field label="Reason">
              <Input
                required
                value={drop.reason}
                onChange={(e) => setDrop({ ...drop, reason: e.target.value })}
                placeholder="Why this line is being removed"
              />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || !drop.reason.trim()}>
                Move to Recycle Bin
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDrop(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}


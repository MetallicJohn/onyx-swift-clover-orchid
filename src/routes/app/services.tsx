import { createFileRoute } from "@tanstack/react-router";
import { MoreHorizontal, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { setServiceExpiryFn } from "@/lib/isp/server-expiry";
import { createService, disconnectService, listServices, rotateServiceSecret, setServiceStatus } from "@/lib/isp/server";
import { effectiveAccessIso, expirySourceLabel, previewStaffExpiry } from "@/lib/isp/service-expiry-format";
import { nairobiDate } from "@/lib/isp/empty-tenant";
import { hasPermission } from "@/lib/isp/rbac";
import type { GracePolicy } from "@/lib/isp/grace";
import type { PackageRow, ServiceRow, ServiceStatus, Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/services")({ component: ServicesPage });

const COLS = 7;

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

function formatMac(raw?: string | null) {
  const compact = String(raw || "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  if (compact.length === 12) return compact.match(/.{2}/g)?.join(":") ?? compact;
  const trimmed = String(raw || "").trim();
  return trimmed || "—";
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
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

type Panel = { id: string; mode: "grant" | "extend" | "revoke" };
type ExpiryForm = { service: ServiceRow; date: string; reason: string };

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
  const [expiry, setExpiry] = useState<ExpiryForm | null>(null);
  const [days, setDays] = useState(3);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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
        {canManage ? <Button onClick={() => setOpen(true)}>Provision service</Button> : null}
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
              const hasActions =
                canManage ||
                canExpiry ||
                (canGrant && !activeGrace && s.status !== "terminated") ||
                (canExtend && activeGrace) ||
                (canRevoke && activeGrace);
              return (
                <tr key={s.id} data-index={v.index} ref={virtualizer.measureElement} className="h-12">
                  <td className="max-w-48 px-3 py-1.5">
                    <div className="truncate font-medium">{s.customer_name}</div>
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
                    {hasActions ? (
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
                          {canExpiry ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                setError(null);
                                setExpiry({
                                  service: s,
                                  date: nairobiDate(effectiveAccessIso(s) || undefined) || nairobiDate(),
                                  reason: "",
                                });
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
                                void rotateServiceSecret({ data: { id: s.id } }).then((r) => {
                                  setSecretNote(`New PPPoE password for ${r.username}: ${r.password}`);
                                });
                              }}
                            >
                              New password
                            </DropdownMenuItem>
                          ) : null}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="inline-block size-11" />
                    )}
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
    </div>
  );
}

function ExpiryEditor({
  form,
  setForm,
  busy,
  error,
  onSubmit,
  onClose,
}: {
  form: ExpiryForm;
  setForm: (next: ExpiryForm) => void;
  busy: boolean;
  error: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}) {
  const s = form.service;
  let preview: ReturnType<typeof previewStaffExpiry> | null = null;
  let parseError = "";
  if (form.date) {
    try {
      preview = previewStaffExpiry({
        ymd: form.date,
        status: s.status,
        suspend_reason: s.suspend_reason,
        bundle_used_mb: s.bundle_used_mb,
        bundle_mb: s.bundle_mb,
      });
    } catch (err) {
      parseError = err instanceof Error ? err.message : "Invalid date";
    }
  }
  const expected = preview?.expectedStatus === "grace" ? "Grace Period" : preview?.expectedStatus || "—";
  return (
    <form onSubmit={onSubmit} className="grid gap-3">
      <dl className="grid gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Customer</dt>
          <dd className="font-medium">{s.customer_name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Account number</dt>
          <dd className="font-mono text-xs">{s.account_number || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Service</dt>
          <dd>
            {s.package_name} · {s.access_method.toUpperCase()}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Current expiry</dt>
          <dd>
            {formatDate(effectiveAccessIso(s))}
            <span className="ml-2 text-xs text-subtle">{expirySourceLabel(s.expiry_source, s.grace_active)}</span>
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Paid through (billing)</dt>
          <dd>{formatDate(s.period_end)}</dd>
        </div>
      </dl>
      <Field label="New expiry date">
        <Input
          type="date"
          value={form.date}
          onChange={(e) => setForm({ ...form, date: e.target.value })}
          required
          disabled={busy}
        />
      </Field>
      {form.date ? (
        <p className="text-sm">
          Selected date: <span className="font-medium">{formatDate(`${form.date}T12:00:00+03:00`)}</span>
          {" · "}
          Expected status: <span className="font-medium">{expected}</span>
        </p>
      ) : null}
      {preview?.expectedReason === "manual" ? (
        <p className="text-sm text-warn">
          This date is today or in the future, but the line stays suspended because of a manual hold. No invoice,
          billing action, SMS or email will be generated.
        </p>
      ) : preview?.expectedReason === "bundle" ? (
        <p className="text-sm text-warn">
          This date is today or in the future, but the line stays suspended because the data cap is used up. No invoice,
          billing action, SMS or email will be generated.
        </p>
      ) : preview?.expectedReason === "terminated" || preview?.expectedStatus === "terminated" ? (
        <p className="text-sm text-warn">
          This line is terminated. The access date is recorded, but the service stays terminated. No invoice, billing
          action, SMS or email will be generated.
        </p>
      ) : preview?.past ? (
        <p className="text-sm text-warn">
          This date is in the past. The service will be suspended. No invoice, billing action, SMS or email will be
          generated.
        </p>
      ) : preview ? (
        <p className="text-sm text-muted">
          This date is today or in the future. The service will be restored if no other suspension condition applies. No
          invoice, billing action, SMS or email will be generated.
        </p>
      ) : null}
      <Field label="Reason">
        <Input
          value={form.reason}
          onChange={(e) => setForm({ ...form, reason: e.target.value })}
          placeholder="Why this access date is changing"
          required
          disabled={busy}
        />
      </Field>
      {parseError ? <p className="text-sm text-danger">{parseError}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy || !form.date || !form.reason.trim() || Boolean(parseError)}>
          {busy ? "Saving…" : "Confirm expiry date"}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

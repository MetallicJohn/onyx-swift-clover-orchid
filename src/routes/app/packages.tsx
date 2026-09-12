import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createPackage, listPackages, updatePackage } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import type { AccessMethod, PackageRow } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/packages")({ component: PackagesPage });

const EMPTY = {
  name: "",
  description: "",
  access_method: "pppoe" as AccessMethod,
  download_mbps: 10,
  upload_mbps: 5,
  price_kes: 2500,
  billing_interval: "monthly",
  grace_days: 5,
  bundle_mb: 0,
  validity_hours: 0,
  active: true,
};

type FormState = typeof EMPTY;
type Filter = "all" | AccessMethod;
type ValidityUnit = "hours" | "days";
type CapUnit = "mb" | "gb";

function blankForm(method: AccessMethod): FormState {
  return { ...EMPTY, access_method: method };
}

function validityUnitOf(hours: number): ValidityUnit {
  return hours > 0 && hours % 24 !== 0 ? "hours" : "days";
}

function capUnitOf(mb: number): CapUnit {
  return mb > 0 && mb % 1024 !== 0 ? "mb" : "gb";
}

function shownValidity(hours: number, unit: ValidityUnit) {
  if (!hours) return 0;
  if (unit === "hours") return hours;
  const days = hours / 24;
  return Number.isInteger(days) ? days : Math.round(days * 100) / 100;
}

function shownCap(mb: number, unit: CapUnit) {
  if (!mb) return 0;
  if (unit === "mb") return mb;
  const gb = mb / 1024;
  return Number.isInteger(gb) ? gb : Math.round(gb * 100) / 100;
}

function hoursFromInput(value: number, unit: ValidityUnit) {
  const n = Math.max(0, Number(value) || 0);
  return Math.round(unit === "days" ? n * 24 : n);
}

function mbFromInput(value: number, unit: CapUnit) {
  const n = Math.max(0, Number(value) || 0);
  return Math.round(unit === "gb" ? n * 1024 : n);
}

function formatValidity(hours: number) {
  if (!hours) return "";
  if (hours % 24 === 0) return ` · ${hours / 24}d`;
  return ` · ${hours}h`;
}

function formatCap(mb: number) {
  if (!mb) return " · unlimited";
  if (mb % 1024 === 0) return ` · ${mb / 1024} GB`;
  return ` · ${mb} MB`;
}

function methodLabel(m: AccessMethod) {
  return m === "pppoe" ? "PPPoE" : m === "static" ? "Static IP" : "Hotspot";
}

function PackagesPage() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [validityUnit, setValidityUnit] = useState<ValidityUnit>("days");
  const [capUnit, setCapUnit] = useState<CapUnit>("gb");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [role, setRole] = useState("");

  async function load() {
    const res = await listPackages();
    setPackages(res.packages);
    setRole(res.workspace.role);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  function startCreate() {
    const method = filter === "all" ? "pppoe" : filter;
    setEditingId(null);
    setForm(blankForm(method));
    setValidityUnit("days");
    setCapUnit("gb");
    setOpen(true);
    setError(null);
  }

  function startEdit(p: PackageRow) {
    setEditingId(p.id);
    setForm({
      name: p.name,
      description: p.description,
      access_method: p.access_method,
      download_mbps: p.download_mbps,
      upload_mbps: p.upload_mbps,
      price_kes: p.price_kes,
      billing_interval: p.billing_interval,
      grace_days: p.grace_days,
      bundle_mb: p.bundle_mb,
      validity_hours: p.validity_hours,
      active: p.active,
    });
    setValidityUnit(validityUnitOf(p.validity_hours));
    setCapUnit(capUnitOf(p.bundle_mb));
    setOpen(true);
    setError(null);
  }

  function pickFilter(next: Filter) {
    setFilter(next);
    if (open && !editingId && next !== "all") {
      setForm((f) => ({ ...f, access_method: next }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updatePackage({ data: { id: editingId, ...form } });
      } else {
        await createPackage({ data: form });
      }
      setOpen(false);
      setEditingId(null);
      setForm(blankForm(filter === "all" ? "pppoe" : filter));
      await load();
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(p: PackageRow) {
    await updatePackage({
      data: {
        id: p.id,
        name: p.name,
        description: p.description,
        access_method: p.access_method,
        download_mbps: p.download_mbps,
        upload_mbps: p.upload_mbps,
        price_kes: p.price_kes,
        billing_interval: p.billing_interval,
        grace_days: p.grace_days,
        bundle_mb: p.bundle_mb,
        validity_hours: p.validity_hours,
        active: !p.active,
      },
    });
    await load();
  }

  const visible = packages.filter((p) => filter === "all" || p.access_method === filter);
  const lockMethod = !editingId && filter !== "all";
  const canManage = hasPermission(role, "packages.manage");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
          <p className="text-sm text-muted">
            Product catalog for PPPoE, static IP, and hotspot. Each package is one PCQ profile on the router — not a simple queue per customer. Unpaid invoices, expired time, or a used-up data cap suspend access automatically. Payment restores it.
          </p>
        </div>
        {canManage ? <Button onClick={startCreate}>New package</Button> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "pppoe", "static", "hotspot"] as const).map((m) => (
          <Button key={m} size="sm" variant={filter === m ? "default" : "secondary"} onClick={() => pickFilter(m)}>
            {m === "all" ? "All" : methodLabel(m)}
          </Button>
        ))}
      </div>

      {canManage && open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <h2 className="font-medium md:col-span-2">{editingId ? "Edit package" : "Create package"}</h2>
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Access method">
            <Select
              value={form.access_method}
              disabled={lockMethod}
              onChange={(e) => setForm({ ...form, access_method: e.target.value as AccessMethod })}
            >
              <option value="pppoe">PPPoE</option>
              <option value="static">Static IP</option>
              <option value="hotspot">Hotspot</option>
            </Select>
            {lockMethod ? (
              <p className="text-xs text-muted">Locked to {methodLabel(filter as AccessMethod)} from the filter above.</p>
            ) : null}
          </Field>
          <Field label="Description">
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Billing interval">
            <Select
              value={form.billing_interval}
              onChange={(e) => setForm({ ...form, billing_interval: e.target.value })}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
          </Field>
          <Field label="Download Mbps">
            <Input
              type="number"
              min={1}
              value={form.download_mbps}
              onChange={(e) => setForm({ ...form, download_mbps: Number(e.target.value) })}
            />
          </Field>
          <Field label="Upload Mbps">
            <Input
              type="number"
              min={1}
              value={form.upload_mbps}
              onChange={(e) => setForm({ ...form, upload_mbps: Number(e.target.value) })}
            />
          </Field>
          <Field label="Price (KES)">
            <Input
              type="number"
              min={0}
              value={form.price_kes}
              onChange={(e) => setForm({ ...form, price_kes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Automatic grace days">
            <Input
              type="number"
              min={0}
              value={form.grace_days}
              onChange={(e) => setForm({ ...form, grace_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Data cap (0 = unlimited)">
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1"
                type="number"
                min={0}
                step={capUnit === "gb" ? "0.5" : "1"}
                value={shownCap(form.bundle_mb, capUnit)}
                onChange={(e) => setForm({ ...form, bundle_mb: mbFromInput(Number(e.target.value), capUnit) })}
              />
              <Select
                className="w-28 shrink-0"
                aria-label="Data cap unit"
                value={capUnit}
                onChange={(e) => setCapUnit(e.target.value as CapUnit)}
              >
                <option value="mb">MB</option>
                <option value="gb">GB</option>
              </Select>
            </div>
          </Field>
          <Field label="Validity (0 = billing interval)">
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1"
                type="number"
                min={0}
                step={validityUnit === "days" ? "0.5" : "1"}
                value={shownValidity(form.validity_hours, validityUnit)}
                onChange={(e) =>
                  setForm({ ...form, validity_hours: hoursFromInput(Number(e.target.value), validityUnit) })
                }
              />
              <Select
                className="w-28 shrink-0"
                aria-label="Validity unit"
                value={validityUnit}
                onChange={(e) => setValidityUnit(e.target.value as ValidityUnit)}
              >
                <option value="hours">Hours</option>
                <option value="days">Days</option>
              </Select>
            </div>
          </Field>
          {editingId ? (
            <Field label="Availability">
              <Select
                value={form.active ? "active" : "inactive"}
                onChange={(e) => setForm({ ...form, active: e.target.value === "active" })}
              >
                <option value="active">Active — can be assigned</option>
                <option value="inactive">Inactive — hidden from new services</option>
              </Select>
            </Field>
          ) : null}
          {error ? <p className="text-sm text-danger md:col-span-2">{error}</p> : null}
          <div className="flex gap-2 md:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Save changes" : "Create package"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                setEditingId(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {visible.map((p) => (
          <article key={p.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{p.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{methodLabel(p.access_method)}</Badge>
                  <Badge tone={statusTone(p.active ? "active" : "pending")}>{p.active ? "active" : "inactive"}</Badge>
                </div>
              </div>
              <div className="font-mono text-sm tabular-nums">{kes(p.price_kes)}</div>
            </div>
            <p className="mt-3 text-sm text-muted">
              {p.download_mbps}/{p.upload_mbps} Mbps · {p.billing_interval}
              {formatValidity(p.validity_hours)} · {p.grace_days}d automatic grace
              {formatCap(p.bundle_mb)}
            </p>
            {p.description ? <p className="mt-1 text-sm text-subtle">{p.description}</p> : null}
            {canManage ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => startEdit(p)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleActive(p)}>
                {p.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
            ) : null}
          </article>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted">
          No packages in this mode yet.
          {filter !== "all" && canManage ? ` New package will create a ${methodLabel(filter)} plan.` : ""}
        </p>
      ) : null}
    </div>
  );
}

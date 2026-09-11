import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createPackage, listPackages, updatePackage } from "@/lib/isp/server";
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

function PackagesPage() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [filter, setFilter] = useState<"all" | AccessMethod>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await listPackages();
    setPackages(res.packages);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY);
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
    setOpen(true);
    setError(null);
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
      setForm(EMPTY);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
          <p className="text-sm text-muted">
            Product catalog for PPPoE, static IP, and hotspot. Unpaid invoices, expired time, or a used-up data cap suspend access automatically. Payment restores it.
          </p>
        </div>
        <Button onClick={startCreate}>New package</Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {(["all", "pppoe", "static", "hotspot"] as const).map((m) => (
          <Button key={m} size="sm" variant={filter === m ? "default" : "secondary"} onClick={() => setFilter(m)}>
            {m === "all" ? "All" : m === "pppoe" ? "PPPoE" : m === "static" ? "Static IP" : "Hotspot"}
          </Button>
        ))}
      </div>

      {open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <h2 className="font-medium md:col-span-2">{editingId ? "Edit package" : "Create package"}</h2>
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Access method">
            <Select
              value={form.access_method}
              onChange={(e) => setForm({ ...form, access_method: e.target.value as AccessMethod })}
            >
              <option value="pppoe">PPPoE</option>
              <option value="static">Static IP</option>
              <option value="hotspot">Hotspot</option>
            </Select>
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
          <Field label="Data cap GB (0 = unlimited)">
            <Input
              type="number"
              min={0}
              value={form.bundle_mb ? Math.round(form.bundle_mb / 1024) : 0}
              onChange={(e) => setForm({ ...form, bundle_mb: Math.max(0, Number(e.target.value)) * 1024 })}
            />
          </Field>
          <Field label="Validity hours (0 = billing interval)">
            <Input
              type="number"
              min={0}
              value={form.validity_hours}
              onChange={(e) => setForm({ ...form, validity_hours: Number(e.target.value) })}
            />
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
                  <Badge tone="accent">{p.access_method === "pppoe" ? "PPPoE" : p.access_method === "static" ? "Static IP" : "Hotspot"}</Badge>
                  <Badge tone={statusTone(p.active ? "active" : "pending")}>{p.active ? "active" : "inactive"}</Badge>
                </div>
              </div>
              <div className="font-mono text-sm tabular-nums">{kes(p.price_kes)}</div>
            </div>
            <p className="mt-3 text-sm text-muted">
              {p.download_mbps}/{p.upload_mbps} Mbps · {p.billing_interval}
              {p.validity_hours ? ` · ${p.validity_hours}h` : ""} · {p.grace_days}d automatic grace
              {p.bundle_mb ? ` · ${p.bundle_mb >= 1024 ? `${Math.round(p.bundle_mb / 1024)} GB` : `${p.bundle_mb} MB`}` : " · unlimited"}
            </p>
            {p.description ? <p className="mt-1 text-sm text-subtle">{p.description}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => startEdit(p)}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void toggleActive(p)}>
                {p.active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </article>
        ))}
      </div>
      {visible.length === 0 ? <p className="text-sm text-muted">No packages in this mode yet.</p> : null}
    </div>
  );
}

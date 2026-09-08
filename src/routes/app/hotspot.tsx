import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createVouchers, listHotspot } from "@/lib/isp/server-ops";

export const Route = createFileRoute("/app/hotspot")({ component: HotspotPage });

function HotspotPage() {
  const [vouchers, setVouchers] = useState<Awaited<ReturnType<typeof listHotspot>>["vouchers"]>([]);
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ package_id: "", count: 5, hours: 24 });
  const [codes, setCodes] = useState<string[]>([]);

  async function load() {
    const r = await listHotspot();
    setVouchers(r.vouchers);
    setPackages(r.packages);
    if (!form.package_id && r.packages[0]) setForm((f) => ({ ...f, package_id: r.packages[0].id }));
  }
  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hotspot</h1>
        <p className="text-sm text-muted">
          Vouchers map to hotspot packages. RADIUS accounts are created when a voucher is sold as a service.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await createVouchers({ data: form });
          setCodes(r.codes);
          await load();
        }}
      >
        <Field label="Package">
          <Select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Count">
          <Input type="number" min={1} max={50} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
        </Field>
        <Field label="Hours">
          <Input type="number" min={1} value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit">Generate</Button>
        </div>
      </form>

      {codes.length ? (
        <p className="rounded-xl border border-border bg-elevated p-3 font-mono text-xs">{codes.join("  ")}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {vouchers.map((v) => (
          <article key={v.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start justify-between">
              <div className="font-mono text-sm">{v.code}</div>
              <Badge tone={statusTone(v.status === "unused" ? "pending" : "active")}>{v.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">
              {v.package_name} · {v.hours}h
            </p>
          </article>
        ))}
      </div>
    </div>
  );
}

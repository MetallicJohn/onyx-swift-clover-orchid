import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createService, disconnectService, listServices, rotateServiceSecret, setServiceStatus } from "@/lib/isp/server";
import type { PackageRow, ServiceRow, ServiceStatus } from "@/lib/isp/types";

export const Route = createFileRoute("/app/services")({ component: ServicesPage });

function ServicesPage() {
  const [services, setServices] = useState<ServiceRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer_id: "", package_id: "", username: "", static_ip: "" });
  const [secretNote, setSecretNote] = useState<string | null>(null);

  async function load() {
    const res = await listServices();
    setServices(res.services);
    setCustomers(res.customers);
    setPackages(res.packages);
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted">PPPoE, static IP, and hotspot access — lifecycle independent of invoices.</p>
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
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Identity</th>
              <th className="px-4 py-3 font-medium">Package</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {services.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.customer_name}</td>
                <td className="px-4 py-3 uppercase">{s.access_method}</td>
                <td className="px-4 py-3 font-mono text-xs">{s.username || s.static_ip || "—"}</td>
                <td className="px-4 py-3">{s.package_name}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(s.status)}>{s.status}</Badge>
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
                    {s.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(s.id, "grace")}>
                        Grace
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

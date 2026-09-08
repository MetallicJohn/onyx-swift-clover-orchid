import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { addCpe, informCpe, listAcs } from "@/lib/isp/server-ops";

export const Route = createFileRoute("/app/acs")({ component: AcsPage });

function AcsPage() {
  const [devices, setDevices] = useState<Awaited<ReturnType<typeof listAcs>>["devices"]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ serial: "", product_class: "F670L", ssid: "", customer_id: "" });

  async function load() {
    const r = await listAcs();
    setDevices(r.devices);
    setCustomers(r.customers);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">GenieACS</h1>
        <p className="text-sm text-muted">
          CPE inventory for a separate ACS service. Informs are recorded here; TR-069 sessions stay on GenieACS.
        </p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await addCpe({ data: form });
          setForm({ ...form, serial: "", ssid: "" });
          await load();
        }}
      >
        <Field label="Serial">
          <Input required value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
        </Field>
        <Field label="Product class">
          <Input value={form.product_class} onChange={(e) => setForm({ ...form, product_class: e.target.value })} />
        </Field>
        <Field label="SSID">
          <Input value={form.ssid} onChange={(e) => setForm({ ...form, ssid: e.target.value })} />
        </Field>
        <Field label="Customer">
          <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Unassigned</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit">Register CPE</Button>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Serial</th>
              <th className="px-4 py-3 font-medium">Class</th>
              <th className="px-4 py-3 font-medium">SSID</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Inform</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {devices.map((d) => (
              <tr key={d.id}>
                <td className="px-4 py-3 font-mono text-xs">{d.serial}</td>
                <td className="px-4 py-3">{d.product_class}</td>
                <td className="px-4 py-3">{d.ssid}</td>
                <td className="px-4 py-3">{d.customer_name ?? "—"}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="ghost" onClick={async () => { await informCpe({ data: { id: d.id } }); await load(); }}>
                    Inform
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { addRouter, listRouters } from "@/lib/isp/server";
import type { RouterRow } from "@/lib/isp/types";

export const Route = createFileRoute("/app/routers")({ component: RoutersPage });

function RoutersPage() {
  const [rows, setRows] = useState<RouterRow[]>([]);
  const [form, setForm] = useState({ name: "", location: "", identity: "", role: "access" });
  const [script, setScript] = useState<string | null>(null);

  async function load() {
    const res = await listRouters();
    setRows(res.routers);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await addRouter({ data: form });
    setScript(generateScript(form.name, form.identity || form.name.toLowerCase()));
    setForm({ name: "", location: "", identity: "", role: "access" });
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Routers</h1>
        <p className="text-sm text-muted">
          Agent + WireGuard model. Routers never expose API ports to the public internet. Paste the generated
          RouterOS snippet on the device after approval.
        </p>
      </div>

      <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
        <Field label="Name">
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
        </Field>
        <Field label="Identity">
          <Input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} />
        </Field>
        <Field label="Role">
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="core">Core</option>
            <option value="edge">Edge</option>
            <option value="access">Access</option>
            <option value="hotspot">Hotspot</option>
          </Select>
        </Field>
        <Button type="submit">Add router</Button>
      </form>

      {script ? (
        <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
          {script}
        </pre>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Router</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">WireGuard</th>
              <th className="px-4 py-3 font-medium">CPU</th>
              <th className="px-4 py-3 font-medium">Uptime</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">
                  <div>{r.name}</div>
                  <div className="text-xs text-muted">{r.location}</div>
                </td>
                <td className="px-4 py-3 capitalize">{r.role}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(r.wg_status)}>{r.wg_status}</Badge>
                </td>
                <td className="px-4 py-3 font-mono">{r.cpu_pct}%</td>
                <td className="px-4 py-3 font-mono">{r.uptime_hours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function generateScript(name: string, identity: string) {
  return `/system identity set name="${identity || name}"
# Gridline agent onboarding — review before apply
/interface wireguard add name=wg-gridline listen-port=13231
/ip address add address=10.200.0.2/24 interface=wg-gridline
/ip firewall filter add chain=input protocol=udp dst-port=13231 action=accept comment="gridline-wg"
# RADIUS and API stay on the tunnel only — never bind management to WAN
/ip service set api address=10.200.0.0/24
/ip service set winbox address=10.200.0.0/24`;
}

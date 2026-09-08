import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { createCustomer, listCustomers } from "@/lib/isp/server";
import type { CustomerRow } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/customers")({ component: CustomersPage });

function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", type: "individual" });
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await listCustomers();
    setRows(res.customers);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = rows.filter((r) =>
    `${r.name} ${r.phone} ${r.email}`.toLowerCase().includes(q.toLowerCase()),
  );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createCustomer({ data: form });
      setOpen(false);
      setForm({ name: "", phone: "", email: "", address: "", type: "individual" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted">CRM with service counts and outstanding balances.</p>
        </div>
        <Button onClick={() => setOpen(true)}>New customer</Button>
      </div>

      <Input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />

      {open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Type">
            <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              <option value="individual">Individual</option>
              <option value="business">Business</option>
            </Select>
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Address">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={busy}>
              Save
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-surface text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Services</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((c) => (
              <tr key={c.id} className="bg-bg">
                <td className="px-4 py-3">
                  <div className="font-medium">{c.name}</div>
                  <div className="text-xs text-muted capitalize">{c.type}</div>
                </td>
                <td className="px-4 py-3 text-muted">
                  <div>{c.phone}</div>
                  <div className="text-xs">{c.email}</div>
                </td>
                <td className="px-4 py-3 font-mono tabular-nums">{c.service_count}</td>
                <td className="px-4 py-3 font-mono tabular-nums">{kes(c.balance_kes)}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

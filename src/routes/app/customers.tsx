import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge, statusTone } from "@/components/ui/badge";
import { Field, Input, Select } from "@/components/ui/input";
import { createCustomer, listCustomers, setCustomerPortalPassword } from "@/lib/isp/server";
import type { CustomerRow } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/customers")({ component: CustomersPage });

function churnTone(band: string) {
  if (band === "high" || band === "churned") return "danger" as const;
  if (band === "medium") return "warn" as const;
  return "ok" as const;
}

function CustomersPage() {
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [risk, setRisk] = useState<"all" | "watch">("all");
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", type: "individual", portal_password: "" });
  const [busy, setBusy] = useState(false);
  const [portalFor, setPortalFor] = useState<string | null>(null);
  const [portalPass, setPortalPass] = useState("");

  async function load() {
    const res = await listCustomers();
    setRows(res.customers);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const filtered = rows.filter((r) => {
    const hit = `${r.name} ${r.phone} ${r.email}`.toLowerCase().includes(q.toLowerCase());
    if (!hit) return false;
    if (risk === "watch") return r.churn_band !== "low";
    return true;
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await createCustomer({
        data: {
          name: form.name,
          phone: form.phone,
          email: form.email,
          address: form.address,
          type: form.type,
          portal_password: form.portal_password || undefined,
        },
      });
      setOpen(false);
      setForm({ name: "", phone: "", email: "", address: "", type: "individual", portal_password: "" });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const watching = rows.filter((r) => r.churn_band !== "low").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted">
            CRM with balances and a live churn score from billing, access, and tickets.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>New customer</Button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input placeholder="Search name, phone, email" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex gap-2">
          <Button size="sm" variant={risk === "all" ? "default" : "secondary"} onClick={() => setRisk("all")}>
            All
          </Button>
          <Button size="sm" variant={risk === "watch" ? "default" : "secondary"} onClick={() => setRisk("watch")}>
            At risk ({watching})
          </Button>
        </div>
      </div>

      {open ? (
        <form onSubmit={submit} className="grid gap-3 rounded-xl bg-surface p-5 shadow-card md:grid-cols-2 md:p-6">
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
          <Field label="Portal password (optional)">
            <Input
              type="password"
              minLength={8}
              value={form.portal_password}
              onChange={(e) => setForm({ ...form, portal_password: e.target.value })}
              placeholder="Customer can sign in at /portal"
            />
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

      <div className="overflow-x-auto rounded-xl bg-surface shadow-card">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Contact</th>
              <th className="px-4 py-3 font-medium">Services</th>
              <th className="px-4 py-3 font-medium">Balance</th>
              <th className="px-4 py-3 font-medium">Churn</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((c) => (
              <tr key={c.id}>
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
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs tabular-nums">{c.churn_score}</span>
                    <Badge tone={churnTone(c.churn_band)}>{c.churn_band}</Badge>
                  </div>
                  {c.churn_reason ? <div className="mt-1 max-w-[12rem] truncate text-xs text-subtle">{c.churn_reason}</div> : null}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-col items-start gap-2">
                    <a href={`/app/statements?customer=${c.id}`} className="inline-flex min-h-11 items-center text-sm text-accent hover:underline">
                      Statement
                    </a>
                    {portalFor === c.id ? (
                      <form
                        className="flex flex-col gap-2 sm:flex-row"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await setCustomerPortalPassword({ data: { customer_id: c.id, password: portalPass } });
                          setPortalFor(null);
                          setPortalPass("");
                        }}
                      >
                        <Input
                          type="password"
                          required
                          minLength={8}
                          value={portalPass}
                          onChange={(e) => setPortalPass(e.target.value)}
                          placeholder="New portal password"
                          autoComplete="new-password"
                        />
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="text-sm text-muted hover:text-fg"
                        onClick={() => {
                          setPortalFor(c.id);
                          setPortalPass("");
                        }}
                      >
                        Portal password
                      </button>
                    )}
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

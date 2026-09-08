import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { assignOpenTicket, commentOpenTicket, listTicketStaff } from "@/lib/isp/server-more";
import { createTicket, listTickets, setTicketStatus } from "@/lib/isp/server";
import type { TicketRow } from "@/lib/isp/types";

export const Route = createFileRoute("/app/tickets")({ component: TicketsPage });

const STATUSES = ["new", "assigned", "accepted", "travelling", "on_site", "waiting", "resolved", "closed"];

function TicketsPage() {
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [staff, setStaff] = useState<{ user_id: string; role: string; name: string }[]>([]);
  const [form, setForm] = useState({ title: "", category: "performance", priority: "normal", customer_id: "" });
  const [comment, setComment] = useState<Record<string, string>>({});

  async function load() {
    const [res, s] = await Promise.all([listTickets(), listTicketStaff()]);
    setTickets(res.tickets);
    setCustomers(res.customers);
    setStaff(s.staff);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="text-sm text-muted">Dispatch with SLA, assignment, and comments. Field app only sees assigned jobs.</p>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          await createTicket({ data: form });
          setForm({ ...form, title: "" });
          await load();
        }}
      >
        <Field label="Title">
          <Input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </Field>
        <Field label="Customer">
          <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
            <option value="">Network / unassigned</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="performance">Performance</option>
            <option value="billing">Billing</option>
            <option value="network">Network</option>
            <option value="hotspot">Hotspot</option>
            <option value="install">Installation</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </Select>
        </Field>
        <Button type="submit">Create ticket</Button>
      </form>

      <ul className="space-y-3">
        {tickets.map((t) => (
          <li key={t.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 text-xs text-muted">
                  {t.customer_name ?? "Network"} · {t.category} · {t.priority}
                  {t.assigned_to ? ` · assigned ${t.assigned_to.slice(-6)}` : ""}
                </div>
              </div>
              <Badge tone={statusTone(t.status)}>{t.status.replace("_", " ")}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Select
                value=""
                onChange={async (e) => {
                  if (!e.target.value) return;
                  await assignOpenTicket({ data: { id: t.id, user_id: e.target.value } });
                  await load();
                }}
              >
                <option value="">Assign…</option>
                {staff.map((s) => (
                  <option key={s.user_id} value={s.user_id}>
                    {s.name} ({s.role})
                  </option>
                ))}
              </Select>
              <Input
                placeholder="Comment"
                value={comment[t.id] || ""}
                onChange={(e) => setComment({ ...comment, [t.id]: e.target.value })}
              />
              <Button
                size="sm"
                variant="secondary"
                onClick={async () => {
                  await commentOpenTicket({ data: { id: t.id, body: comment[t.id] || "" } });
                  setComment({ ...comment, [t.id]: "" });
                }}
              >
                Note
              </Button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {STATUSES.filter((s) => s !== t.status).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await setTicketStatus({ data: { id: t.id, status: s } });
                    await load();
                  }}
                >
                  {s.replace("_", " ")}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

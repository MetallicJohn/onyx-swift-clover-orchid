import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createInvoice, listBilling, recordPayment } from "@/lib/isp/server";
import type { InvoiceRow, PaymentRow } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/billing")({ component: BillingPage });

function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [form, setForm] = useState({ customer_id: "", amount_kes: 2500, due_date: "" });
  const [pay, setPay] = useState({ invoice_id: "", provider: "mpesa", reference: "" });
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    const res = await listBilling();
    setInvoices(res.invoices);
    setPayments(res.payments);
    setCustomers(res.customers);
    if (!form.customer_id && res.customers[0]) {
      setForm((f) => ({ ...f, customer_id: res.customers[0].id }));
    }
    const unpaid = res.invoices.find((i) => i.status !== "paid");
    if (unpaid) setPay((p) => ({ ...p, invoice_id: unpaid.id }));
  }

  useEffect(() => {
    const d = new Date();
    d.setDate(d.getDate() + 14);
    setForm((f) => ({ ...f, due_date: d.toISOString().slice(0, 10) }));
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="text-sm text-muted">
          Immutable invoices. Payments are idempotent by provider reference. A confirmed payment restores service.
        </p>
      </div>

      {err ? <p className="text-sm text-danger">{err}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await createInvoice({ data: form });
              await load();
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Invoice failed");
            }
          }}
        >
          <h2 className="font-medium">Issue invoice</h2>
          <Field label="Customer">
            <Select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (KES)">
            <Input
              type="number"
              min={1}
              value={form.amount_kes}
              onChange={(e) => setForm({ ...form, amount_kes: Number(e.target.value) })}
            />
          </Field>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <Button type="submit">Issue</Button>
        </form>

        <form
          className="grid gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            try {
              await recordPayment({ data: pay });
              setPay((p) => ({ ...p, reference: "" }));
              await load();
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Payment failed");
            }
          }}
        >
          <h2 className="font-medium">Record payment</h2>
          <Field label="Invoice">
            <Select value={pay.invoice_id} onChange={(e) => setPay({ ...pay, invoice_id: e.target.value })}>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {i.customer_name} · {i.status}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Provider">
            <Select value={pay.provider} onChange={(e) => setPay({ ...pay, provider: e.target.value })}>
              <option value="mpesa">M-Pesa</option>
              <option value="airtel">Airtel Money</option>
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
            </Select>
          </Field>
          <Field label="Reference">
            <Input
              required
              placeholder="M-Pesa receipt"
              value={pay.reference}
              onChange={(e) => setPay({ ...pay, reference: e.target.value })}
            />
          </Field>
          <Button type="submit">Confirm payment</Button>
        </form>
      </div>

      <div className="flex gap-2">
        <Button variant={tab === "invoices" ? "default" : "secondary"} size="sm" onClick={() => setTab("invoices")}>
          Invoices
        </Button>
        <Button variant={tab === "payments" ? "default" : "secondary"} size="sm" onClick={() => setTab("payments")}>
          Payments
        </Button>
      </div>

      {tab === "invoices" ? (
        <Table
          headers={["Number", "Customer", "Amount", "Due", "Status"]}
          rows={invoices.map((i) => [
            i.number,
            i.customer_name,
            kes(i.amount_kes),
            i.due_date,
            <Badge key={i.id} tone={statusTone(i.status)}>
              {i.status}
            </Badge>,
          ])}
        />
      ) : (
        <Table
          headers={["Reference", "Customer", "Provider", "Amount", "Status"]}
          rows={payments.map((p) => [
            p.reference,
            p.customer_name,
            p.provider,
            kes(p.amount_kes),
            <Badge key={p.id} tone={statusTone(p.status)}>
              {p.status}
            </Badge>,
          ])}
        />
      )}
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className="px-4 py-3">
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

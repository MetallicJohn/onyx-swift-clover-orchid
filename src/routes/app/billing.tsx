import type { ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { InvoicePreview } from "@/components/isp/document-preview";
import { PdfActions } from "@/components/isp/pdf-actions";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { invoiceStatusLabel, type InvoiceDocument } from "@/lib/isp/document-format";
import { downloadPdf, printPdf, viewPdf } from "@/lib/isp/pdf-client";
import { emailInvoicePdf, getInvoiceDocument, getInvoicePdf } from "@/lib/isp/server-docs";
import { createInvoice, listBilling, recordPayment, saveBillingSettings } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import { confirmStk, sendStk } from "@/lib/isp/server-ops";
import type { InvoiceRow, PaymentRow } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/billing")({ component: BillingPage });

type Quote = {
  customer_id: string;
  package_id: string;
  service_id: string;
  package_name: string;
  price_kes: number;
  billing_interval: string;
};

type Line = { description: string; quantity: number; unit_kes: number; package_id?: string; service_id?: string };

type InvoiceDetail = InvoiceDocument;

function defaultDue() {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}

function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [customers, setCustomers] = useState<{ id: string; name: string; phone: string }[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [vatEnabled, setVatEnabled] = useState(false);
  const [vatRate, setVatRate] = useState(16);
  const [totals, setTotals] = useState({ outstanding: 0, overdue: 0, collected: 0, open: 0 });
  const [aging, setAging] = useState<Record<string, { count: number; amount: number }>>({});
  const [tab, setTab] = useState<"invoices" | "payments">("invoices");
  const [filter, setFilter] = useState("open");
  const [form, setForm] = useState({ customer_id: "", due_date: "", notes: "" });
  const [lines, setLines] = useState<Line[]>([]);
  const [pay, setPay] = useState({ invoice_id: "", provider: "mpesa", reference: "", amount_kes: 0 });
  const [err, setErr] = useState<string | null>(null);
  const [stk, setStk] = useState<{ checkout_id: string; note?: string } | null>(null);
  const [detail, setDetail] = useState<InvoiceDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [role, setRole] = useState("");

  const preview = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + Math.max(1, line.quantity || 1) * Math.max(0, line.unit_kes || 0), 0);
    const tax = vatEnabled ? Math.round((subtotal * vatRate) / 100) : 0;
    return { subtotal, tax, total: subtotal + tax, tax_rate: vatEnabled ? vatRate : 0 };
  }, [lines, vatEnabled, vatRate]);

  function quotesFor(customerId: string): Line[] {
    const q = quotes.filter((x) => x.customer_id === customerId);
    if (q.length === 0) return [{ description: "Internet service", quantity: 1, unit_kes: 2500 }];
    return q.map((x) => ({
      description: `${x.package_name} (${x.billing_interval})`,
      quantity: 1,
      unit_kes: x.price_kes,
      package_id: x.package_id,
      service_id: x.service_id,
    }));
  }

  async function load(selectId?: string) {
    const res = await listBilling();
    setInvoices(res.invoices);
    setPayments(res.payments);
    setCustomers(res.customers);
    setQuotes(res.quotes);
    setVatEnabled(res.vat_enabled);
    setVatRate(res.vat_rate_pct);
    setTotals(res.totals);
    setAging(res.aging);
    setRole(res.workspace.role);
    if (!form.customer_id && res.customers[0]) {
      setForm((f) => ({ ...f, customer_id: res.customers[0].id }));
      setLines(quotesForCustomer(res.quotes, res.customers[0].id));
    }
    const target = selectId || pay.invoice_id;
    const unpaid = res.invoices.find((i) => i.id === target) || res.invoices.find((i) => i.remaining_kes > 0);
    if (unpaid) setPay((p) => ({ ...p, invoice_id: unpaid.id, amount_kes: unpaid.remaining_kes || unpaid.amount_kes }));
    return res;
  }

  useEffect(() => {
    setForm((f) => ({ ...f, due_date: defaultDue() }));
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = invoices.filter((i) => {
    if (filter === "all") return true;
    if (filter === "open") return i.remaining_kes > 0;
    return i.status === filter;
  });
  const canInvoice = hasPermission(role, "invoices.manage");
  const canPay = hasPermission(role, "payments.manage");

  async function openInvoice(id: string) {
    setErr(null);
    const doc = await getInvoiceDocument({ data: { id } });
    setDetail(doc);
    setPay((p) => ({
      ...p,
      invoice_id: doc.invoice.id,
      amount_kes: doc.totals.amountDue || doc.totals.totalPayable,
    }));
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
          <p className="text-sm text-muted">
            Package-backed invoices, optional VAT, and partial payments. Confirmed payment restores service unless another
            invoice is still overdue.
          </p>
        </div>
        {canInvoice ? (
        <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm">
          <input
            type="checkbox"
            checked={vatEnabled}
            onChange={async (e) => {
              const on = e.target.checked;
              setVatEnabled(on);
              await saveBillingSettings({ data: { vat_enabled: on, vat_rate_pct: vatRate } });
            }}
          />
          Add {vatRate}% VAT (exclusive)
        </label>
        ) : vatEnabled ? (
          <p className="text-sm text-muted">VAT {vatRate}% exclusive</p>
        ) : null}
      </div>

      {err ? <p className="text-sm text-danger print:hidden">{err}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 print:hidden">
        <Stat label="Outstanding" value={kes(totals.outstanding)} sub={`${totals.open} open invoices`} />
        <Stat label="Overdue" value={kes(totals.overdue)} sub="Past due remaining" tone="danger" />
        <Stat label="Collected" value={kes(totals.collected)} sub="Confirmed receipts" />
        <Stat
          label="Aging 60+"
          value={kes(aging["60+"]?.amount ?? 0)}
          sub={`${aging["60+"]?.count ?? 0} invoices`}
        />
      </div>

      <div className="grid gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted sm:grid-cols-5 print:hidden">
        {(["current", "1-30", "31-60", "60+", "paid"] as const).map((k) => (
          <div key={k} className="flex items-center justify-between gap-2 px-1">
            <span className="uppercase tracking-wide">{k}</span>
            <span className="font-mono text-fg">
              {aging[k]?.count ?? 0} · {kes(aging[k]?.amount ?? 0)}
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 print:hidden">
        {canInvoice ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setBusy(true);
            try {
              const inv = await createInvoice({
                data: {
                  customer_id: form.customer_id,
                  due_date: form.due_date,
                  notes: form.notes,
                  items: lines,
                },
              });
              await load(inv.id);
              await openInvoice(inv.id);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Invoice failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="font-medium">Issue invoice</h2>
          <Field label="Customer">
            <Select
              value={form.customer_id}
              onChange={(e) => {
                const customer_id = e.target.value;
                setForm({ ...form, customer_id });
                setLines(quotesFor(customer_id));
              }}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="space-y-2">
            <div className="text-xs font-medium tracking-wide text-muted">Lines</div>
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-[1fr_4.5rem_7rem] gap-2">
                <Input
                  value={line.description}
                  onChange={(e) => setLines(lines.map((l, i) => (i === idx ? { ...l, description: e.target.value } : l)))}
                />
                <Input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) =>
                    setLines(lines.map((l, i) => (i === idx ? { ...l, quantity: Number(e.target.value) || 1 } : l)))
                  }
                />
                <Input
                  type="number"
                  min={0}
                  value={line.unit_kes}
                  onChange={(e) =>
                    setLines(lines.map((l, i) => (i === idx ? { ...l, unit_kes: Number(e.target.value) || 0 } : l)))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setLines([...lines, { description: "", quantity: 1, unit_kes: 0 }])}
            >
              Add line
            </Button>
          </div>
          <Field label="Due date">
            <Input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} />
          </Field>
          <Field label="Notes">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Shown on the invoice" />
          </Field>
          <div className="flex items-end justify-between gap-3 text-sm">
            <div className="text-muted">
              Subtotal {kes(preview.subtotal)}
              {preview.tax ? ` · VAT ${preview.tax_rate}% ${kes(preview.tax)}` : " · no VAT"}
              <div className="font-mono text-fg">Total {kes(preview.total)}</div>
            </div>
            <Button type="submit" disabled={busy || preview.total <= 0}>
              Issue
            </Button>
          </div>
        </form>
        ) : null}

        {canPay ? (
        <form
          className="grid gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setErr(null);
            setBusy(true);
            try {
              await recordPayment({
                data: {
                  invoice_id: pay.invoice_id,
                  provider: pay.provider,
                  reference: pay.reference,
                  amount_kes: pay.amount_kes,
                },
              });
              setPay((p) => ({ ...p, reference: "" }));
              setStk(null);
              await load(pay.invoice_id);
              if (detail?.invoice.id === pay.invoice_id) await openInvoice(pay.invoice_id);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : "Payment failed");
            } finally {
              setBusy(false);
            }
          }}
        >
          <h2 className="font-medium">Record payment</h2>
          <Field label="Invoice">
            <Select
              value={pay.invoice_id}
              onChange={(e) => {
                const invoice_id = e.target.value;
                const inv = invoices.find((i) => i.id === invoice_id);
                setPay({ ...pay, invoice_id, amount_kes: inv?.remaining_kes || inv?.amount_kes || 0 });
              }}
            >
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {i.customer_name} · {i.status} · {kes(i.remaining_kes)} due
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (KES)">
              <Input
                type="number"
                min={1}
                value={pay.amount_kes}
                onChange={(e) => setPay({ ...pay, amount_kes: Number(e.target.value) })}
              />
            </Field>
            <Field label="Provider">
              <Select value={pay.provider} onChange={(e) => setPay({ ...pay, provider: e.target.value })}>
                <option value="mpesa">M-Pesa Daraja</option>
                <option value="kopokopo">Kopo Kopo</option>
                <option value="airtel">Airtel Money</option>
                <option value="bank">Bank</option>
                <option value="cash">Cash</option>
              </Select>
            </Field>
          </div>
          <Field label="Reference">
            <Input
              required
              placeholder="M-Pesa receipt"
              value={pay.reference}
              onChange={(e) => setPay({ ...pay, reference: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Confirm payment
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || (pay.provider !== "mpesa" && pay.provider !== "kopokopo")}
              onClick={async () => {
                setErr(null);
                try {
                  const r = await sendStk({
                    data: { invoice_id: pay.invoice_id, provider: pay.provider, amount_kes: pay.amount_kes },
                  });
                  setStk({ checkout_id: r.checkout_id, note: r.note });
                  if (r.note && !r.checkout_id.startsWith("ws_")) setErr(r.note);
                } catch (ex) {
                  setErr(ex instanceof Error ? ex.message : "STK failed");
                }
              }}
            >
              Send STK push
            </Button>
          </div>
        </form>
        ) : null}
      </div>

      {stk ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface p-4 text-sm print:hidden">
          <span>
            STK sent · checkout <span className="font-mono">{stk.checkout_id}</span>
            {stk.note ? <span className="text-muted"> · {stk.note}</span> : null}
          </span>
          {stk.checkout_id.startsWith("ws_") ? (
            <Button
              size="sm"
              onClick={async () => {
                await confirmStk({ data: { checkout_id: stk.checkout_id } });
                setStk(null);
                await load(pay.invoice_id);
                if (pay.invoice_id) await openInvoice(pay.invoice_id);
              }}
            >
              Simulate Daraja callback
            </Button>
          ) : (
            <span className="text-xs text-muted">Waiting for the live callback.</span>
          )}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant={tab === "invoices" ? "default" : "secondary"} size="sm" onClick={() => setTab("invoices")}>
          Invoices
        </Button>
        <Button variant={tab === "payments" ? "default" : "secondary"} size="sm" onClick={() => setTab("payments")}>
          Payments
        </Button>
        {tab === "invoices"
          ? (
            <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 w-auto min-w-36">
              <option value="open">Open</option>
              <option value="all">All</option>
              <option value="issued">Issued</option>
              <option value="due">Due</option>
              <option value="overdue">Overdue</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
            </Select>
          )
          : null}
      </div>

      {tab === "invoices" ? (
        <Table
          headers={["Number", "Customer", "Total", "Remaining", "Due", "Status"]}
          rows={visible.map((i) => [
            <button key={i.id} type="button" className="font-mono text-accent hover:underline" onClick={() => openInvoice(i.id)}>
              {i.number}
            </button>,
            i.customer_name,
            kes(i.amount_kes),
            kes(i.remaining_kes),
            i.due_date,
            <Badge key={`${i.id}-st`} tone={statusTone(i.status)}>
              {invoiceStatusLabel(i.status)}
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

      {detail ? <InvoicePanel doc={detail} onClose={() => setDetail(null)} /> : null}
    </div>
  );
}

function quotesForCustomer(quotes: Quote[], customerId: string): Line[] {
  const q = quotes.filter((x) => x.customer_id === customerId);
  if (q.length === 0) return [{ description: "Internet service", quantity: 1, unit_kes: 2500 }];
  return q.map((x) => ({
    description: `${x.package_name} (${x.billing_interval})`,
    quantity: 1,
    unit_kes: x.price_kes,
    package_id: x.package_id,
    service_id: x.service_id,
  }));
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className={`mt-2 font-mono text-2xl tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-subtle">{sub}</div>
    </div>
  );
}

function InvoicePanel({
  doc,
  onClose,
}: {
  doc: InvoiceDetail;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function withPdf(mode: "view" | "download" | "print") {
    setBusy(true);
    setError(null);
    try {
      const file = await getInvoicePdf({ data: { id: doc.invoice.id } });
      if (mode === "download") downloadPdf(file);
      else if (mode === "print") printPdf(file);
      else viewPdf(file);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Could not build the PDF");
    } finally {
      setBusy(false);
    }
  }

  async function sendEmail() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const r = await emailInvoicePdf({ data: { id: doc.invoice.id } });
      setNote(r.status === "sent" ? `Emailed to ${r.to}` : `Queued for ${r.to}`);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Could not email the invoice");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{doc.invoice.number}</h2>
          <p className="text-sm text-muted">
            {doc.customer.name} · {doc.invoice.statusLabel}
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      <PdfActions
        busy={busy}
        note={note}
        error={error}
        canEmail={Boolean(doc.customer.email)}
        onView={() => withPdf("view")}
        onDownload={() => withPdf("download")}
        onPrint={() => withPdf("print")}
        onEmail={sendEmail}
      />
      <InvoicePreview doc={doc} />
    </section>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border print:hidden">
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
          {rows.length === 0 ? (
            <tr>
              <td className="px-4 py-8 text-muted" colSpan={headers.length}>
                Nothing in this view.
              </td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="px-4 py-3">
                    {c}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

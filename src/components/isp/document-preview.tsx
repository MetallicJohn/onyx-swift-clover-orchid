import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import {
  formatDay,
  formatMoney,
  invoiceStatusTone,
  type InvoiceDocument,
  type StatementDocument,
} from "@/lib/isp/document-format";

function paperTone(label: string) {
  const t = invoiceStatusTone(label);
  if (t === "ok") return "ok" as const;
  if (t === "warn") return "warn" as const;
  if (t === "danger") return "danger" as const;
  return "muted" as const;
}

function Money({ n, currency }: { n: number; currency: string }) {
  return <span className="font-mono tabular-nums">{formatMoney(n, currency)}</span>;
}

export function InvoicePreview({ doc }: { doc: InvoiceDocument }) {
  const ccy = doc.brand.currency;
  const t = doc.totals;
  return (
    <article className="overflow-hidden rounded-xl bg-paper text-paper-ink shadow-card">
      <div className="h-1.5" style={{ background: doc.brand.brandColor || "var(--color-accent)" }} />
      <div className="space-y-6 p-5 md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex gap-3">
            <div
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-sm font-semibold"
              style={{
                background: doc.brand.brandColor || "var(--color-accent)",
                color: "var(--color-accent-fg)",
              }}
            >
              {doc.brand.name
                .split(/\s+/)
                .filter(Boolean)
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase() || "ISP"}
            </div>
            <div>
              <h2 className="text-lg font-semibold">{doc.brand.name}</h2>
              <p className="text-sm text-paper-muted">
                {[doc.brand.address, doc.brand.phone, doc.brand.email, doc.brand.website].filter(Boolean).join(" · ")}
              </p>
              {doc.brand.taxPin ? <p className="text-xs text-paper-muted">PIN {doc.brand.taxPin}</p> : null}
            </div>
          </div>
          <div className="rounded-lg bg-paper-wash px-4 py-3 text-sm">
            <div className="text-xs font-semibold tracking-wide text-paper-muted">INVOICE</div>
            <div className="font-mono">{doc.invoice.number}</div>
            <div className="text-xs text-paper-muted">
              {formatDay(doc.invoice.issuedAt, doc.brand.timezone)} · due {formatDay(doc.invoice.dueDate, doc.brand.timezone)}
            </div>
            <Badge className="mt-2" tone={paperTone(doc.invoice.statusLabel)}>
              {doc.invoice.statusLabel}
            </Badge>
          </div>
        </header>

        <section>
          <div className="text-xs font-semibold tracking-wide text-paper-muted">BILL TO</div>
          <p className="mt-1 font-medium">{doc.customer.name}</p>
          <p className="text-sm text-paper-muted">
            Account {doc.customer.accountNo}
            {doc.customer.phone ? ` · ${doc.customer.phone}` : ""}
            {doc.customer.email ? ` · ${doc.customer.email}` : ""}
          </p>
          {doc.customer.address ? <p className="text-sm text-paper-muted">{doc.customer.address}</p> : null}
        </section>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead>
              <tr className="border-b border-paper-line text-xs tracking-wide text-paper-muted">
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 font-medium">Service</th>
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 text-right font-medium">Qty</th>
                <th className="py-2 text-right font-medium">Unit</th>
                <th className="py-2 text-right font-medium">Disc.</th>
                <th className="py-2 text-right font-medium">Tax</th>
                <th className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {doc.lines.map((l, i) => (
                <tr key={`${l.description}-${i}`} className="border-b border-paper-line/70">
                  <td className="py-2">{l.description}</td>
                  <td className="py-2 text-paper-muted">{l.packageName || "—"}</td>
                  <td className="py-2 text-paper-muted">{l.period}</td>
                  <td className="py-2 text-right font-mono">{l.quantity}</td>
                  <td className="py-2 text-right">
                    <Money n={l.unit} currency={ccy} />
                  </td>
                  <td className="py-2 text-right">{l.discount ? <Money n={l.discount} currency={ccy} /> : "—"}</td>
                  <td className="py-2 text-right">{l.tax ? <Money n={l.tax} currency={ccy} /> : "—"}</td>
                  <td className="py-2 text-right">
                    <Money n={l.total} currency={ccy} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto max-w-xs space-y-1 text-sm">
          <Row label="Subtotal" value={<Money n={t.subtotal} currency={ccy} />} />
          {t.discount ? <Row label="Discount" value={<Money n={t.discount} currency={ccy} />} /> : null}
          {t.tax ? <Row label={`VAT ${t.taxRate}%`} value={<Money n={t.tax} currency={ccy} />} /> : null}
          <Row
            label={t.previousBalance < 0 ? "Previous credit" : "Previous balance"}
            value={<Money n={Math.abs(t.previousBalance)} currency={ccy} />}
          />
          {t.payments ? <Row label="Payments / credits" value={<Money n={t.payments} currency={ccy} />} /> : null}
          <Row label="Amount due" value={<Money n={t.amountDue} currency={ccy} />} />
          {t.creditBalance > 0 ? (
            <Row strong ok label="Credit balance" value={<Money n={t.creditBalance} currency={ccy} />} />
          ) : (
            <Row strong due={t.totalPayable > 0} label="Total payable" value={<Money n={t.totalPayable} currency={ccy} />} />
          )}
        </dl>

        {doc.payments.length ? (
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-paper-muted">RECEIPTS</h3>
            <ul className="mt-2 space-y-1 text-sm">
              {doc.payments.map((p) => (
                <li key={p.reference} className="flex justify-between gap-3">
                  <span className="text-paper-muted">
                    {p.provider} {p.reference} · {formatDay(p.paidAt, doc.brand.timezone)}
                  </span>
                  <Money n={p.amount} currency={ccy} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {doc.brand.paymentMethods.length && t.totalPayable > 0 ? (
          <section>
            <h3 className="text-xs font-semibold tracking-wide text-paper-muted">HOW TO PAY</h3>
            <ul className="mt-2 grid gap-2 sm:grid-cols-2">
              {doc.brand.paymentMethods.map((m) => (
                <li key={m.label} className="rounded-lg bg-paper-wash px-3 py-2 text-sm">
                  <div className="font-medium">{m.label}</div>
                  <div className="text-paper-muted">
                    {m.detail} · Account ref {doc.customer.accountNo}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {doc.invoice.notes ? <p className="text-sm text-paper-muted">{doc.invoice.notes}</p> : null}
      </div>
    </article>
  );
}

export function StatementPreview({ doc }: { doc: StatementDocument }) {
  const ccy = doc.brand.currency;
  const s = doc.summary;
  const cards = [
    { label: "Opening", value: s.opening },
    { label: "Invoices", value: s.invoices },
    { label: "Payments", value: s.payments },
    { label: "Credits", value: s.credits },
    { label: "Adjustments", value: s.adjustments },
    { label: s.closing < 0 ? "Credit balance" : "Closing", value: Math.abs(s.closing), warn: s.closing > 0, ok: s.closing < 0 },
  ];
  return (
    <article className="overflow-hidden rounded-xl bg-paper text-paper-ink shadow-card">
      <div className="h-1.5" style={{ background: doc.brand.brandColor || "var(--color-accent)" }} />
      <div className="space-y-6 p-5 md:p-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">{doc.brand.name}</h2>
            <p className="text-sm text-paper-muted">Statement · Account {doc.customer.accountNo}</p>
            <p className="text-xs text-paper-muted">
              {formatDay(doc.periodStart, doc.brand.timezone)} – {formatDay(doc.periodEnd, doc.brand.timezone)}
            </p>
          </div>
          <div className="text-right">
            <div className="font-medium">{doc.customer.name}</div>
            <p className="text-sm text-paper-muted">
              {[doc.customer.phone, doc.customer.email, doc.customer.address].filter(Boolean).join(" · ")}
            </p>
          </div>
        </header>

        <div className="grid gap-2 sm:grid-cols-3">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg bg-paper-wash px-3 py-3">
              <div className="text-xs font-semibold tracking-wide text-paper-muted uppercase">{c.label}</div>
              <div className={`mt-1 font-mono text-lg ${c.warn ? "text-danger" : c.ok ? "text-ok" : ""}`}>
                {formatMoney(c.value, ccy)}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead>
              <tr className="border-b border-paper-line text-xs tracking-wide text-paper-muted">
                <th className="py-2 font-medium">Date</th>
                <th className="py-2 font-medium">Reference</th>
                <th className="py-2 font-medium">Description</th>
                <th className="py-2 text-right font-medium">Debit</th>
                <th className="py-2 text-right font-medium">Credit</th>
                <th className="py-2 text-right font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              {doc.rows.map((r, i) => (
                <tr key={`${r.date}-${i}`} className="border-b border-paper-line/70">
                  <td className="py-2 whitespace-nowrap">{formatDay(r.date, doc.brand.timezone)}</td>
                  <td className="py-2 font-mono text-xs">{r.reference}</td>
                  <td className="py-2">{r.description}</td>
                  <td className="py-2 text-right">{r.debit ? formatMoney(r.debit, ccy) : ""}</td>
                  <td className="py-2 text-right">{r.credit ? formatMoney(r.credit, ccy) : ""}</td>
                  <td className="py-2 text-right font-mono">{formatMoney(r.balance, ccy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className={`text-right text-lg font-semibold ${s.closing > 0 ? "text-danger" : s.closing < 0 ? "text-ok" : ""}`}>
          {s.closing < 0 ? "Credit balance " : s.closing > 0 ? "Amount outstanding " : "Account settled "}
          {formatMoney(Math.abs(s.closing), ccy)}
        </p>
      </div>
    </article>
  );
}

function Row({
  label,
  value,
  strong,
  due,
  ok,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  due?: boolean;
  ok?: boolean;
}) {
  return (
    <div className={`flex justify-between gap-6 ${strong ? "pt-1 font-semibold" : "text-paper-muted"}`}>
      <dt>{label}</dt>
      <dd className={due ? "text-danger" : ok ? "text-ok" : "text-paper-ink"}>{value}</dd>
    </div>
  );
}

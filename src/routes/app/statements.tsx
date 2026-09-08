import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/input";
import { listCustomers } from "@/lib/isp/server";
import { getStatement } from "@/lib/isp/server-more";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/statements")({ component: StatementsPage });

function StatementsPage() {
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [id, setId] = useState("");
  const [doc, setDoc] = useState<Awaited<ReturnType<typeof getStatement>> | null>(null);

  useEffect(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        const q = new URLSearchParams(window.location.search).get("customer");
        const first = q || r.customers[0]?.id || "";
        setId(first);
        if (first) getStatement({ data: { customer_id: first } }).then(setDoc).catch(console.error);
      })
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Statement</h1>
          <p className="text-sm text-muted">Ledger, invoices, and receipts for one account.</p>
        </div>
        <div className="flex gap-2">
          <Field label="Customer">
            <Select
              value={id}
              onChange={async (e) => {
                setId(e.target.value);
                setDoc(await getStatement({ data: { customer_id: e.target.value } }));
              }}
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Button className="self-end" variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </div>

      {doc ? (
        <article className="space-y-6 rounded-xl border border-border bg-surface p-6">
          <header>
            <h2 className="text-xl font-semibold">{doc.customer.name}</h2>
            <p className="text-sm text-muted">
              {doc.customer.phone} · {doc.customer.email} · {doc.customer.address}
            </p>
            <p className="mt-2 font-mono text-sm">Balance {kes(doc.balance)}</p>
          </header>
          <section>
            <h3 className="mb-2 font-medium">Invoices</h3>
            <ul className="text-sm">
              {doc.invoices.map((i) => (
                <li key={i.number} className="flex justify-between py-1">
                  <span>
                    {i.number} · {i.status} · due {i.due_date.slice(0, 10)}
                  </span>
                  <span className="font-mono">{kes(i.amount_kes)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-medium">Payments</h3>
            <ul className="text-sm">
              {doc.payments.map((p) => (
                <li key={p.reference} className="flex justify-between py-1">
                  <span>
                    {p.provider} {p.reference} · {p.status}
                  </span>
                  <span className="font-mono">{kes(p.amount_kes)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 font-medium">Ledger</h3>
            <ul className="text-sm">
              {doc.ledger.map((l, i) => (
                <li key={i} className="flex justify-between py-1">
                  <span>
                    {l.entry_type} {l.memo}
                  </span>
                  <span className="font-mono">
                    {l.debit_kes ? `Dr ${kes(l.debit_kes)}` : `Cr ${kes(l.credit_kes)}`}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </article>
      ) : null}
    </div>
  );
}

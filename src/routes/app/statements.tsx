import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { StatementPreview } from "@/components/isp/document-preview";
import { PdfActions } from "@/components/isp/pdf-actions";
import { Field, Select } from "@/components/ui/input";
import type { StatementDocument } from "@/lib/isp/document-format";
import { downloadPdf, printPdf, viewPdf } from "@/lib/isp/pdf-client";
import { emailStatementPdf, getStatementDocument, getStatementPdf } from "@/lib/isp/server-docs";
import { listCustomers } from "@/lib/isp/server";

export const Route = createFileRoute("/app/statements")({ component: StatementsPage });

function StatementsPage() {
  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [id, setId] = useState("");
  const [doc, setDoc] = useState<StatementDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadDoc(customerId: string) {
    if (!customerId) return;
    setError(null);
    setDoc(await getStatementDocument({ data: { customer_id: customerId } }));
  }

  useEffect(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        const q = new URLSearchParams(window.location.search).get("customer");
        const first = q || r.customers[0]?.id || "";
        setId(first);
        if (first) loadDoc(first).catch(console.error);
      })
      .catch(console.error);
  }, []);

  async function withPdf(mode: "view" | "download" | "print") {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const file = await getStatementPdf({ data: { customer_id: id } });
      if (mode === "download") downloadPdf(file);
      else if (mode === "print") printPdf(file);
      else viewPdf(file);
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Could not build the PDF");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Statement</h1>
          <p className="text-sm text-muted">Ledger, invoices, and receipts for one account — print-ready PDF.</p>
        </div>
        <Field label="Customer">
          <Select
            value={id}
            onChange={async (e) => {
              setId(e.target.value);
              setNote(null);
              await loadDoc(e.target.value);
            }}
          >
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {doc ? (
        <div className="space-y-4">
          <PdfActions
            busy={busy}
            note={note}
            error={error}
            canEmail={Boolean(doc.customer.email)}
            onView={() => withPdf("view")}
            onDownload={() => withPdf("download")}
            onPrint={() => withPdf("print")}
            onEmail={async () => {
              setBusy(true);
              setError(null);
              setNote(null);
              try {
                const r = await emailStatementPdf({ data: { customer_id: id } });
                setNote(r.status === "sent" ? `Emailed to ${r.to}` : `Queued for ${r.to}`);
              } catch (ex) {
                setError(ex instanceof Error ? ex.message : "Could not email the statement");
              } finally {
                setBusy(false);
              }
            }}
          />
          <StatementPreview doc={doc} />
        </div>
      ) : (
        <p className="text-sm text-muted">Select a customer to open their statement.</p>
      )}
    </div>
  );
}

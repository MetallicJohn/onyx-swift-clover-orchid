import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { StatementPreview } from "@/components/isp/document-preview";
import { PdfActions } from "@/components/isp/pdf-actions";
import { Badge, statusTone } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { VirtualGrid } from "@/components/ui/virtual-scroller";
import { useColumnCount } from "@/components/ui/use-virtual-scroller";
import type { StatementDocument } from "@/lib/isp/document-format";
import { downloadPdf, printPdf, viewPdf } from "@/lib/isp/pdf-client";
import { emailStatementPdf, getStatementDocument, getStatementPdf } from "@/lib/isp/server-docs";
import { listCustomers } from "@/lib/isp/server";
import type { CustomerRow } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

export const Route = createFileRoute("/app/statements")({ component: StatementsPage });

function StatementsPage() {
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [query, setQuery] = useState("");
  const [id, setId] = useState("");
  const [doc, setDoc] = useState<StatementDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const columns = useColumnCount(1, 2, 3);

  async function loadDoc(customerId: string) {
    if (!customerId) {
      setDoc(null);
      return;
    }
    setError(null);
    setDoc(await getStatementDocument({ data: { customer_id: customerId } }));
  }

  async function selectCustomer(customerId: string) {
    setId(customerId);
    setNote(null);
    await loadDoc(customerId);
  }

  useEffect(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        const q = new URLSearchParams(window.location.search).get("customer");
        if (q && r.customers.some((c) => c.id === q)) {
          setId(q);
          loadDoc(q).catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers;
    return customers.filter((c) =>
      `${c.name} ${c.phone} ${c.email} ${c.address}`.toLowerCase().includes(needle),
    );
  }, [customers, query]);

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Statements</h1>
        <p className="text-sm text-muted">Pick a customer to open their ledger, invoices, and receipts — print-ready PDF.</p>
      </div>

      <div className="relative max-w-xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, phone, or email"
          className="pl-10"
          aria-label="Search customers"
        />
      </div>

      {customers.length === 0 ? (
        <p className="text-sm text-muted">No customers yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted">No customers match “{query.trim()}”.</p>
      ) : (
        <VirtualGrid
          items={filtered}
          columns={columns}
          estimateSize={168}
          renderItem={(c) => {
            const selected = c.id === id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => void selectCustomer(c.id)}
                className={cn(
                  "min-h-11 w-full rounded-xl border bg-surface p-4 text-left transition-colors",
                  selected
                    ? "border-accent ring-2 ring-accent/40"
                    : "border-border hover:border-accent/40 hover:bg-elevated/40",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{c.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted capitalize">{c.type}</div>
                  </div>
                  <Badge tone={statusTone(c.status)}>{c.status}</Badge>
                </div>
                <div className="mt-3 space-y-0.5 text-sm text-muted">
                  {c.phone ? <div className="truncate">{c.phone}</div> : null}
                  {c.email ? <div className="truncate">{c.email}</div> : null}
                  {!c.phone && !c.email ? <div>No contact on file</div> : null}
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-muted">
                  <span>
                    {c.service_count} {c.service_count === 1 ? "service" : "services"}
                  </span>
                  <span className="font-mono tabular-nums text-fg">{kes(c.balance_kes)}</span>
                </div>
              </button>
            );
          }}
        />
      )}

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

import { createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { StatementPreview } from "@/components/isp/document-preview";
import { PdfActions } from "@/components/isp/pdf-actions";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VirtualList } from "@/components/ui/virtual-scroller";
import type { StatementDocument } from "@/lib/isp/document-format";
import { downloadPdf, printPdf, viewPdf } from "@/lib/isp/pdf-client";
import { emailStatementPdf, getStatementDocument, getStatementPdf } from "@/lib/isp/server-docs";
import { listCustomers } from "@/lib/isp/server";
import type { CustomerRow } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

export const Route = createFileRoute("/app/statements")({
  validateSearch: (search: Record<string, unknown>): { customer?: string } => ({
    customer: typeof search.customer === "string" && search.customer ? search.customer : undefined,
  }),
  component: StatementsPage,
});

const countFmt = new Intl.NumberFormat("en-KE");

function statusOf(c: CustomerRow) {
  return c.line_status || c.status;
}

function StatementsPage() {
  const navigate = Route.useNavigate();
  const { customer: customerParam } = Route.useSearch();
  const listId = useId();
  const req = useRef(0);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [id, setId] = useState(customerParam ?? "");
  const [hi, setHi] = useState(0);
  const [doc, setDoc] = useState<StatementDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(!customerParam);

  async function loadDoc(customerId: string) {
    if (!customerId) {
      setDoc(null);
      return;
    }
    const n = ++req.current;
    setError(null);
    try {
      const next = await getStatementDocument({ data: { customer_id: customerId } });
      if (n !== req.current) return;
      setDoc(next);
    } catch (ex) {
      if (n !== req.current) return;
      setDoc(null);
      setError(ex instanceof Error ? ex.message : "Could not load the statement");
    }
  }

  async function selectCustomer(customerId: string) {
    setId(customerId);
    setNote(null);
    setPicking(false);
    void navigate({ search: { customer: customerId }, replace: true });
    await loadDoc(customerId);
  }

  useEffect(() => {
    listCustomers()
      .then((r) => {
        setCustomers(r.customers);
        const wanted = customerParam && r.customers.some((c) => c.id === customerParam) ? customerParam : "";
        if (wanted) {
          setId(wanted);
          setPicking(false);
          loadDoc(wanted).catch(console.error);
        } else {
          setPicking(true);
        }
      })
      .catch(console.error)
      .finally(() => setReady(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = needle
      ? customers.filter((c) =>
          `${c.name} ${c.phone} ${c.email} ${c.address} ${c.id}`.toLowerCase().includes(needle),
        )
      : customers;
    return [...rows].sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  }, [customers, query]);

  useEffect(() => {
    const idx = filtered.findIndex((c) => c.id === id);
    setHi(idx >= 0 ? idx : 0);
  }, [filtered, id]);

  const selected = customers.find((c) => c.id === id) ?? null;
  const active = filtered[hi] ?? null;

  function onListKey(e: KeyboardEvent) {
    if (!filtered.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHi((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHi(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHi(filtered.length - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active) void selectCustomer(active.id);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  }

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

  const listPane = (
    <section
      className="flex h-[min(28rem,62dvh)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface lg:h-full"
      onKeyDown={onListKey}
    >
      <div className="shrink-0 space-y-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, email, or area"
            className="pl-10"
            aria-label="Search customers"
            autoComplete="off"
            autoFocus
            role="combobox"
            aria-autocomplete="list"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={active ? `${listId}-${active.id}` : undefined}
          />
        </div>
        <p className="text-xs text-muted" aria-live="polite">
          {query.trim()
            ? `${countFmt.format(filtered.length)} matching of ${countFmt.format(customers.length)}`
            : `${countFmt.format(customers.length)} customers · A–Z · type to search`}
        </p>
      </div>

      {!ready ? (
        <p className="p-4 text-sm text-muted">Loading customers…</p>
      ) : customers.length === 0 ? (
        <p className="p-4 text-sm text-muted">No customers yet.</p>
      ) : filtered.length === 0 ? (
        <p className="p-4 text-sm text-muted">No customers match “{query.trim()}”.</p>
      ) : (
        <div id={listId} role="listbox" aria-label="Customers" className="flex min-h-0 flex-1 flex-col">
          <VirtualList
            items={filtered}
            estimateSize={56}
            overscan={16}
            scrollToIndex={hi}
            className="h-0 min-h-0 flex-1 overflow-auto"
            viewportClassName=""
            renderItem={(c, index) => {
              const on = c.id === id;
              const focused = index === hi;
              const st = statusOf(c);
              return (
                <button
                  type="button"
                  id={`${listId}-${c.id}`}
                  role="option"
                  aria-selected={on}
                  onClick={() => void selectCustomer(c.id)}
                  aria-current={on ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-3 border-b border-l-2 border-border px-3 py-2 text-left transition-colors duration-150",
                    on ? "border-l-accent bg-accent/10" : "border-l-transparent",
                    focused && !on && "bg-elevated",
                    !on && !focused && "hover:bg-elevated/60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <Badge tone={statusTone(st)}>{st}</Badge>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-xs text-muted">
                      <span className="truncate">{c.phone || c.email || "No contact"}</span>
                      <span className={cn("shrink-0 font-mono tabular-nums", c.balance_kes > 0 ? "text-warn" : "text-muted")}>
                        {kes(c.balance_kes)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            }}
          />
        </div>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-6.5rem)]">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight">Statements</h1>
        <p className="text-sm text-muted">Search the account, then print or email the ledger. The list stays put at a thousand customers.</p>
      </div>

      {selected && !picking ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3 py-2 lg:hidden">
          <div className="min-w-0">
            <div className="truncate font-medium">{selected.name}</div>
            <div className="truncate text-xs text-muted">
              {selected.phone || selected.email || "No contact"} · {kes(selected.balance_kes)}
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
            Change
          </Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
        <div className={cn("min-h-0", picking ? "block" : "hidden lg:block")}>{listPane}</div>

        <section className={cn("flex min-h-0 min-w-0 flex-col lg:overflow-hidden", picking && "max-lg:hidden")}>
          {doc ? (
            <>
              <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 pb-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-medium">{doc.customer.name}</h2>
                  <p className="text-sm text-muted">
                    Account {doc.customer.accountNo}
                    {doc.customer.phone ? ` · ${doc.customer.phone}` : ""}
                  </p>
                </div>
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
              </div>
              <div className="min-h-0 lg:flex-1 lg:overflow-auto">
                <StatementPreview doc={doc} />
              </div>
            </>
          ) : (
            <div className="grid h-full min-h-48 place-items-center rounded-xl border border-dashed border-border bg-surface/60 px-4 py-10 text-center">
              <p className="text-sm text-muted">
                {error
                  ? error
                  : picking || !id
                    ? "Pick a customer from the list. Type to search — do not scroll a thousand cards."
                    : "Loading statement…"}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

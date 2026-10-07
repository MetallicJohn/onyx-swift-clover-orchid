import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FileText, Download, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { apiAccountTone, apiPaymentMethodLabel, apiPaymentProcessed, apiPaymentStatusLabel } from "@/lib/isp/api-payment-format";
import { formatShortDateTime } from "@/lib/isp/display";
import { downloadPdf } from "@/lib/isp/pdf-client";
import {
  apiPaymentPayloadFn,
  exportApiPaymentsFn,
  exportApiPaymentsPdfFn,
  getApiPaymentsFn,
  matchApiPaymentFn,
  retryApiPaymentFn,
  searchApiPaymentAccountsFn,
} from "@/lib/isp/server-api-payments";
import { kes } from "@/lib/utils";

type Desk = Awaited<ReturnType<typeof getApiPaymentsFn>>;
type Row = Desk["rows"][number];
type AccountHit = Awaited<ReturnType<typeof searchApiPaymentAccountsFn>>["rows"][number];

const RANGES = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "This week"],
  ["month", "This month"],
  ["all", "All"],
  ["custom", "Custom"],
] as const;

const STATUSES = [
  ["all", "All"],
  ["unmatched", "Unmatched"],
  ["matched", "Matched"],
  ["processed", "Processed"],
  ["processing_failed", "Processing failed"],
] as const;

export const Route = createFileRoute("/app/api-payments")({
  validateSearch: (search: Record<string, unknown>) => ({
    range: typeof search.range === "string" ? search.range : "month",
    status: typeof search.status === "string" ? search.status : "all",
    channel: typeof search.channel === "string" ? search.channel : "all",
    q: typeof search.q === "string" ? search.q : "",
    from: typeof search.from === "string" ? search.from : "",
    to: typeof search.to === "string" ? search.to : "",
    page: Number(search.page) > 0 ? Math.floor(Number(search.page)) : 1,
    size: [25, 50, 100, 250].includes(Number(search.size)) ? Number(search.size) : 25,
  }),
  component: ApiPaymentsPage,
});

function ago(at: number) {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (s < 10) return "Updated just now";
  if (s < 60) return `Updated ${s}s ago`;
  return `Updated ${Math.floor(s / 60)}m ago`;
}

function ApiPaymentsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [desk, setDesk] = useState<Desk | null>(null);
  const [error, setError] = useState("");
  const [loadedAt, setLoadedAt] = useState(0);
  const [tick, setTick] = useState(0);
  const [matchRow, setMatchRow] = useState<Row | null>(null);
  const [exporting, setExporting] = useState<"" | "csv" | "pdf">("");
  const [payload, setPayload] = useState("");

  function patch(next: Partial<typeof search>, resetPage = true) {
    void navigate({
      to: "/app/api-payments",
      search: { ...search, ...next, page: resetPage && next.page == null ? 1 : (next.page ?? search.page) },
    });
  }

  useEffect(() => {
    let cancel = false;
    getApiPaymentsFn({ data: search })
      .then((row) => {
        if (cancel) return;
        setDesk(row);
        setError("");
        setLoadedAt(Date.now());
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load API payments");
      });
    return () => {
      cancel = true;
    };
  }, [search]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      getApiPaymentsFn({ data: search })
        .then((row) => {
          setDesk(row);
          setError("");
          setLoadedAt(Date.now());
        })
        .catch((err) => setError(err instanceof Error ? err.message : "Refresh failed"));
    }, 45_000);
    const clock = window.setInterval(() => setTick((n) => n + 1), 15_000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(clock);
    };
  }, [search]);

  const pages = Math.max(1, Math.ceil((desk?.total || 0) / search.size));
  const from = desk && desk.total ? (search.page - 1) * search.size + 1 : 0;
  const to = desk ? Math.min(desk.total, search.page * search.size) : 0;
  const filteredEmpty = Boolean(desk && desk.total === 0 && desk.hasAny);
  const fresh = Boolean(desk && !desk.hasAny);

  async function download() {
    setExporting("csv");
    setError("");
    try {
      const file = await exportApiPaymentsFn({ data: search });
      const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.filename || "api-payments.csv";
      a.click();
      URL.revokeObjectURL(url);
      if (file.truncated) {
        setError(`CSV includes the first ${file.exported} of ${file.total} rows. Narrow the date or status filter for the rest.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting("");
    }
  }

  async function downloadPdfFile() {
    setExporting("pdf");
    setError("");
    try {
      const file = await exportApiPaymentsPdfFn({ data: search });
      downloadPdf(file);
      if (file.truncated) {
        setError(`PDF includes the first ${file.exported} of ${file.total} rows. Narrow the filter, or use Export CSV for a larger set.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF export failed");
    } finally {
      setExporting("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">API Payments</h1>
          <p className="text-sm text-muted">Payments received through configured payment APIs, before and after reconciliation.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted" data-tick={tick}>{loadedAt ? ago(loadedAt) : ""}</span>
          {desk?.canExport ? (
            <>
              <Button type="button" variant="secondary" disabled={Boolean(exporting)} onClick={() => void downloadPdfFile()}>
                <FileText className="size-4" />
                {exporting === "pdf" ? "Preparing PDF…" : "Export PDF"}
              </Button>
              <Button type="button" variant="secondary" disabled={Boolean(exporting)} onClick={() => void download()}>
                <Download className="size-4" />
                {exporting === "csv" ? "Exporting…" : "Export CSV"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={() => patch({})}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <PeriodCard label="Today" vs="previous day" card={desk?.cards.today} />
        <PeriodCard label="This week" vs="previous week" card={desk?.cards.week} />
        <PeriodCard label="This month" vs="previous month" card={desk?.cards.month} />
      </div>

      <ReconciliationBoard desk={desk} onUnmatched={() => patch({ status: "unmatched", range: "all" })} onFailed={() => patch({ status: "processing_failed" })} onMatch={setMatchRow} canMatch={Boolean(desk?.canMatch)} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Date">
          {RANGES.map(([id, label]) => (
            <button key={id} type="button" className={chip(search.range === id)} onClick={() => patch({ range: id })}>
              {label}
            </button>
          ))}
        </div>
        {search.range === "custom" ? (
          <div className="flex flex-wrap gap-2">
            <Input type="date" aria-label="From" value={search.from} onChange={(e) => patch({ from: e.target.value })} />
            <Input type="date" aria-label="To" value={search.to} onChange={(e) => patch({ to: e.target.value })} />
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Status">
          {STATUSES.map(([id, label]) => (
            <button key={id} type="button" className={chip(search.status === id)} onClick={() => patch({ status: id })}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input
              className="pl-9"
              placeholder="Transaction, account, name, phone, amount"
              value={search.q}
              aria-label="Search API payments"
              onChange={(e) => patch({ q: e.target.value })}
            />
          </div>
          <select
            className="h-11 rounded-md border border-border bg-bg px-3 text-sm"
            aria-label="Payment method"
            value={search.channel}
            onChange={(e) => patch({ channel: e.target.value })}
          >
            <option value="all">All methods</option>
            {(desk?.methodOptions || []).map((m) => (
              <option key={`${m.provider}:${m.channel}`} value={`${m.provider}:${m.channel}`}>
                {apiPaymentMethodLabel(m.provider, m.channel)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!desk && !error ? <Skeleton /> : null}
      {fresh ? (
        <EmptyState
          title="No API payments yet"
          description="Payments received through configured payment APIs will appear here."
          action={
            <Link to="/app/settings/$page" params={{ page: "payments" }} className="text-sm text-accent hover:underline">
              Configure a payment API
            </Link>
          }
        />
      ) : null}
      {filteredEmpty ? (
        <EmptyState
          title="No payments match your filters."
          action={
            <button type="button" className="text-sm text-accent hover:underline" onClick={() => patch({ status: "all", channel: "all", q: "", range: "month", from: "", to: "" })}>
              Clear filters
            </button>
          }
        />
      ) : null}

      {desk && desk.rows.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  {["Date & time", "Name", "Transaction", "Account", "Amount", "Method", "Status", "Customer", ""].map((h) => (
                    <th key={h} className="px-2 py-2 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {desk.rows.map((row) => (
                  <PaymentLine key={row.id} row={row} canMatch={desk.canMatch} canRetry={desk.canRetry} canPayload={desk.canPayload} onMatch={setMatchRow} onPayload={setPayload} onChanged={() => patch({ page: search.page }, false)} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2 md:hidden">
            {desk.rows.map((row) => (
              <article key={row.id} className="rounded-xl border border-border bg-surface p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium">{row.payer_name || "Unknown payer"}</div>
                    <div className="text-xs text-muted">{formatShortDateTime(row.trans_time)} · {row.trans_id}</div>
                  </div>
                  <div className="font-medium">{kes(row.amount_kes)}</div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <AccountText row={row} canMatch={desk.canMatch} onMatch={setMatchRow} />
                  <Badge tone={apiAccountTone(row.status) === "ok" ? "ok" : apiAccountTone(row.status) === "danger" ? "danger" : apiAccountTone(row.status) === "warn" ? "warn" : "muted"}>
                    {apiPaymentStatusLabel(row.status)}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted">{apiPaymentMethodLabel(row.provider, row.channel)}{row.customer_name ? ` · ${row.customer_name}` : ""}</div>
                {row.failure_reason ? <p className="mt-1 text-xs text-warn">{row.failure_reason}</p> : null}
                <RowActions row={row} canRetry={desk.canRetry} canPayload={desk.canPayload} onPayload={setPayload} onChanged={() => patch({ page: search.page }, false)} />
              </article>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p className="text-muted">Showing {from}–{to} of {desk.total} payments</p>
            <div className="flex items-center gap-2">
              <select className="h-9 rounded-md border border-border bg-bg px-2" aria-label="Rows per page" value={search.size} onChange={(e) => patch({ size: Number(e.target.value) })}>
                {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
              <Button type="button" variant="secondary" disabled={search.page <= 1} onClick={() => patch({ page: search.page - 1 }, false)}>Previous</Button>
              <span className="text-muted">{search.page} / {pages}</span>
              <Button type="button" variant="secondary" disabled={search.page >= pages} onClick={() => patch({ page: search.page + 1 }, false)}>Next</Button>
            </div>
          </div>
        </>
      ) : null}

      <MatchDialog row={matchRow} onClose={() => setMatchRow(null)} onDone={() => { setMatchRow(null); patch({ page: search.page }, false); }} />
      <Dialog open={Boolean(payload)} onOpenChange={(open) => { if (!open) setPayload(""); }} title="Provider payload">
        <pre className="overflow-x-auto text-xs">{payload}</pre>
      </Dialog>
    </div>
  );
}

function chip(on: boolean) {
  return on
    ? "h-9 rounded-full bg-accent px-3 text-xs text-accent-fg"
    : "h-9 rounded-full border border-border px-3 text-xs text-muted";
}

function PeriodCard({ label, vs, card }: { label: string; vs: string; card?: { amount: number; count: number; delta: number | null } }) {
  const delta = card?.delta;
  const up = delta != null && delta >= 0;
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold">{card ? kes(card.amount) : "—"}</div>
      <div className="text-xs text-muted">{card ? `${card.count} transactions` : ""}</div>
      <div className={up ? "text-xs text-ok" : "text-xs text-danger"}>
        {delta == null ? "No previous period" : `${up ? "↑" : "↓"} ${Math.abs(delta)}% vs ${vs}`}
      </div>
    </div>
  );
}

function ReconciliationBoard({
  desk,
  onUnmatched,
  onFailed,
  onMatch,
  canMatch,
}: {
  desk: Desk | null;
  onUnmatched: () => void;
  onFailed: () => void;
  onMatch: (row: Row) => void;
  canMatch: boolean;
}) {
  const rec = desk?.reconciliation;
  const received = rec?.received || 0;
  const share = (amount: number) => (received > 0 ? `${Math.max(0, (amount / received) * 100)}%` : "0%");
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Reconciliation">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Reconciliation</h2>
          <p className="text-xs text-muted">Received is not revenue until the payment pipeline finishes.</p>
        </div>
        <p className="text-xs text-muted">
          {desk ? `${kes(received)} received = ${kes(rec?.processed || 0)} processed + ${kes(rec?.unmatched || 0)} unmatched + ${kes(rec?.failed || 0)} failed` : "—"}
        </p>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-elevated" aria-hidden>
        <div className="bg-ok" style={{ width: share(rec?.processed || 0) }} />
        <div className="bg-danger" style={{ width: share(rec?.unmatched || 0) }} />
        <div className="bg-warn" style={{ width: share(rec?.failed || 0) }} />
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <Mini label="Received" value={kes(received)} hint={rec ? `${rec.nReceived} in this period` : ""} />
        <Mini label="Processed" value={kes(rec?.processed || 0)} hint={rec ? `${rec.nProcessed} posted` : ""} />
        <button type="button" className="rounded-md border border-danger/40 p-3 text-left" onClick={onUnmatched}>
          <div className="text-xs text-danger">Unmatched queue</div>
          <div className="text-lg font-semibold">{desk ? `${desk.queue.count}` : "—"}</div>
          <div className="text-xs text-muted">{kes(desk?.queue.amount || 0)} waiting</div>
        </button>
        <button type="button" className="rounded-md border border-border p-3 text-left" onClick={onFailed}>
          <div className="text-xs text-warn">Processing failed</div>
          <div className="text-lg font-semibold">{kes(rec?.failed || 0)}</div>
          <div className="text-xs text-muted">{rec ? `${rec.nFailed} to retry` : ""}</div>
        </button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h3 className="text-xs font-medium text-muted">By payment method</h3>
          <ul className="mt-2 space-y-2">
            {(desk?.methods || []).length === 0 ? <li className="text-sm text-muted">No API payments in this period.</li> : null}
            {(desk?.methods || []).map((method) => (
              <li key={`${method.provider}:${method.channel}`}>
                <div className="flex justify-between text-sm">
                  <span>{apiPaymentMethodLabel(method.provider, method.channel)}</span>
                  <span>{kes(method.amount)} · {method.n}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full bg-accent" style={{ width: share(method.amount) }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="text-xs font-medium text-muted">Oldest unmatched</h3>
          <ul className="mt-2 space-y-2">
            {(desk?.queuePreview || []).length === 0 ? <li className="text-sm text-ok">All clear. No unmatched API payments.</li> : null}
            {(desk?.queuePreview || []).map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{row.payer_name || "Unknown payer"} · {row.trans_id}</div>
                  <AccountText row={row} canMatch={canMatch} onMatch={onMatch} />
                </div>
                <div className="shrink-0 text-right">
                  <div>{kes(row.amount_kes)}</div>
                  <div className="text-xs text-muted">{formatShortDateTime(row.trans_time)}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

function Mini({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
      {hint ? <div className="text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

function AccountText({ row, canMatch, onMatch }: { row: Row; canMatch: boolean; onMatch: (row: Row) => void }) {
  const tone = apiAccountTone(row.status);
  const cls = tone === "ok" ? "text-ok" : tone === "danger" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted";
  const label = row.bill_ref || "—";
  if (tone === "danger" && canMatch) {
    return (
      <button type="button" className={`font-medium underline ${cls}`} onClick={() => onMatch(row)}>
        {label}
      </button>
    );
  }
  return <span className={`font-medium ${cls}`}>{label}</span>;
}

function PaymentLine({
  row,
  canMatch,
  canRetry,
  canPayload,
  onMatch,
  onPayload,
  onChanged,
}: {
  row: Row;
  canMatch: boolean;
  canRetry: boolean;
  canPayload: boolean;
  onMatch: (row: Row) => void;
  onPayload: (text: string) => void;
  onChanged: () => void;
}) {
  const tone = apiAccountTone(row.status);
  return (
    <tr className="border-t border-border">
      <td className="px-2 py-2 whitespace-nowrap">{formatShortDateTime(row.trans_time)}</td>
      <td className="px-2 py-2">{row.payer_name || "—"}</td>
      <td className="px-2 py-2 font-mono text-xs">{row.trans_id}</td>
      <td className="px-2 py-2"><AccountText row={row} canMatch={canMatch} onMatch={onMatch} /></td>
      <td className="px-2 py-2 whitespace-nowrap">{kes(row.amount_kes)}</td>
      <td className="px-2 py-2">{apiPaymentMethodLabel(row.provider, row.channel)}</td>
      <td className="px-2 py-2">
        <Badge tone={tone === "ok" ? "ok" : tone === "danger" ? "danger" : tone === "warn" ? "warn" : "muted"}>{apiPaymentStatusLabel(row.status)}</Badge>
        {row.failure_reason ? <div className="mt-1 max-w-48 text-xs text-warn">{row.failure_reason}</div> : null}
      </td>
      <td className="px-2 py-2">{row.customer_name || "—"}</td>
      <td className="px-2 py-2"><RowActions row={row} canRetry={canRetry} canPayload={canPayload} onPayload={onPayload} onChanged={onChanged} /></td>
    </tr>
  );
}

function RowActions({
  row,
  canRetry,
  canPayload,
  onPayload,
  onChanged,
}: {
  row: Row;
  canRetry: boolean;
  canPayload: boolean;
  onPayload: (text: string) => void;
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canRetry && row.status === "processing_failed" ? (
        <button
          type="button"
          className="text-xs text-accent hover:underline"
          onClick={() => {
            void askConfirm({
              title: "Retry payment",
              description: `Process ${row.trans_id} again through the normal payment pipeline. A duplicate receipt will not be created.`,
              confirmLabel: "Retry",
              pendingLabel: "Processing…",
              action: async () => {
                await retryApiPaymentFn({ data: { id: row.id } });
                onChanged();
              },
            });
          }}
        >
          Retry
        </button>
      ) : null}
      {canPayload ? (
        <button
          type="button"
          className="text-xs text-muted hover:underline"
          onClick={() => {
            void apiPaymentPayloadFn({ data: { id: row.id } }).then((res) => onPayload(JSON.stringify(res.payload, null, 2)));
          }}
        >
          Payload
        </button>
      ) : null}
      {apiPaymentProcessed(row.status) && row.payment_id ? (
        <Link to="/app/billing/payments/$paymentId" params={{ paymentId: row.payment_id }} className="text-xs text-accent hover:underline">
          View
        </Link>
      ) : null}
    </div>
  );
}

function MatchDialog({ row, onClose, onDone }: { row: Row | null; onClose: () => void; onDone: () => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<AccountHit[]>([]);
  const [picked, setPicked] = useState<AccountHit | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setQ("");
    setHits([]);
    setPicked(null);
    setErr("");
  }, [row?.id]);

  useEffect(() => {
    if (!row || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      searchApiPaymentAccountsFn({ data: { q } })
        .then((res) => setHits(res.rows))
        .catch((error) => setErr(error instanceof Error ? error.message : "Search failed"));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [q, row]);

  return (
    <Dialog
      open={Boolean(row)}
      onOpenChange={(open) => { if (!open) onClose(); }}
      title="Match Payment"
      className="sm:max-w-lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            disabled={!picked || !row}
            onClick={() => {
              if (!row || !picked) return;
              const account = picked.service_account || picked.account_number || picked.customer_id;
              void askConfirm({
                title: "Match & Process Payment",
                description: `Match ${kes(row.amount_kes)} to ${picked.name} (${account}). Original account ${row.bill_ref || "—"} stays on the record.`,
                confirmLabel: "Match & Process Payment",
                pendingLabel: "Processing…",
                action: async () => {
                  await matchApiPaymentFn({ data: { id: row.id, customer_id: picked.customer_id, service_id: picked.service_id || "" } });
                  onDone();
                },
              });
            }}
          >
            Match & Process Payment
          </Button>
        </div>
      }
    >
      {row ? (
        <div className="space-y-3 text-sm">
          <dl className="grid grid-cols-2 gap-2">
            <Info k="Transaction" v={row.trans_id} />
            <Info k="Date" v={formatShortDateTime(row.trans_time)} />
            <Info k="Payer" v={row.payer_name || "—"} />
            <Info k="Phone" v={row.msisdn || "—"} />
            <Info k="Original account" v={row.bill_ref || "—"} />
            <Info k="Amount" v={kes(row.amount_kes)} />
          </dl>
          <label className="block text-xs text-muted">
            Enter correct customer account
            <Input className="mt-1" value={q} placeholder="Account, name, phone, or PPPoE username" onChange={(e) => { setQ(e.target.value); setPicked(null); }} />
          </label>
          <div className="space-y-2">
            {hits.map((hit) => {
              const on = picked?.service_id === hit.service_id && picked?.customer_id === hit.customer_id;
              return (
                <button
                  key={`${hit.customer_id}:${hit.service_id || "none"}`}
                  type="button"
                  className={on ? "w-full rounded-md border border-accent bg-accent/10 p-3 text-left" : "w-full rounded-md border border-border p-3 text-left"}
                  onClick={() => setPicked(hit)}
                >
                  <div className="font-medium">{hit.service_account || hit.account_number || hit.username || hit.customer_id}</div>
                  <div>{hit.name}</div>
                  <div className="text-xs text-muted">{hit.phone} · {hit.service_name || "No service"} · {hit.package_name || "—"} · {hit.status || "—"}{hit.period_end ? ` · Expires ${formatShortDateTime(hit.period_end)}` : ""}</div>
                </button>
              );
            })}
          </div>
          {picked ? (
            <div className="rounded-md border border-border bg-bg p-3">
              <div className="text-xs text-muted">Match payment to</div>
              <div className="font-medium">{picked.name}</div>
              <div>Account: {picked.service_account || picked.account_number || "—"}</div>
              <div>Service: {picked.service_name || "—"}</div>
              <div>Amount: {kes(row.amount_kes)}</div>
              <div className="text-danger">Original account: {row.bill_ref || "—"}</div>
            </div>
          ) : null}
          {err ? <p className="text-sm text-danger">{err}</p> : null}
        </div>
      ) : null}
    </Dialog>
  );
}

function Info({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="h-10 animate-pulse rounded-md bg-elevated" />
      ))}
    </div>
  );
}

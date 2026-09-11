import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { assignPaybillPayments, getAuditLog, getIncomingPayments, getReports } from "@/lib/isp/server-more";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/reports")({ component: ReportsPage });

type Tab = "ops" | "paybill" | "audit";
type IncomingDesk = Awaited<ReturnType<typeof getIncomingPayments>>;
type IncomingRow = IncomingDesk["rows"][number];

function nairobiTime(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso.slice(0, 16).replace("T", " ");
  return new Intl.DateTimeFormat("en-KE", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Nairobi",
  }).format(new Date(t));
}

function hitTone(status: string) {
  if (status === "matched") return "ok" as const;
  if (status === "assigned") return "warn" as const;
  if (status === "unmatched") return "danger" as const;
  return "muted" as const;
}

function channelLabel(channel: string) {
  if (channel === "till") return "Till";
  if (channel === "stk") return "STK";
  return "Paybill";
}

function ReportsPage() {
  const [tab, setTab] = useState<Tab>("paybill");
  const [data, setData] = useState<Awaited<ReturnType<typeof getReports>> | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof getAuditLog>>["rows"]>([]);
  const [desk, setDesk] = useState<IncomingDesk | null>(null);
  const [deskErr, setDeskErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "unmatched" | "matched" | "assigned">("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function loadDesk() {
    try {
      const next = await getIncomingPayments();
      setDesk(next);
      setDeskErr(null);
      setSelected((ids) => ids.filter((id) => next.rows.some((r) => r.id === id && r.status === "unmatched")));
      if (!customerId && next.customers[0]) setCustomerId(next.customers[0].id);
    } catch (err) {
      setDesk(null);
      setDeskErr(err instanceof Error ? err.message : "Cannot read paybill hits");
    }
  }

  useEffect(() => {
    getReports().then(setData).catch(console.error);
    loadDesk().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visible = useMemo(() => {
    if (!desk) return [];
    const needle = q.trim().toLowerCase();
    return desk.rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!needle) return true;
      return `${r.trans_id} ${r.bill_ref} ${r.msisdn} ${r.payer_name} ${r.customer_name || ""} ${r.shortcode}`
        .toLowerCase()
        .includes(needle);
    });
  }, [desk, filter, q]);

  const unmatchedVisible = visible.filter((r) => r.status === "unmatched");
  const selectedRows = (desk?.rows || []).filter((r) => selected.includes(r.id) && r.status === "unmatched");
  const selectedKes = selectedRows.reduce((s, r) => s + r.amount_kes, 0);

  const customers = useMemo(() => {
    const list = desk?.customers || [];
    const needle = customerQ.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((c) => `${c.name} ${c.phone} ${c.account}`.toLowerCase().includes(needle));
  }, [desk, customerQ]);

  const invoices = (desk?.invoices || []).filter((i) => !customerId || i.customer_id === customerId);

  function toggle(id: string, on: boolean) {
    setSelected((ids) => (on ? [...new Set([...ids, id])] : ids.filter((x) => x !== id)));
  }

  async function assign() {
    if (!selectedRows.length || !customerId) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await assignPaybillPayments({
        data: {
          ids: selectedRows.map((r) => r.id),
          customer_id: customerId,
          invoice_id: invoiceId || undefined,
        },
      });
      const who = desk?.customers.find((c) => c.id === customerId);
      setNote(`Assigned ${res.assigned} payment${res.assigned === 1 ? "" : "s"} to ${who?.name || "the account"}.`);
      setSelected([]);
      setInvoiceId("");
      await loadDesk();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Assign failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Insights</h1>
        <p className="text-sm text-muted">
          Collections, invoice aging, and every paybill or till hit — including payments with no matching account.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={tab === "ops" ? "default" : "secondary"} onClick={() => setTab("ops")}>
          Operations
        </Button>
        <Button
          size="sm"
          variant={tab === "paybill" ? "default" : "secondary"}
          onClick={() => {
            setTab("paybill");
            loadDesk().catch(console.error);
          }}
        >
          Paybill / Till
          {desk && desk.unmatched > 0 ? (
            <span className="ml-1 rounded-full bg-danger/20 px-2 py-0.5 text-xs text-danger">{desk.unmatched}</span>
          ) : null}
        </Button>
        <Button
          size="sm"
          variant={tab === "audit" ? "default" : "secondary"}
          onClick={async () => {
            setTab("audit");
            try {
              setAudit((await getAuditLog()).rows);
            } catch {
              setAudit([]);
            }
          }}
        >
          Audit
        </Button>
      </div>

      {tab === "ops" && data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Invoice aging</h2>
            <ul className="text-sm">
              {Object.entries(data.aging).map(([k, v]: [string, { count: number; amount: number }]) => (
                <li key={k} className="flex justify-between py-1">
                  <span className="text-muted">{k}</span>
                  <span className="font-mono">
                    {v.count} · {kes(v.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Confirmed collections</h2>
            <ul className="text-sm">
              {data.daily.length === 0 ? <li className="text-muted">No payments yet.</li> : null}
              {data.daily.map((d) => (
                <li key={d.day} className="flex justify-between py-1">
                  <span className="text-muted">{d.day}</span>
                  <span className="font-mono">
                    {d.n} · {kes(d.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Services</h2>
            <ul className="text-sm">
              {data.methods.map((m) => (
                <li key={m.access_method} className="flex justify-between py-1">
                  <span className="text-muted">{m.access_method}</span>
                  <span className="font-mono">
                    {m.active} active / {m.n}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Tickets & routers</h2>
            <ul className="text-sm">
              {data.tickets.map((t) => (
                <li key={t.status} className="flex justify-between py-1">
                  <span className="text-muted">ticket {t.status}</span>
                  <span className="font-mono">{t.n}</span>
                </li>
              ))}
              {data.routers.map((r) => (
                <li key={r.wg_status} className="flex justify-between py-1">
                  <span className="text-muted">router {r.wg_status}</span>
                  <span className="font-mono">{r.n}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
            <h2 className="mb-3 font-medium">Grace Period</h2>
            <ul className="text-sm">
              <li className="flex justify-between py-1">
                <span className="text-muted">Currently on grace</span>
                <span className="font-mono">{data.grace?.counts.active ?? 0}</span>
              </li>
              <li className="flex justify-between py-1">
                <span className="text-muted">Days granted (active)</span>
                <span className="font-mono">{data.grace?.counts.days_granted ?? 0}</span>
              </li>
              <li className="flex justify-between py-1">
                <span className="text-muted">Expired</span>
                <span className="font-mono">{data.grace?.counts.expired ?? 0}</span>
              </li>
              <li className="flex justify-between py-1">
                <span className="text-muted">Suspended after grace</span>
                <span className="font-mono">{data.grace?.suspendedAfter ?? 0}</span>
              </li>
            </ul>
            {(data.grace?.byStaff || []).length > 0 ? (
              <div className="mt-3">
                <p className="text-xs text-muted">Granted by staff</p>
                <ul className="mt-1 text-sm">
                  {data.grace.byStaff.map((s) => (
                    <li key={s.label} className="flex justify-between py-1">
                      <span className="text-muted">{s.label}</span>
                      <span className="font-mono">
                        {s.n} · {s.days}d
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {(data.grace?.current || []).filter((g) => g.status === "active").length > 0 ? (
              <ul className="mt-3 divide-y divide-border text-sm">
                {data.grace.current
                  .filter((g) => g.status === "active")
                  .slice(0, 8)
                  .map((g) => (
                    <li key={g.id} className="flex justify-between gap-3 py-2">
                      <span>
                        {g.customer_name} · {g.package_name}
                        <span className="mt-0.5 block text-xs text-muted">
                          Renewal {g.period_end ? g.period_end.slice(0, 10) : "—"} · access until {g.expires_at.slice(0, 10)}
                        </span>
                      </span>
                      <span className="font-mono text-xs">{g.days_granted}d</span>
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-muted">No customers currently on a granted grace period.</p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "paybill" ? (
        <PaybillDesk
          desk={desk}
          deskErr={deskErr}
          filter={filter}
          setFilter={setFilter}
          q={q}
          setQ={setQ}
          visible={visible}
          unmatchedVisible={unmatchedVisible}
          selected={selected}
          selectedRows={selectedRows}
          selectedKes={selectedKes}
          customers={customers}
          invoices={invoices}
          customerId={customerId}
          setCustomerId={(id) => {
            setCustomerId(id);
            setInvoiceId("");
          }}
          invoiceId={invoiceId}
          setInvoiceId={setInvoiceId}
          customerQ={customerQ}
          setCustomerQ={setCustomerQ}
          busy={busy}
          note={note}
          toggle={toggle}
          setSelected={setSelected}
          onAssign={() => void assign()}
        />
      ) : null}

      {tab === "audit" ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {audit.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No audit rows, or you cannot read audit.</li> : null}
          {audit.map((a) => (
            <li key={a.id} className="bg-surface px-4 py-3 text-sm">
              <div className="font-medium">{a.action}</div>
              <div className="text-xs text-muted">
                {a.entity_type} {a.entity_id} · {a.user_id.slice(-8)} · {a.created_at.slice(0, 19).replace("T", " ")}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function PaybillDesk({
  desk,
  deskErr,
  filter,
  setFilter,
  q,
  setQ,
  visible,
  unmatchedVisible,
  selected,
  selectedRows,
  selectedKes,
  customers,
  invoices,
  customerId,
  setCustomerId,
  invoiceId,
  setInvoiceId,
  customerQ,
  setCustomerQ,
  busy,
  note,
  toggle,
  setSelected,
  onAssign,
}: {
  desk: IncomingDesk | null;
  deskErr: string | null;
  filter: "all" | "unmatched" | "matched" | "assigned";
  setFilter: (v: "all" | "unmatched" | "matched" | "assigned") => void;
  q: string;
  setQ: (v: string) => void;
  visible: IncomingRow[];
  unmatchedVisible: IncomingRow[];
  selected: string[];
  selectedRows: IncomingRow[];
  selectedKes: number;
  customers: IncomingDesk["customers"];
  invoices: IncomingDesk["invoices"];
  customerId: string;
  setCustomerId: (id: string) => void;
  invoiceId: string;
  setInvoiceId: (id: string) => void;
  customerQ: string;
  setCustomerQ: (v: string) => void;
  busy: boolean;
  note: string | null;
  toggle: (id: string, on: boolean) => void;
  setSelected: (ids: string[]) => void;
  onAssign: () => void;
}) {
  if (deskErr) {
    return <p className="text-sm text-danger">{deskErr === "Forbidden" ? "You cannot read payments." : deskErr}</p>;
  }
  if (!desk) {
    return <p className="text-sm text-muted">Loading paybill and till hits…</p>;
  }

  const matched = desk.rows.filter((r) => r.status === "matched").length;
  const assigned = desk.rows.filter((r) => r.status === "assigned").length;
  const allUnmatchedChecked = unmatchedVisible.length > 0 && unmatchedVisible.every((r) => selected.includes(r.id));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Hits" value={String(desk.rows.length)} sub="Paybill, till, and STK" />
        <Stat label="Unmatched" value={String(desk.unmatched)} sub="No matching account" tone={desk.unmatched ? "danger" : undefined} />
        <Stat label="Posted" value={String(matched + assigned)} sub={`${matched} auto · ${assigned} assigned`} />
        <Stat label="Amount" value={kes(desk.totalKes)} sub="All receipts on this list" />
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <Input
          placeholder="Search receipt, account, phone, payer"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", `All (${desk.rows.length})`],
              ["unmatched", `Unmatched (${desk.unmatched})`],
              ["matched", "Matched"],
              ["assigned", "Assigned"],
            ] as const
          ).map(([key, label]) => (
            <Button key={key} size="sm" variant={filter === key ? "default" : "secondary"} onClick={() => setFilter(key)}>
              {label}
            </Button>
          ))}
        </div>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4 md:p-5">
        <div>
          <h2 className="font-medium">Assign unmatched</h2>
          <p className="text-sm text-muted">
            Tick the payments that have no matching account, pick the customer they belong to, then assign. Credits the
            ledger and open invoices (FIFO unless you pin an invoice).
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Find customer">
            <Input
              placeholder="Name, phone, or account"
              value={customerQ}
              onChange={(e) => setCustomerQ(e.target.value)}
            />
          </Field>
          <Field label="Customer account">
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
              <option value="">Select account</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} · {c.account}
                  {c.phone ? ` · ${c.phone}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Invoice (optional)">
            <Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} disabled={!customerId}>
              <option value="">Any open invoice (FIFO)</option>
              {invoices.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {kes(i.remaining)} remaining
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button className="w-full" disabled={busy || !selectedRows.length || !customerId} onClick={onAssign}>
              {busy
                ? "Assigning…"
                : selectedRows.length
                  ? `Assign ${selectedRows.length} · ${kes(selectedKes)}`
                  : "Select unmatched rows"}
            </Button>
          </div>
        </div>
        {note ? <p className="text-sm text-muted">{note}</p> : null}
      </section>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface px-4 py-8 text-center text-sm text-muted">
          {desk.rows.length === 0
            ? "No paybill or till hits yet. When money lands on the shortcode — even with a wrong account number — it shows up here."
            : "No rows match this filter."}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl bg-surface shadow-card">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3">
                  <label className="inline-flex h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-accent"
                      checked={allUnmatchedChecked}
                      onChange={(e) => {
                        if (e.target.checked) setSelected(unmatchedVisible.map((r) => r.id));
                        else setSelected(selected.filter((id) => !unmatchedVisible.some((r) => r.id === id)));
                      }}
                    />
                    <span className="sr-only">Select unmatched</span>
                  </label>
                </th>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Receipt</th>
                <th className="px-4 py-3 font-medium">Account / bill ref</th>
                <th className="px-4 py-3 font-medium">Payer</th>
                <th className="px-4 py-3 font-medium">Amount</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Customer</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.map((r) => (
                <tr key={r.id} className={r.status === "unmatched" ? "bg-danger/5" : undefined}>
                  <td className="px-4 py-2">
                    {r.status === "unmatched" ? (
                      <label className="inline-flex h-11 items-center">
                        <input
                          type="checkbox"
                          className="size-4 accent-accent"
                          checked={selected.includes(r.id)}
                          onChange={(e) => toggle(r.id, e.target.checked)}
                        />
                      </label>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-muted">{nairobiTime(r.trans_time)}</td>
                  <td className="px-4 py-3">
                    {channelLabel(r.channel)}
                    {r.shortcode ? <div className="text-xs text-subtle">{r.shortcode}</div> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{r.trans_id}</td>
                  <td className="px-4 py-3">
                    <div className="font-mono text-xs">{r.bill_ref || "—"}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div>{r.payer_name || "—"}</div>
                    <div className="text-xs text-muted">{r.msisdn}</div>
                  </td>
                  <td className="px-4 py-3 font-mono tabular-nums">{kes(r.amount_kes)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={hitTone(r.status)}>{r.status}</Badge>
                    {r.match_reason ? <div className="mt-1 max-w-40 truncate text-xs text-subtle">{r.match_reason}</div> : null}
                  </td>
                  <td className="px-4 py-3">{r.customer_name || <span className="text-muted">Unassigned</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${tone === "danger" ? "text-danger" : ""}`}>{value}</div>
      <div className="mt-1 text-xs text-subtle">{sub}</div>
    </div>
  );
}

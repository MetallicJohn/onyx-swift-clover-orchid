import { createFileRoute, Link } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { DateYmdInput } from "@/components/isp/date-ymd-input";
import { accessMethodLabel, formatDateTime } from "@/lib/isp/display";
import {
  listArchivedServicesFn,
  listRecycleBinFn,
  purgeCustomerFn,
  purgeServiceFn,
  restoreCustomerFn,
  restoreServiceFn,
} from "@/lib/isp/server-recycle";
import type { RecycleRow } from "@/lib/isp/recycle-bin";

export const Route = createFileRoute("/app/recycle-bin")({ component: RecycleBinPage });

type Kind = "all" | "customer" | "service";
type RestoreCustomerMode = "customer_only" | "selected" | "all";

type BinData = Awaited<ReturnType<typeof listRecycleBinFn>>;
type ArchivedService = Awaited<ReturnType<typeof listArchivedServicesFn>>[number];

function kindLabel(kind: RecycleRow["kind"]) {
  return kind === "customer" ? "Customer" : "Service";
}

function RecycleBinPage() {
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [access, setAccess] = useState("");
  const [status, setStatus] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<BinData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [restoreCus, setRestoreCus] = useState<RecycleRow | null>(null);
  const [restoreSvc, setRestoreSvc] = useState<RecycleRow | null>(null);
  const [purge, setPurge] = useState<RecycleRow | null>(null);
  const [reason, setReason] = useState("");
  const [phrase, setPhrase] = useState("");
  const [mode, setMode] = useState<RestoreCustomerMode>("customer_only");
  const [picked, setPicked] = useState<string[]>([]);
  const [archived, setArchived] = useState<ArchivedService[]>([]);
  const [assignCustomer, setAssignCustomer] = useState("");
  const [assignPackage, setAssignPackage] = useState("");
  const [loading, setLoading] = useState(true);

  type Filters = {
    kind?: Kind;
    q?: string;
    access?: string;
    status?: string;
    actor?: string;
    from?: string;
    to?: string;
  };

  async function load(overrides: Filters = {}) {
    const res = await listRecycleBinFn({
      data: {
        kind: overrides.kind ?? kind,
        q: overrides.q ?? q,
        access_method: overrides.access ?? access,
        original_status: overrides.status ?? status,
        deleted_by: overrides.actor ?? actor,
        from: overrides.from ?? from,
        to: overrides.to ?? to,
      },
    });
    setData(res);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load Recycle Bin"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows = data?.rows ?? [];
  const counts = data?.counts ?? { customers: 0, services: 0 };
  const confirmPhrase = data?.confirmPhrase || "PERMANENTLY DELETE";

  const actors = useMemo(() => {
    const names = new Set<string>();
    for (const row of data?.rows ?? []) {
      const label = row.deleted_by_label || row.deleted_by;
      if (label) names.add(label);
    }
    return [...names].sort();
  }, [data?.rows]);

  function resetDialogs() {
    setRestoreCus(null);
    setRestoreSvc(null);
    setPurge(null);
    setReason("");
    setPhrase("");
    setMode("customer_only");
    setPicked([]);
    setArchived([]);
    setAssignCustomer("");
    setAssignPackage("");
  }

  async function openRestoreCustomer(row: RecycleRow) {
    setError(null);
    setRestoreCus(row);
    setMode("customer_only");
    setReason("");
    const list = await listArchivedServicesFn({ data: { customer_id: row.id } });
    setArchived(list);
    setPicked([]);
  }

  async function submitRestoreCustomer(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreCus || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await restoreCustomerFn({
        data: {
          id: restoreCus.id,
          reason,
          restore_all: mode === "all",
          service_ids: mode === "selected" ? picked : [],
        },
      });
      setNote(
        `${out.name} restored${out.services_restored ? ` with ${out.services_restored} service${out.services_restored === 1 ? "" : "s"}` : ""}. No invoice or customer message was sent.`,
      );
      resetDialogs();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore customer");
    } finally {
      setBusy(false);
    }
  }

  async function submitRestoreService(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreSvc || busy) return;
    setBusy(true);
    setError(null);
    try {
      const out = await restoreServiceFn({
        data: {
          id: restoreSvc.id,
          reason,
          customer_id: restoreSvc.customer_live ? undefined : assignCustomer || undefined,
          package_id: assignPackage || undefined,
        },
      });
      setNote(
        `Service restored as ${out.status}${out.suspend_reason ? ` (${out.suspend_reason})` : ""}. Network access follows current policy. No invoice or customer message was sent.`,
      );
      resetDialogs();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not restore service");
    } finally {
      setBusy(false);
    }
  }

  async function submitPurge(e: React.FormEvent) {
    e.preventDefault();
    if (!purge || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (purge.kind === "customer") {
        await purgeCustomerFn({ data: { id: purge.id, reason, confirm_phrase: phrase } });
      } else {
        await purgeServiceFn({ data: { id: purge.id, reason, confirm_phrase: phrase } });
      }
      setNote(`${purge.name} permanently deleted. Financial and audit history was kept.`);
      resetDialogs();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not permanently delete");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Recycle Bin</h1>
          <p className="text-sm text-muted">
            Deleted customers and services stay here, hidden from live searches, until an authorized staff member
            restores them or permanently deletes them. Restore and delete never bill or message the customer.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-muted">
          <Link to="/app/customers" className="inline-flex h-11 items-center text-sm text-accent hover:underline">
            Customers
          </Link>
          <Link to="/app/services" className="inline-flex h-11 items-center text-sm text-accent hover:underline">
            Services
          </Link>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Recycle Bin records"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {(
          [
            ["all", `All (${counts.customers + counts.services})`],
            ["customer", `Deleted customers (${counts.customers})`],
            ["service", `Deleted services (${counts.services})`],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={kind === id}
            className={
              kind === id
                ? "h-11 shrink-0 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg"
                : "h-11 shrink-0 rounded-lg px-4 text-sm font-medium text-muted hover:bg-elevated hover:text-fg"
            }
            onClick={() => {
              setKind(id);
              void load({ kind: id }).catch((err) => setError(err instanceof Error ? err.message : "Could not load"));
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load().catch((err) => setError(err instanceof Error ? err.message : "Could not search"));
        }}
      >
        <label className="relative sm:col-span-2 lg:col-span-3">
          <span className="sr-only">Search Recycle Bin</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Name, account, phone, PPPoE, static IP, hotspot, package, staff…"
            className="pl-10"
            autoComplete="off"
          />
        </label>
        <Select aria-label="Service type" value={access} onChange={(e) => setAccess(e.target.value)}>
          <option value="">Any service type</option>
          <option value="pppoe">PPPoE</option>
          <option value="static">Static IP</option>
          <option value="hotspot">Hotspot</option>
        </Select>
        <Select aria-label="Original status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Any original status</option>
          <option value="active">Active</option>
          <option value="grace">Grace</option>
          <option value="suspended">Suspended</option>
          <option value="pending">Pending</option>
          <option value="terminated">Terminated</option>
        </Select>
        <Select aria-label="Deleted by" value={actor} onChange={(e) => setActor(e.target.value)}>
          <option value="">Anyone</option>
          {actors.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
        <Field label="Deleted from">
          <DateYmdInput value={from} onChange={setFrom} aria-label="Deleted from" />
        </Field>
        <Field label="Deleted to">
          <DateYmdInput value={to} onChange={setTo} aria-label="Deleted to" />
        </Field>
        <div className="flex items-end gap-2">
          <Button type="submit">Search bin</Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              setAccess("");
              setStatus("");
              setActor("");
              setFrom("");
              setTo("");
              void load({ q: "", access: "", status: "", actor: "", from: "", to: "" }).catch(() => undefined);
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      {note ? <p className="text-sm text-accent">{note}</p> : null}
      {error && !restoreCus && !restoreSvc && !purge ? <p className="text-sm text-danger">{error}</p> : null}

      {loading && !data ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <p className="text-sm text-muted">Loading Recycle Bin…</p>
        </div>
      ) : !rows.length ? (
        <div className="rounded-xl border border-border bg-surface p-6">
          <p className="font-medium">Recycle Bin is empty</p>
          <p className="mt-1 text-sm text-muted">
            When a customer or service is deleted it moves here and disappears from live search, billing, and
            communications. Restore brings the original record back. Permanent delete is irreversible.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
          {rows.map((row) => (
            <li key={`${row.kind}-${row.id}`} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={row.kind === "customer" ? "accent" : "muted"}>{kindLabel(row.kind)}</Badge>
                  <span className="font-medium">{row.name}</span>
                  <Badge tone={statusTone(row.original_status)}>{row.original_status || "unknown"}</Badge>
                </div>
                <p className="text-sm text-muted">
                  {row.account_number ? `${row.account_number} · ` : ""}
                  {row.phone || "No phone"}
                  {row.kind === "service"
                    ? ` · ${accessMethodLabel(row.access_method)}${row.package_name ? ` · ${row.package_name}` : ""}${row.username ? ` · ${row.username}` : ""}${row.static_ip ? ` · ${row.static_ip}` : ""}`
                    : row.associated_services
                      ? ` · ${row.associated_services} archived service${row.associated_services === 1 ? "" : "s"}`
                      : ""}
                </p>
                <p className="text-xs text-subtle">
                  Deleted {formatDateTime(row.deleted_at)}
                  {row.deleted_by_label ? ` · by ${row.deleted_by_label}` : ""}
                  {row.deletion_reason ? ` · ${row.deletion_reason}` : ""}
                  {row.kind === "service" ? ` · customer ${row.customer_name}${row.customer_live ? "" : " (also in bin)"}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {row.kind === "customer" && data?.canRestoreCustomer ? (
                  <Button size="sm" onClick={() => void openRestoreCustomer(row)}>
                    Restore
                  </Button>
                ) : null}
                {row.kind === "service" && data?.canRestoreService ? (
                  <Button
                    size="sm"
                    onClick={() => {
                      setRestoreSvc(row);
                      setReason("");
                      setAssignCustomer("");
                      setAssignPackage("");
                      setError(null);
                    }}
                  >
                    Restore
                  </Button>
                ) : null}
                {data?.canPurge ? (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      setPurge(row);
                      setReason("");
                      setPhrase("");
                      setError(null);
                    }}
                  >
                    Delete forever
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog
        open={Boolean(restoreCus)}
        onOpenChange={(next) => {
          if (!next) resetDialogs();
        }}
        title="Restore customer"
        description="Brings the original customer back. Services stay in the Recycle Bin unless you choose them. No invoice or message is sent."
        className="sm:max-w-xl"
      >
        {restoreCus ? (
          <form className="grid gap-3" onSubmit={submitRestoreCustomer}>
            <p className="text-sm">
              {restoreCus.name}
              {restoreCus.account_number ? ` · ${restoreCus.account_number}` : ""} had {archived.length} associated
              archived service{archived.length === 1 ? "" : "s"}.
            </p>
            {archived.length ? (
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {archived.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 p-3">
                    {mode === "selected" ? (
                      <input
                        type="checkbox"
                        className="mt-1 size-4"
                        checked={picked.includes(s.id)}
                        onChange={(e) =>
                          setPicked((cur) => (e.target.checked ? [...cur, s.id] : cur.filter((id) => id !== s.id)))
                        }
                        aria-label={`Restore ${s.package_name}`}
                      />
                    ) : null}
                    <div>
                      <div className="font-medium">
                        {s.package_name} · {accessMethodLabel(s.access_method)}
                      </div>
                      <div className="text-xs text-muted">
                        {s.username || s.static_ip || "—"} · was {s.original_status || s.status}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No archived services on this customer.</p>
            )}
            <fieldset className="grid gap-2 text-sm">
              <legend className="font-medium">Restore</legend>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  className="mt-1 size-4"
                  checked={mode === "customer_only"}
                  onChange={() => setMode("customer_only")}
                />
                Customer only (services stay in the Recycle Bin)
              </label>
              {archived.length ? (
                <>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1 size-4"
                      checked={mode === "selected"}
                      onChange={() => setMode("selected")}
                    />
                    Customer and selected services
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="radio"
                      className="mt-1 size-4"
                      checked={mode === "all"}
                      onChange={() => setMode("all")}
                    />
                    Customer and all associated services
                  </label>
                </>
              ) : null}
            </fieldset>
            <Field label="Reason">
              <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this customer is being restored" />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !reason.trim() || (mode === "selected" && !picked.length)}>
                Restore customer
              </Button>
              <Button type="button" variant="ghost" onClick={resetDialogs}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(restoreSvc)}
        onOpenChange={(next) => {
          if (!next) resetDialogs();
        }}
        title="Restore service"
        description="Reuses the original service record. Access follows expiry, suspension, grace, and payment rules. No invoice or message is sent."
        className="sm:max-w-xl"
      >
        {restoreSvc ? (
          <form className="grid gap-3" onSubmit={submitRestoreService}>
            <p className="text-sm">
              {restoreSvc.name}
              {restoreSvc.username ? ` · ${restoreSvc.username}` : ""}
              {restoreSvc.static_ip ? ` · ${restoreSvc.static_ip}` : ""}
            </p>
            {restoreSvc.customer_live ? (
              <p className="text-sm text-muted">Will reconnect to {restoreSvc.customer_name}.</p>
            ) : (
              <Field label="Assign to a live customer">
                <Select required value={assignCustomer} onChange={(e) => setAssignCustomer(e.target.value)}>
                  <option value="">Select customer</option>
                  {(data?.customers ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.account_number ? ` · ${c.account_number}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <Field label="Replacement package (optional)">
              <Select value={assignPackage} onChange={(e) => setAssignPackage(e.target.value)}>
                <option value="">Keep original package</option>
                {(data?.packages ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Reason">
              <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this service is being restored" />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !reason.trim() || (!restoreSvc.customer_live && !assignCustomer)}>
                Restore service
              </Button>
              <Button type="button" variant="ghost" onClick={resetDialogs}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(purge)}
        onOpenChange={(next) => {
          if (!next) resetDialogs();
        }}
        title="Permanently delete"
        description="This cannot be undone. Invoices, payments, ledger, and audit history stay. Network assignments are released."
        className="sm:max-w-xl"
      >
        {purge ? (
          <form className="grid gap-3" onSubmit={submitPurge}>
            <p className="text-sm">
              You are permanently deleting {purge.name}.
              {purge.kind === "customer" && purge.associated_services
                ? ` ${purge.associated_services} archived service${purge.associated_services === 1 ? "" : "s"} will be removed with this customer.`
                : ""}{" "}
              Shared packages, routers, and other customers are not deleted.
            </p>
            <Field label={`Type ${confirmPhrase}`}>
              <Input
                required
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={confirmPhrase}
                autoComplete="off"
              />
            </Field>
            <Field label="Reason">
              <Input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this record is being destroyed" />
            </Field>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || phrase !== confirmPhrase || !reason.trim()}>
                Permanently delete
              </Button>
              <Button type="button" variant="ghost" onClick={resetDialogs}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { accessMethodLabel, formatDate } from "@/lib/isp/display";
import {
  canSubmitReassign,
  customerStatusLabel,
  displayReassignPhone,
  reassignSearchReady,
  type ReassignCustomerHit,
  type ReassignServiceInfo,
} from "@/lib/isp/reassign-format";
import { searchReassignCustomersFn } from "@/lib/isp/server-lifecycle";

export function ReassignServiceDialog({
  open,
  onOpenChange,
  service,
  busy = false,
  error = null,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: ReassignServiceInfo | null;
  busy?: boolean;
  error?: string | null;
  onSubmit: (customerId: string, reason: string) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ReassignCustomerHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReassignCustomerHit | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const submitLock = useRef(false);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setSearching(false);
    setSearchError(null);
    setSelected(null);
    setConfirmed(false);
    setReason("");
    submitLock.current = false;
  }, [open, service?.id]);

  useEffect(() => {
    return () => {
      if (searchRef.current) clearTimeout(searchRef.current);
    };
  }, []);

  function runSearch(value: string) {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!service || !reassignSearchReady(value)) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    searchRef.current = setTimeout(() => {
      const id = ++requestRef.current;
      searchReassignCustomersFn({ data: { q: value, excludeCustomerId: service.customer_id } })
        .then((res) => {
          if (id !== requestRef.current) return;
          setHits(res.customers);
        })
        .catch((err) => {
          if (id !== requestRef.current) return;
          setHits([]);
          setSearchError(err instanceof Error ? err.message : "Could not search customers");
        })
        .finally(() => {
          if (id === requestRef.current) setSearching(false);
        });
    }, 250);
  }

  function choose(hit: ReassignCustomerHit) {
    setSelected(hit);
    setConfirmed(false);
  }

  function clearSelected() {
    setSelected(null);
    setConfirmed(false);
  }

  const ready = Boolean(service) && canSubmitReassign({
    destinationId: selected?.id,
    currentCustomerId: service?.customer_id || "",
    confirmed,
    busy: busy || submitLock.current,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="Reassign service"
      description="Search for the destination customer, then confirm. Package, credentials, expiry, and billing history stay on this line."
      className="sm:max-w-xl"
    >
      {service ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || !selected || submitLock.current) return;
            submitLock.current = true;
            Promise.resolve(onSubmit(selected.id, reason.trim()))
              .catch(() => {
                /* parent surfaces the error */
              })
              .finally(() => {
                submitLock.current = false;
              });
          }}
        >
          <section className="rounded-xl border border-border bg-bg px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted">Service being reassigned</p>
            <dl className="mt-2 grid gap-1 text-sm">
              <Row label="Service" value={service.package_name} />
              <Row label="Account" value={service.account_number || "—"} />
              <Row label="Access" value={accessMethodLabel(service.access_method)} />
              <Row label="Status" value={service.status} />
              <Row label="Expiry" value={service.period_end ? formatDate(service.period_end) : "—"} />
            </dl>
          </section>

          <section className="rounded-xl border border-border bg-bg px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted">Current customer</p>
            <p className="mt-1 font-medium">{service.customer_name}</p>
            <p className="mt-0.5 text-xs text-muted">
              {service.customer_account_number ? `Account ${service.customer_account_number}` : "No customer account"}
              {service.customer_phone ? ` · ${displayReassignPhone(service.customer_phone)}` : ""}
            </p>
          </section>

          {selected ? (
            <section className="rounded-xl border border-accent bg-accent/10 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium tracking-wide text-muted">Destination customer</p>
                  <dl className="mt-2 grid gap-1 text-sm">
                    <Row label="Name" value={selected.name} />
                    <Row label="Account Number" value={selected.account_number || "—"} />
                    <Row label="Phone" value={selected.phone ? displayReassignPhone(selected.phone) : "—"} />
                  </dl>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={clearSelected} disabled={busy}>
                  Change customer
                </Button>
              </div>
            </section>
          ) : (
            <div className="grid gap-2">
              <Field label="Search destination customer">
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    runSearch(e.target.value);
                  }}
                  placeholder="Name, phone, account, or email"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              {!reassignSearchReady(query) ? (
                <p className="text-xs text-muted">Enter at least 2 characters to search this network.</p>
              ) : searching ? (
                <p className="text-xs text-muted">Searching…</p>
              ) : searchError ? (
                <p className="text-sm text-danger">{searchError}</p>
              ) : hits.length === 0 ? (
                <p className="text-sm text-muted">
                  No matching customers found. Try a different name, phone number, or account number.
                </p>
              ) : (
                <ul className="max-h-56 overflow-y-auto rounded-xl border border-border" role="listbox" aria-label="Matching customers">
                  {hits.map((hit) => (
                    <li key={hit.id} className="border-t border-border first:border-t-0">
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 text-left hover:bg-elevated">
                        <input
                          type="radio"
                          name="reassign-destination"
                          className="mt-1 size-4 shrink-0"
                          checked={false}
                          onChange={() => choose(hit)}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{hit.name}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            Customer No: {hit.account_number || "—"}
                          </span>
                          <span className="block text-xs text-muted">
                            Phone: {hit.phone ? displayReassignPhone(hit.phone) : "—"}
                          </span>
                          <span className="block text-xs text-muted">
                            Active services: {hit.active_services}
                            {hit.status && hit.status !== "active" ? ` · ${customerStatusLabel(hit.status)}` : ""}
                            {hit.address ? ` · ${hit.address}` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {selected ? (
            <div className="grid gap-3">
              <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3 text-sm">
                Reassigning this service will move it to the selected customer. The current customer record will not be
                deleted. Invoices and payments stay on the current customer. No SMS or invoice is sent.
              </div>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                <span>I confirm this reassignment. Billing and expiry will not change.</span>
              </label>
              <Field label="Reason (optional)">
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why this line is moving"
                />
              </Field>
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" className="w-full sm:w-auto" disabled={!ready}>
              {busy ? "Reassigning…" : "Reassign service"}
            </Button>
          </div>
        </form>
      ) : null}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/input";
import { accessMethodLabel, formatDateTime } from "@/lib/isp/display";
import {
  acsSearchReady,
  canSubmitAcsAssignment,
  displayAcsPhone,
  type AcsAssignmentHit,
  type AcsDeviceRow,
} from "@/lib/isp/acs-device-format";
import { searchAcsAssignmentFn } from "@/lib/isp/server-acs-devices";

export function AcsAssignDialog({
  open,
  onOpenChange,
  device,
  busy = false,
  error = null,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device: AcsDeviceRow | null;
  busy?: boolean;
  error?: string | null;
  onSubmit: (input: { customer_id: string; service_id: string; confirm_move: boolean; reason: string }) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AcsAssignmentHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AcsAssignmentHit | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);
  const submitLock = useRef(false);

  const assigned = Boolean(device?.service_id);
  const needsMove = assigned && selected ? selected.service_id !== device?.service_id : assigned;

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setHits([]);
    setSearching(false);
    setSearchError(null);
    setSelected(null);
    setConfirmed(false);
    setMoveConfirmed(false);
    setReason("");
    submitLock.current = false;
  }, [open, device?.id]);

  function runSearch(value: string) {
    if (searchRef.current) clearTimeout(searchRef.current);
    if (!acsSearchReady(value)) {
      setHits([]);
      setSearching(false);
      setSearchError(null);
      return;
    }
    setSearching(true);
    setSearchError(null);
    searchRef.current = setTimeout(() => {
      const id = ++requestRef.current;
      searchAcsAssignmentFn({ data: { q: value } })
        .then((res) => {
          if (id !== requestRef.current) return;
          setHits(res.hits);
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

  const ready = Boolean(device) && canSubmitAcsAssignment({
    deviceId: device?.id,
    serviceId: selected?.service_id,
    customerId: selected?.customer_id,
    confirmed,
    busy: busy || submitLock.current,
    needsMoveConfirm: needsMove,
    moveConfirmed,
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title={assigned ? "Reassign device" : "Assign device"}
      description="Search the destination customer, then pick the exact service. One device maps to one service. WAN PPPoE, SSID, and Wi-Fi password from that service are written on the next Inform."
      className="sm:max-w-xl"
    >
      {device ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!ready || !selected || submitLock.current) return;
            submitLock.current = true;
            Promise.resolve(
              onSubmit({
                customer_id: selected.customer_id,
                service_id: selected.service_id,
                confirm_move: needsMove,
                reason: reason.trim(),
              }),
            )
              .catch(() => {
                /* parent surfaces the error */
              })
              .finally(() => {
                submitLock.current = false;
              });
          }}
        >
          <section className="rounded-xl border border-border bg-bg px-4 py-3">
            <p className="text-xs font-medium tracking-wide text-muted">Device</p>
            <dl className="mt-2 grid gap-1 text-sm">
              <Row label="Manufacturer" value={device.manufacturer || "—"} />
              <Row label="Model" value={device.model || device.product_class || "—"} />
              <Row label="Serial" value={device.serial} />
              <Row label="Device ID" value={device.acs_device_id || "—"} />
              <Row label="MAC" value={device.mac_address || "—"} />
              <Row label="Status" value={device.status === "online" ? "Online" : device.status === "offline" ? "Offline" : "Not confirmed"} />
              <Row label="Last inform" value={device.last_inform ? formatDateTime(device.last_inform) : "—"} />
            </dl>
          </section>

          {assigned ? (
            <section className="rounded-xl border border-border bg-bg px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-muted">Current assignment</p>
              <dl className="mt-2 grid gap-1 text-sm">
                <Row label="Customer" value={device.customer_name || "—"} />
                <Row label="Service" value={device.service_account || "—"} />
                <Row label="Assigned" value={device.assigned_at ? formatDateTime(device.assigned_at) : "—"} />
                <Row label="Assigned by" value={device.assigned_by_label || "—"} />
                <Row label="Service status" value={device.service_status || "—"} />
              </dl>
            </section>
          ) : null}

          {selected ? (
            <section className="rounded-xl border border-accent bg-accent/10 px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium tracking-wide text-muted">Destination</p>
                  <dl className="mt-2 grid gap-1 text-sm">
                    <Row label="Customer name" value={selected.customer_name} />
                    <Row label="Customer account" value={selected.customer_account || "—"} />
                    <Row label="Phone" value={selected.phone ? displayAcsPhone(selected.phone) : "—"} />
                    <Row label="Service account" value={selected.service_account || "—"} />
                    <Row label="Access type" value={accessMethodLabel(selected.access_method)} />
                    <Row label="Package" value={selected.package_name} />
                    <Row label="Service status" value={selected.service_status} />
                  </dl>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => { setSelected(null); setConfirmed(false); setMoveConfirmed(false); }} disabled={busy}>
                  Change
                </Button>
              </div>
            </section>
          ) : (
            <div className="grid gap-2">
              <Field label="Search customer or service">
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    runSearch(e.target.value);
                  }}
                  placeholder="Name, phone, account, username, or IP"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              {!acsSearchReady(query) ? (
                <p className="text-xs text-muted">Enter at least 2 characters. Results list the exact service, not only the customer.</p>
              ) : searching ? (
                <p className="text-xs text-muted">Searching…</p>
              ) : searchError ? (
                <p className="text-sm text-danger">{searchError}</p>
              ) : hits.length === 0 ? (
                <p className="text-sm text-muted">No matching live customers or services.</p>
              ) : (
                <ul className="max-h-56 overflow-y-auto rounded-xl border border-border" role="listbox" aria-label="Matching services">
                  {hits.map((hit) => (
                    <li key={hit.service_id} className="border-t border-border first:border-t-0">
                      <label className="flex min-h-11 cursor-pointer items-start gap-3 px-3 py-2.5 text-left hover:bg-elevated">
                        <input
                          type="radio"
                          name="acs-assign-service"
                          className="mt-1 size-4 shrink-0"
                          checked={false}
                          onChange={() => {
                            setSelected(hit);
                            setConfirmed(false);
                            setMoveConfirmed(false);
                          }}
                        />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium">{hit.customer_name}</span>
                          <span className="mt-0.5 block text-xs text-muted">Customer No: {hit.customer_account || "—"}</span>
                          <span className="block text-xs text-muted">Phone: {hit.phone ? displayAcsPhone(hit.phone) : "—"}</span>
                          <span className="mt-1 block text-xs text-muted">Service No: {hit.service_account || "—"}</span>
                          <span className="block text-xs text-muted">
                            Access Type: {accessMethodLabel(hit.access_method)} · Package: {hit.package_name} · Status: {hit.service_status}
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
                This device will be linked to the selected customer service. Verify the serial number and service before confirming.
                No SMS, invoice, or billing change is created.
              </div>
              {needsMove ? (
                <label className="flex min-h-11 items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 size-4 shrink-0" checked={moveConfirmed} onChange={(e) => setMoveConfirmed(e.target.checked)} />
                  <span>Move this device off its current service. The previous assignment is recorded in audit history.</span>
                </label>
              ) : null}
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 size-4 shrink-0" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I confirm this assignment.</span>
              </label>
              <Field label="Reason (optional)">
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this CPE is moving" />
              </Field>
            </div>
          ) : null}

          {error ? <p className="text-sm text-danger">{error}</p> : null}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap">
            <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {selected ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full sm:w-auto"
                onClick={() => {
                  setSelected(null);
                  setConfirmed(false);
                  setMoveConfirmed(false);
                }}
                disabled={busy}
              >
                Back
              </Button>
            ) : null}
            <Button type="submit" className="w-full sm:w-auto" disabled={!ready}>
              {busy ? "Saving…" : "Confirm assignment"}
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

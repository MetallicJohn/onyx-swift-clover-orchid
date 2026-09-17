import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { formatDateTime } from "@/lib/isp/display";
import {
  ACS_DEVICE_TYPES,
  acsSearchReady,
  canSubmitManualDevice,
  deviceTypeLabel,
  type AcsDeviceHit,
} from "@/lib/isp/acs-device-format";
import { searchAvailableAcsDevicesFn } from "@/lib/isp/server-acs-devices";

type Method = "available" | "manual" | "wait";

export function AcsAddDeviceDialog({
  open,
  onOpenChange,
  lastScanAt,
  busy = false,
  error = null,
  onRefresh,
  onManual,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lastScanAt?: string | null;
  busy?: boolean;
  error?: string | null;
  onRefresh: () => Promise<void> | void;
  onManual: (input: {
    serial: string;
    acs_device_id: string;
    manufacturer: string;
    model: string;
    oui: string;
    mac_address: string;
    device_type: string;
    notes: string;
  }) => Promise<void> | void;
  onSelect: (device: AcsDeviceHit) => void;
}) {
  const [method, setMethod] = useState<Method>("available");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AcsDeviceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [manual, setManual] = useState({
    serial: "",
    acs_device_id: "",
    manufacturer: "",
    model: "",
    oui: "",
    mac_address: "",
    device_type: "cpe",
    notes: "",
  });
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    setMethod("available");
    setQuery("");
    setHits([]);
    setSearching(false);
    setScanNote(null);
    setManual({ serial: "", acs_device_id: "", manufacturer: "", model: "", oui: "", mac_address: "", device_type: "cpe", notes: "" });
    void loadAvailable("");
  }, [open]);

  function loadAvailable(value: string) {
    if (searchRef.current) clearTimeout(searchRef.current);
    setSearching(true);
    searchRef.current = setTimeout(() => {
      const id = ++requestRef.current;
      searchAvailableAcsDevicesFn({ data: { q: value } })
        .then((res) => {
          if (id !== requestRef.current) return;
          setHits(res.devices);
        })
        .catch(() => {
          if (id !== requestRef.current) return;
          setHits([]);
        })
        .finally(() => {
          if (id === requestRef.current) setSearching(false);
        });
    }, value ? 250 : 0);
  }

  const manualReady = canSubmitManualDevice({ serial: manual.serial, deviceId: manual.acs_device_id });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return;
        onOpenChange(next);
      }}
      title="Add Device"
      description="Pick a CPE already seen by GenieACS, enter one manually, or wait for the next TR-069 Inform."
      className="sm:max-w-xl"
    >
      <div className="grid gap-4">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(
            [
              ["available", "From GenieACS"],
              ["manual", "Enter manually"],
              ["wait", "Wait for Inform"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMethod(id)}
              className={
                method === id
                  ? "min-h-11 rounded-xl border border-accent bg-accent/10 px-3 text-sm font-medium"
                  : "min-h-11 rounded-xl border border-border px-3 text-sm text-muted hover:bg-elevated"
              }
            >
              {label}
            </button>
          ))}
        </div>

        {method === "available" ? (
          <div className="grid gap-2">
            <Field label="Search available devices">
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  loadAvailable(e.target.value);
                }}
                placeholder="Serial, device ID, OUI, model, MAC, or IP"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {query && !acsSearchReady(query) ? (
              <p className="text-xs text-muted">Enter at least 2 characters, or leave blank to list unassigned devices.</p>
            ) : searching ? (
              <p className="text-xs text-muted">Searching…</p>
            ) : hits.length === 0 ? (
              <p className="text-sm text-muted">No unassigned devices yet. Sync from ACS or wait for the next Inform.</p>
            ) : (
              <ul className="max-h-64 overflow-y-auto rounded-xl border border-border">
                {hits.map((hit) => (
                  <li key={hit.id} className="border-t border-border first:border-t-0">
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-elevated"
                      onClick={() => onSelect(hit)}
                    >
                      <span className="text-sm font-medium">
                        {[hit.manufacturer, hit.model].filter(Boolean).join(" ") || hit.product_class} · {hit.serial}
                      </span>
                      <span className="text-xs text-muted">
                        Device ID: {hit.acs_device_id || "—"} · {hit.status === "online" ? "Online" : hit.status === "offline" ? "Offline" : "Not confirmed"}
                      </span>
                      <span className="text-xs text-muted">
                        Last inform: {hit.last_inform ? formatDateTime(hit.last_inform) : "—"} · {hit.assigned ? "Assigned" : "Unassigned"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {method === "manual" ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!manualReady || busy) return;
              void onManual(manual);
            }}
          >
            <p className="text-sm text-muted">
              A manually entered device is stored as not confirmed until GenieACS sees a matching Inform. It is not marked online.
            </p>
            <Field label="Serial number">
              <Input value={manual.serial} onChange={(e) => setManual({ ...manual, serial: e.target.value })} required />
            </Field>
            <Field label="Device ID">
              <Input value={manual.acs_device_id} onChange={(e) => setManual({ ...manual, acs_device_id: e.target.value })} placeholder="OUI-ProductClass-Serial" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Manufacturer">
                <Input value={manual.manufacturer} onChange={(e) => setManual({ ...manual, manufacturer: e.target.value })} />
              </Field>
              <Field label="Model">
                <Input value={manual.model} onChange={(e) => setManual({ ...manual, model: e.target.value })} />
              </Field>
              <Field label="OUI">
                <Input value={manual.oui} onChange={(e) => setManual({ ...manual, oui: e.target.value })} />
              </Field>
              <Field label="MAC address">
                <Input value={manual.mac_address} onChange={(e) => setManual({ ...manual, mac_address: e.target.value })} />
              </Field>
              <Field label="Device type">
                <Select value={manual.device_type} onChange={(e) => setManual({ ...manual, device_type: e.target.value })}>
                  {ACS_DEVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {deviceTypeLabel(t)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field label="Notes">
              <Textarea rows={2} value={manual.notes} onChange={(e) => setManual({ ...manual, notes: e.target.value })} />
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              <Button type="button" variant="ghost" className="w-full sm:w-auto" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={!manualReady || busy}>
                {busy ? "Saving…" : "Add device"}
              </Button>
            </div>
          </form>
        ) : null}

        {method === "wait" ? (
          <div className="grid gap-3">
            <p className="text-sm text-muted">
              Waiting for device to connect. The CPE appears after its next TR-069/CWMP Inform with this ISP’s ACS credentials. Discovery results are never invented.
            </p>
            <p className="text-xs text-muted">Last scan: {lastScanAt ? formatDateTime(lastScanAt) : "Not scanned yet"}</p>
            {scanNote ? <p className="text-sm text-accent">{scanNote}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  void Promise.resolve(onRefresh()).then(() => {
                    setScanNote("Inventory refreshed from GenieACS.");
                    loadAvailable(query);
                  });
                }}
                disabled={busy}
              >
                Refresh available devices
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setScanNote(null); loadAvailable(""); }}>
                Clear pending
              </Button>
            </div>
            {searching ? (
              <p className="text-xs text-muted">Looking for unassigned devices…</p>
            ) : hits.length === 0 ? (
              <p className="text-sm text-muted">Nothing new has informed yet.</p>
            ) : (
              <ul className="max-h-56 overflow-y-auto rounded-xl border border-border">
                {hits.map((hit) => (
                  <li key={hit.id} className="border-t border-border first:border-t-0">
                    <button
                      type="button"
                      className="flex min-h-11 w-full flex-col items-start px-3 py-2.5 text-left hover:bg-elevated"
                      onClick={() => onSelect(hit)}
                    >
                      <span className="text-sm font-medium">{hit.serial}</span>
                      <span className="text-xs text-muted">{hit.status} · {hit.last_inform ? formatDateTime(hit.last_inform) : "no inform"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {error ? <p className="text-sm text-danger">{error}</p> : null}

        {method !== "manual" ? (
          <div className="flex justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        ) : null}
      </div>
    </Dialog>
  );
}

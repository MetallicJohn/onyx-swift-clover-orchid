import { MoreHorizontal, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AcsAddDeviceDialog } from "@/components/isp/acs-add-device-dialog";
import { AcsAssignDialog } from "@/components/isp/acs-assign-dialog";
import { AcsDeviceDetails } from "@/components/isp/acs-device-details";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Select } from "@/components/ui/input";
import { accessMethodLabel, formatDateTime } from "@/lib/isp/display";
import {
  ACS_DEVICE_ACTION_CATALOG,
  deviceIdentity,
  deviceTypeLabel,
  emptyAcsFilters,
  onlineLabel,
  unsupportedActionMessage,
  type AcsDeviceFilters,
  type AcsDeviceHit,
  type AcsDeviceRow,
} from "@/lib/isp/acs-device-format";
import {
  addAcsDeviceFn,
  assignAcsDeviceFn,
  factoryResetAcsDeviceFn,
  getAcsDeviceOpticalFn,
  informAcsDeviceFn,
  listAcsDevicesFn,
  rebootAcsDeviceFn,
  refreshAcsDeviceFn,
  refreshAcsInventoryFn,
  unassignAcsDeviceFn,
} from "@/lib/isp/server-acs-devices";
import { cn } from "@/lib/utils";

type Desk = Awaited<ReturnType<typeof listAcsDevicesFn>>;

export function AcsDeviceDesk() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [filters, setFilters] = useState<AcsDeviceFilters>(emptyAcsFilters());
  const [draftQ, setDraftQ] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auto, setAuto] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [assign, setAssign] = useState<AcsDeviceRow | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [opticalNote, setOpticalNote] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function load(next = filters) {
    const data = await listAcsDevicesFn({ data: next });
    setDesk(data);
  }

  useEffect(() => {
    load(filters).catch((e) => setError(e instanceof Error ? e.message : "Could not load devices"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.online, filters.assigned, filters.vendor, filters.model, filters.deviceType, filters.customer, filters.service, filters.location, filters.page]);

  useEffect(() => {
    if (!auto) return;
    const t = setInterval(() => {
      load(filters).catch(() => {
        /* keep last list */
      });
    }, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, filters]);

  function patch(partial: Partial<AcsDeviceFilters>) {
    setFilters((f) => ({ ...f, ...partial, page: partial.page ?? 1 }));
  }

  const can = desk?.can ?? {
    add: false,
    assign: false,
    reassign: false,
    edit: false,
    wifi: false,
    optical: false,
    reboot: false,
    factoryReset: false,
    firmware: false,
    tasks: false,
    retry: false,
  };
  const rows = desk?.devices ?? [];
  const counters = desk?.counters ?? { total: 0, online: 0, offline: 0, assigned: 0, unassigned: 0 };

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) setNote(ok);
      await load(filters);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete that action");
      throw err;
    } finally {
      setBusy(false);
    }
  }

  function rowFromHit(hit: AcsDeviceHit): AcsDeviceRow {
    const existing = rows.find((r) => r.id === hit.id);
    if (existing) return existing;
    return {
      id: hit.id,
      serial: hit.serial,
      acs_device_id: hit.acs_device_id,
      manufacturer: hit.manufacturer,
      model: hit.model,
      product_class: hit.product_class,
      manufacturer_oui: hit.manufacturer_oui,
      mac_address: hit.mac_address,
      ip_address: hit.ip_address,
      device_type: "cpe",
      status: hit.status,
      source: hit.source,
      ssid: "",
      notes: "",
      hardware_version: "",
      software_version: "",
      vendor_profile: "",
      last_inform: hit.last_inform,
      customer_id: null,
      customer_name: hit.customer_name,
      customer_account: "",
      customer_phone: "",
      service_id: null,
      service_account: "",
      access_method: "",
      package_name: "",
      service_status: "",
      assigned_at: null,
      assigned_by_label: "",
      last_task_status: "",
      last_task_error: "",
      last_optical_at: null,
      optical_rx: "",
      router_name: "",
      location: "",
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const r = await refreshAcsInventoryFn();
                setNote(`Synced ${r.upserted} device(s)${r.source === "local" ? " (NBI not configured)" : ""}.`);
              })
            }
          >
            <RefreshCw className="size-4" strokeWidth={1.75} />
            Refresh
          </Button>
          {!desk || can.add ? (
            <Button type="button" onClick={() => setAddOpen(true)} disabled={Boolean(desk) && !can.add}>
              Add Device
            </Button>
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>{counters.total} devices</span>
        <span>{counters.online} online</span>
        <span>{counters.offline} offline</span>
        <span>{counters.assigned} assigned</span>
        <span>{counters.unassigned} unassigned</span>
        <span>Last scan {desk?.last_scan_at ? formatDateTime(desk.last_scan_at) : "—"}</span>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" className="size-4" checked={auto} onChange={(e) => setAuto(e.target.checked)} />
          Auto-refresh {auto ? "on" : "off"}
        </label>
      </div>

      {desk?.connection ? (
        <p className="text-xs text-muted">
          NBI {desk.connection.reachable ? "reachable" : desk.connection.configured ? "configured but unreachable" : "not configured"}
          {desk.connection.error ? ` · ${desk.connection.error}` : ""}
        </p>
      ) : null}

      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <Input
          value={draftQ}
          onChange={(e) => {
            setDraftQ(e.target.value);
            if (debounceRef.current) clearTimeout(debounceRef.current);
            debounceRef.current = setTimeout(() => patch({ q: e.target.value }), 300);
          }}
          placeholder="Search devices"
          aria-label="Search devices"
        />
        <Select value={filters.status} onChange={(e) => patch({ status: e.target.value })} aria-label="Device status">
          <option value="all">All statuses</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="unknown">Unknown</option>
        </Select>
        <Select value={filters.online} onChange={(e) => patch({ online: e.target.value as AcsDeviceFilters["online"] })} aria-label="Online/offline">
          <option value="all">Online and offline</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="unknown">Not confirmed</option>
        </Select>
        <Select value={filters.assigned} onChange={(e) => patch({ assigned: e.target.value as AcsDeviceFilters["assigned"] })} aria-label="Assigned/unassigned">
          <option value="all">Assigned and unassigned</option>
          <option value="assigned">Assigned</option>
          <option value="unassigned">Unassigned</option>
        </Select>
        <Select value={filters.vendor} onChange={(e) => patch({ vendor: e.target.value })} aria-label="Device vendor">
          <option value="">All vendors</option>
          {(desk?.vendors || []).map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
        <Select value={filters.model} onChange={(e) => patch({ model: e.target.value })} aria-label="Device model">
          <option value="">All models</option>
          {(desk?.models || []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
        <Select value={filters.deviceType} onChange={(e) => patch({ deviceType: e.target.value })} aria-label="Device type">
          <option value="all">All types</option>
          <option value="cpe">CPE</option>
          <option value="onu">ONU / ONT</option>
          <option value="router">Router</option>
          <option value="ap">Access point</option>
        </Select>
        <Input
          value={filters.customer}
          onChange={(e) => patch({ customer: e.target.value })}
          placeholder="Customer"
          aria-label="Customer"
        />
        <Input
          value={filters.service}
          onChange={(e) => patch({ service: e.target.value })}
          placeholder="Service"
          aria-label="Service"
        />
        <Input
          value={filters.location}
          onChange={(e) => patch({ location: e.target.value })}
          placeholder="Router or location"
          aria-label="Router or location"
        />
      </div>

      {note ? <p className="text-sm text-accent">{note}</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {unsupported ? <p className="text-sm text-muted">{unsupported}</p> : null}
      {opticalNote ? <p className="text-sm">{opticalNote}</p> : null}

      {!desk && !error ? (
        <p className="text-sm text-muted">Loading devices…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface px-4 py-10 text-center">
          <p className="text-sm text-muted">No devices yet. Add a device, or wait for the next Inform after ACS credentials are on the OLT.</p>
          {can.add ? (
            <Button className="mt-4" type="button" onClick={() => setAddOpen(true)}>
              Add Device
            </Button>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="bg-surface px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setDetailsId(row.id)}>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-2.5 shrink-0 rounded-full",
                        row.status === "online" ? "bg-ok" : row.status === "offline" ? "bg-danger" : "bg-muted",
                      )}
                      aria-hidden
                    />
                    <span className="font-medium">{deviceIdentity(row)}</span>
                    <Badge tone={statusTone(row.status)}>{onlineLabel(row.status, row.last_inform)}</Badge>
                  </div>
                  <p className="mt-1 text-sm">
                    {row.customer_name || "Unassigned"}
                    {row.service_account ? ` · ${row.service_account}` : ""}
                    {row.access_method ? ` · ${accessMethodLabel(row.access_method)}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {row.serial} · {deviceTypeLabel(row.device_type)}
                    {row.last_inform ? ` · ${formatDateTime(row.last_inform)}` : " · no inform"}
                    {row.optical_rx ? ` · RX ${row.optical_rx} dBm` : ""}
                    {row.router_name ? ` · ${row.router_name}` : ""}
                    {` · ${row.service_id ? "Assigned" : "Unassigned"}`}
                  </p>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="ghost" aria-label={`Actions for ${row.serial}`}>
                      <MoreHorizontal className="size-4" strokeWidth={1.75} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Actions</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => setDetailsId(row.id)}>View device details</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void run(() => refreshAcsDeviceFn({ data: { id: row.id } }), "Device refreshed")}>
                      Refresh device
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void run(() => informAcsDeviceFn({ data: { id: row.id } }), "Inform requested")}>
                      Request Inform
                    </DropdownMenuItem>
                    {can.optical ? (
                      <DropdownMenuItem
                        onSelect={() =>
                          void getAcsDeviceOpticalFn({ data: { id: row.id } }).then((o) => {
                            setOpticalNote(o.available ? `RX ${o.metrics.find((m) => m.key === "rx")?.value || "—"} dBm` : o.message);
                            setDetailsId(row.id);
                          })
                        }
                      >
                        View optical information
                      </DropdownMenuItem>
                    ) : null}
                    {can.reboot ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          if (!window.confirm("Reboot this device? Access drops until it comes back.")) return;
                          void run(() => rebootAcsDeviceFn({ data: { id: row.id, confirm: true } }), "Reboot queued");
                        }}
                      >
                        Reboot device
                      </DropdownMenuItem>
                    ) : null}
                    {can.factoryReset ? (
                      <DropdownMenuItem
                        danger
                        onSelect={() => {
                          const phrase = window.prompt(`Type RESET to factory-reset ${row.serial}`) || "";
                          if (phrase.trim().toUpperCase() !== "RESET") return;
                          void run(() => factoryResetAcsDeviceFn({ data: { id: row.id, confirm: true, phrase } }), "Factory reset queued");
                        }}
                      >
                        Factory reset
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem
                      onSelect={() => setUnsupported(unsupportedActionMessage())}
                    >
                      Firmware upgrade
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {can.assign && !row.service_id ? (
                      <DropdownMenuItem onSelect={() => setAssign(row)}>Assign device</DropdownMenuItem>
                    ) : null}
                    {can.reassign && row.service_id ? (
                      <DropdownMenuItem onSelect={() => setAssign(row)}>Reassign device</DropdownMenuItem>
                    ) : null}
                    {can.assign && row.service_id ? (
                      <DropdownMenuItem
                        onSelect={() => {
                          if (!window.confirm("Unassign this device from its service?")) return;
                          void run(() => unassignAcsDeviceFn({ data: { id: row.id, confirm: true } }), "Device unassigned");
                        }}
                      >
                        Unassign device
                      </DropdownMenuItem>
                    ) : null}
                    <DropdownMenuItem onSelect={() => setDetailsId(row.id)}>View audit history</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-subtle">Other</DropdownMenuLabel>
                    {ACS_DEVICE_ACTION_CATALOG.filter((a) => ["wifi", "clients", "wan", "parameters", "tasks"].includes(a.id)).map((a) => (
                      <DropdownMenuItem key={a.id} onSelect={() => setDetailsId(row.id)}>
                        {a.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </li>
          ))}
        </ul>
      )}

      {desk && desk.pages > 1 ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="ghost" disabled={filters.page <= 1} onClick={() => patch({ page: filters.page - 1 })}>
            Previous
          </Button>
          <span className="self-center text-sm text-muted">
            Page {desk.page} of {desk.pages}
          </span>
          <Button type="button" variant="ghost" disabled={filters.page >= desk.pages} onClick={() => patch({ page: filters.page + 1 })}>
            Next
          </Button>
        </div>
      ) : null}

      <AcsAddDeviceDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        lastScanAt={desk?.last_scan_at}
        busy={busy}
        error={error}
        onRefresh={() => refreshAcsInventoryFn().then(() => load(filters))}
        onManual={(input) =>
          run(async () => {
            const created = await addAcsDeviceFn({ data: input });
            setAddOpen(false);
            const rec = await listAcsDevicesFn({ data: filters });
            setDesk(rec);
            const row = rec.devices.find((d) => d.id === created.id);
            if (row && can.assign) setAssign(row);
          }, "Device added. It stays unconfirmed until GenieACS sees an Inform.")
        }
        onSelect={(hit) => {
          setAddOpen(false);
          if (can.assign) setAssign(rowFromHit(hit));
          else setDetailsId(hit.id);
        }}
      />

      <AcsAssignDialog
        open={Boolean(assign)}
        onOpenChange={(next) => {
          if (!next) setAssign(null);
        }}
        device={assign}
        busy={busy}
        error={error}
        onSubmit={(input) =>
          run(async () => {
            await assignAcsDeviceFn({
              data: {
                id: assign!.id,
                customer_id: input.customer_id,
                service_id: input.service_id,
                confirm: true,
                confirm_move: input.confirm_move,
                reason: input.reason,
              },
            });
            setAssign(null);
          }, "Device assigned")
        }
      />

      <AcsDeviceDetails
        open={Boolean(detailsId)}
        onOpenChange={(next) => {
          if (!next) setDetailsId(null);
        }}
        deviceId={detailsId}
        can={can}
        onAssign={() => {
          const row = rows.find((r) => r.id === detailsId);
          if (row) setAssign(row);
        }}
        onChanged={() => void load(filters)}
      />
    </div>
  );
}

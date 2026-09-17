import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { accessMethodLabel, formatDateTime } from "@/lib/isp/display";
import {
  ACS_FACTORY_RESET_PHRASE,
  deviceIdentity,
  factoryResetReady,
  opticalMissingMessage,
  taskPhaseLabel,
  unsupportedActionMessage,
  wifiPasswordValid,
  wifiReviewRows,
} from "@/lib/isp/acs-device-format";
import {
  factoryResetAcsDeviceFn,
  getAcsDeviceFn,
  getAcsDeviceOpticalFn,
  getAcsDeviceParametersFn,
  informAcsDeviceFn,
  rebootAcsDeviceFn,
  refreshAcsDeviceFn,
  retryAcsTaskFn,
  setAcsDeviceWifiFn,
  unassignAcsDeviceFn,
} from "@/lib/isp/server-acs-devices";
import { cn } from "@/lib/utils";

type RecordData = Awaited<ReturnType<typeof getAcsDeviceFn>>;
type Tab = "overview" | "network" | "wifi" | "optical" | "tasks" | "audit";

export function AcsDeviceDetails({
  open,
  onOpenChange,
  deviceId,
  can,
  onAssign,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deviceId: string | null;
  can: {
    assign: boolean;
    reassign: boolean;
    wifi: boolean;
    optical: boolean;
    reboot: boolean;
    factoryReset: boolean;
    firmware: boolean;
    retry: boolean;
    tasks: boolean;
  };
  onAssign: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [data, setData] = useState<RecordData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [params, setParams] = useState<Awaited<ReturnType<typeof getAcsDeviceParametersFn>> | null>(null);
  const [optical, setOptical] = useState<Awaited<ReturnType<typeof getAcsDeviceOpticalFn>> | null>(null);
  const [rebootOpen, setRebootOpen] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [wifi, setWifi] = useState({
    band: "2.4",
    ssid: "",
    password: "",
    security: "WPA2",
    enabled: true,
    channel: "",
    channelWidth: "",
    mode: "",
    showPass: false,
    review: false,
  });

  async function load() {
    if (!deviceId) return;
    const rec = await getAcsDeviceFn({ data: { id: deviceId } });
    setData(rec);
    setWifi((w) => ({ ...w, ssid: rec.device.ssid || w.ssid }));
  }

  useEffect(() => {
    if (!open || !deviceId) {
      setData(null);
      setParams(null);
      setOptical(null);
      setError(null);
      setNote(null);
      setTab("overview");
      setRebootOpen(false);
      setResetPhrase("");
      setResetConfirm(false);
      return;
    }
    setError(null);
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load device"));
  }, [open, deviceId]);

  useEffect(() => {
    if (!open || !deviceId) return;
    if (tab === "network" || tab === "wifi" || tab === "overview") {
      getAcsDeviceParametersFn({ data: { id: deviceId } })
        .then(setParams)
        .catch(() => setParams(null));
    }
    if (tab === "optical" && can.optical) {
      getAcsDeviceOpticalFn({ data: { id: deviceId } })
        .then(setOptical)
        .catch((e) => setError(e instanceof Error ? e.message : "Could not read optical information"));
    }
  }, [open, deviceId, tab, can.optical]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (ok) setNote(ok);
      await load();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const d = data?.device;
  const tabs: Array<[Tab, string, boolean]> = [
    ["overview", "Overview", true],
    ["network", "Network", true],
    ["wifi", "Wi-Fi", true],
    ["optical", "Optical", can.optical],
    ["tasks", "Tasks", can.tasks],
    ["audit", "Audit", true],
  ];

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={d ? deviceIdentity(d) : "Device"}
      description={d ? `${d.serial} · ${d.status}` : "Device details"}
      placement="drawer"
      className="sm:max-w-lg"
    >
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}
      {note ? <p className="mb-3 text-sm text-accent">{note}</p> : null}
      {!d ? (
        <p className="text-sm text-muted">Loading device…</p>
      ) : (
        <div className="grid gap-4">
          <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-bg p-1">
            {tabs.filter(([, , on]) => on).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={cn(
                  "h-11 shrink-0 rounded-lg px-3 text-sm font-medium",
                  tab === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
                )}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <dl className="grid gap-2 text-sm">
              <Row label="Manufacturer" value={d.manufacturer || "—"} />
              <Row label="Model" value={d.model || d.product_class} />
              <Row label="Serial" value={d.serial} />
              <Row label="Device ID" value={d.acs_device_id || "—"} />
              <Row label="OUI" value={d.manufacturer_oui || "—"} />
              <Row label="Product class" value={d.product_class || "—"} />
              <Row label="Hardware" value={d.hardware_version || params?.hardware || "—"} />
              <Row label="Firmware" value={d.software_version || params?.software || "—"} />
              <Row label="MAC" value={d.mac_address || params?.lan.mac || "—"} />
              <Row label="IP" value={d.ip_address || params?.wan.ip || "—"} />
              <Row label="Online" value={d.status === "online" ? "Online" : d.status === "offline" ? "Offline" : "Not confirmed"} />
              <Row label="Last inform" value={d.last_inform ? formatDateTime(d.last_inform) : "—"} />
              <Row label="Uptime" value={params?.uptime || "—"} />
              <Row label="Source" value={d.source === "manual" ? "Manual (not confirmed online)" : "GenieACS"} />
              <Row label="Customer" value={d.customer_name || "Unassigned"} />
              <Row label="Service" value={d.service_account || "—"} />
            </dl>
          ) : null}

          {tab === "network" ? (
            <div className="grid gap-3 text-sm">
              <section className="rounded-xl border border-border bg-bg px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-muted">WAN</p>
                <dl className="mt-2 grid gap-1">
                  <Row label="Status" value={params?.wan.status || "Not exposed"} />
                  <Row label="WAN IP" value={params?.wan.ip || "—"} />
                  <Row label="Gateway" value={params?.wan.gateway || "—"} />
                  <Row label="DNS" value={params?.wan.dns || "—"} />
                </dl>
              </section>
              <section className="rounded-xl border border-border bg-bg px-4 py-3">
                <p className="text-xs font-medium tracking-wide text-muted">LAN</p>
                <dl className="mt-2 grid gap-1">
                  <Row label="LAN IP" value={params?.lan.ip || "—"} />
                  <Row label="MAC" value={params?.lan.mac || d.mac_address || "—"} />
                  <Row label="Connected devices" value={params?.clients_available ? params.hosts || "—" : "Connected clients are not exposed by this device."} />
                </dl>
              </section>
            </div>
          ) : null}

          {tab === "wifi" ? (
            <div className="grid gap-3">
              {(params?.wifi || []).map((band) => (
                <section key={band.id} className="rounded-xl border border-border bg-bg px-4 py-3 text-sm">
                  <p className="text-xs font-medium tracking-wide text-muted">{band.label}</p>
                  {band.available ? (
                    <dl className="mt-2 grid gap-1">
                      <Row label="SSID" value={band.ssid || "—"} />
                      <Row label="Radio" value={band.enabled == null ? "—" : band.enabled ? "Enabled" : "Disabled"} />
                      <Row label="Security" value={band.security || "—"} />
                      <Row label="Channel" value={band.channel || "—"} />
                      <Row label="Width" value={band.channel_width || "—"} />
                      <Row label="Mode" value={band.mode || "—"} />
                      <Row label="Password" value="Hidden" />
                    </dl>
                  ) : (
                    <p className="mt-2 text-sm text-muted">{unsupportedActionMessage()}</p>
                  )}
                </section>
              ))}
              {can.wifi ? (
                wifi.review ? (
                  <section className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
                    <p className="text-sm font-medium">Review Wi-Fi changes</p>
                    <dl className="mt-2 grid gap-1 text-sm">
                      {wifiReviewRows(wifi).map((row) => (
                        <Row key={row.label} label={row.label} value={row.value} />
                      ))}
                    </dl>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button type="button" variant="ghost" onClick={() => setWifi({ ...wifi, review: false })}>
                        Back
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            const out = await setAcsDeviceWifiFn({
                              data: {
                                id: d.id,
                                band: wifi.band,
                                ssid: wifi.ssid,
                                password: wifi.password || undefined,
                                security: wifi.security,
                                enabled: wifi.enabled,
                                channel: wifi.channel || undefined,
                                channelWidth: wifi.channelWidth || undefined,
                                mode: wifi.mode || undefined,
                                confirm: true,
                              },
                            });
                            setWifi({ ...wifi, password: "", review: false });
                            setNote(
                              out.verified
                                ? "Wi-Fi verified on the device."
                                : `Task ${out.phase.replaceAll("_", " ")}. Not marked successful until the device reports the new SSID.`,
                            );
                          })
                        }
                      >
                        Apply
                      </Button>
                    </div>
                  </section>
                ) : (
                  <form
                    className="grid gap-3 rounded-xl border border-border bg-bg px-4 py-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (wifi.password && !wifiPasswordValid(wifi.password, wifi.security)) {
                        setError("Wi-Fi password must be 8–63 characters for this security mode");
                        return;
                      }
                      setWifi({ ...wifi, review: true });
                    }}
                  >
                    <p className="text-sm font-medium">Change Wi-Fi settings</p>
                    <Field label="Band">
                      <Select value={wifi.band} onChange={(e) => setWifi({ ...wifi, band: e.target.value })}>
                        <option value="2.4">2.4 GHz</option>
                        <option value="5">5 GHz</option>
                      </Select>
                    </Field>
                    <Field label="SSID">
                      <Input value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} />
                    </Field>
                    <Field label="Security">
                      <Select value={wifi.security} onChange={(e) => setWifi({ ...wifi, security: e.target.value })}>
                        <option value="WPA2">WPA2</option>
                        <option value="WPA3">WPA3</option>
                        <option value="none">Open</option>
                      </Select>
                    </Field>
                    <Field label="Wi-Fi password">
                      <div className="flex gap-2">
                        <Input
                          type={wifi.showPass ? "text" : "password"}
                          value={wifi.password}
                          onChange={(e) => setWifi({ ...wifi, password: e.target.value })}
                          autoComplete="new-password"
                        />
                        <Button type="button" variant="secondary" onClick={() => setWifi({ ...wifi, showPass: !wifi.showPass })}>
                          {wifi.showPass ? "Hide" : "Show"}
                        </Button>
                      </div>
                    </Field>
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input type="checkbox" className="size-4" checked={wifi.enabled} onChange={(e) => setWifi({ ...wifi, enabled: e.target.checked })} />
                      Wi-Fi radio enabled
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Channel">
                        <Input value={wifi.channel} onChange={(e) => setWifi({ ...wifi, channel: e.target.value })} />
                      </Field>
                      <Field label="Channel width">
                        <Input value={wifi.channelWidth} onChange={(e) => setWifi({ ...wifi, channelWidth: e.target.value })} />
                      </Field>
                      <Field label="Wi-Fi mode">
                        <Input value={wifi.mode} onChange={(e) => setWifi({ ...wifi, mode: e.target.value })} placeholder="n / ac / ax" />
                      </Field>
                    </div>
                    <Button type="submit" disabled={busy}>
                      Review changes
                    </Button>
                  </form>
                )
              ) : null}
            </div>
          ) : null}

          {tab === "optical" ? (
            optical && !optical.available ? (
              <p className="text-sm text-muted">{optical.message || opticalMissingMessage()}</p>
            ) : (
              <dl className="grid gap-2 text-sm">
                {(optical?.metrics || []).map((m) => (
                  <div key={m.key} className="rounded-xl border border-border bg-bg px-4 py-3">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted">{m.label}</dt>
                      <dd className="font-medium">{m.available ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "Unavailable"}</dd>
                    </div>
                    <p className="mt-1 font-mono text-xs text-subtle">{m.path}</p>
                  </div>
                ))}
                <p className="text-xs text-muted">Last update: {optical?.updated_at ? formatDateTime(optical.updated_at) : "—"}</p>
              </dl>
            )
          ) : null}

          {tab === "tasks" ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {(data?.tasks || []).length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted">No tasks on this device.</li>
              ) : (
                (data?.tasks || []).map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 bg-surface px-4 py-3 text-sm">
                    <div>
                      <p className="font-medium">{t.kind}</p>
                      <p className="text-xs text-muted">
                        {formatDateTime(t.created_at)} · {t.actor_label || "staff"}
                        {t.error_message ? ` · ${t.error_message}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={statusTone(t.phase)}>{taskPhaseLabel(t.phase, t.status)}</Badge>
                      {can.retry && (t.phase === "failed" || t.status === "error" || t.phase === "waiting_for_inform") ? (
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => retryAcsTaskFn({ data: { id: t.id } }), "Retry queued")}>
                          Retry
                        </Button>
                      ) : null}
                    </div>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          {tab === "audit" ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
              {(data?.audit || []).length === 0 ? (
                <li className="px-4 py-6 text-sm text-muted">No assignment, Wi-Fi, reboot, or provisioning history yet.</li>
              ) : (
                (data?.audit || []).map((a) => (
                  <li key={a.id} className="px-4 py-3 text-sm">
                    <p className="font-medium">{a.action}</p>
                    <p className="text-xs text-muted">{formatDateTime(a.created_at)}</p>
                  </li>
                ))
              )}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => refreshAcsDeviceFn({ data: { id: d.id } }), "Device refreshed")}>
              Refresh
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => informAcsDeviceFn({ data: { id: d.id } }), "Inform requested")}>
              Request Inform
            </Button>
            {can.reboot ? (
              <Button size="sm" variant="secondary" onClick={() => setRebootOpen(true)}>
                Reboot
              </Button>
            ) : null}
            {can.assign && !d.service_id ? (
              <Button size="sm" onClick={onAssign}>
                Assign
              </Button>
            ) : null}
            {can.reassign && d.service_id ? (
              <Button size="sm" onClick={onAssign}>
                Reassign
              </Button>
            ) : null}
            {can.assign && d.service_id ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run(() => unassignAcsDeviceFn({ data: { id: d.id, confirm: true } }), "Device unassigned")}>
                Unassign
              </Button>
            ) : null}
          </div>

          {rebootOpen ? (
            <div className="rounded-xl border border-warn/40 bg-warn/10 px-4 py-3">
              <p className="text-sm">Reboot this device? Access drops until it comes back.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="ghost" onClick={() => setRebootOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await rebootAcsDeviceFn({ data: { id: d.id, confirm: true } });
                      setRebootOpen(false);
                    }, "Reboot queued")
                  }
                >
                  Confirm reboot
                </Button>
              </div>
            </div>
          ) : null}

          {can.factoryReset ? (
            <div className="rounded-xl border border-danger/40 px-4 py-3">
              <p className="text-sm font-medium">Factory reset</p>
              <p className="mt-1 text-xs text-muted">Type {ACS_FACTORY_RESET_PHRASE} and confirm. This is not marked successful until the device reports back.</p>
              <Field label="Confirmation phrase">
                <Input value={resetPhrase} onChange={(e) => setResetPhrase(e.target.value)} placeholder={ACS_FACTORY_RESET_PHRASE} />
              </Field>
              <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
                <input type="checkbox" className="size-4" checked={resetConfirm} onChange={(e) => setResetConfirm(e.target.checked)} />
                I understand this wipes the CPE configuration
              </label>
              <Button
                className="mt-2"
                variant="danger"
                disabled={busy || !factoryResetReady(resetPhrase, resetConfirm)}
                onClick={() =>
                  void run(async () => {
                    await factoryResetAcsDeviceFn({ data: { id: d.id, confirm: true, phrase: resetPhrase } });
                    setResetPhrase("");
                    setResetConfirm(false);
                  }, "Factory reset queued")
                }
              >
                Factory reset
              </Button>
            </div>
          ) : null}

          {can.firmware ? (
            <p className="text-xs text-muted">Firmware upgrade is not supported on this model until a file server is configured.</p>
          ) : null}

          {d.customer_name ? (
            <p className="text-xs text-muted">
              {d.customer_name}
              {d.customer_account ? ` · ${d.customer_account}` : ""} · {d.package_name || "—"} · {accessMethodLabel(d.access_method)}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="max-w-[60%] text-right font-medium">{value}</dd>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { etimsHealth, type EtimsEnvironment } from "@/lib/isp/etims-format";
import { getEtimsSettings, initializeEtimsFn, retryEtimsInvoiceFn, saveEtimsSettingsFn, testEtimsFn } from "@/lib/isp/server-etims";
import { cn } from "@/lib/utils";
import { SettingsCheck, SettingsField, SettingsStatus, type SettingsNote } from "@/components/isp/settings-ui";
import { StickySaveBar } from "@/components/ui/sticky-save-bar";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/components/ui/unsaved-guard";

type View = Awaited<ReturnType<typeof getEtimsSettings>>;
type MapRow = View["maps"][number];

const EMPTY: View = {
  enabled: false,
  environment: "sandbox",
  kraPin: "",
  branchId: "",
  deviceSerial: "",
  status: "not_initialized",
  initializedAt: null,
  lastSuccessAt: null,
  lastError: "",
  hasKey: false,
  sdcId: "",
  mrcNo: "",
  tradeName: "",
  branchName: "",
  defaultItemCd: "",
  defaultItemClsCd: "",
  defaultTaxTyCd: "",
  defaultQtyUnitCd: "",
  defaultPkgUnitCd: "",
  productionConfirmed: false,
  counts: { pending: 0, failed: 0, rejected: 0, submitted: 0 },
  failures: [],
  maps: [],
};

function ago(iso: string | null) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString("en-KE", { timeZone: "Africa/Nairobi" });
}

function etimsFields(view: View) {
  return {
    enabled: view.enabled,
    environment: view.environment,
    kraPin: view.kraPin,
    branchId: view.branchId,
    deviceSerial: view.deviceSerial,
    defaultItemCd: view.defaultItemCd,
    defaultItemClsCd: view.defaultItemClsCd,
    defaultTaxTyCd: view.defaultTaxTyCd,
    defaultQtyUnitCd: view.defaultQtyUnitCd,
    defaultPkgUnitCd: view.defaultPkgUnitCd,
    maps: view.maps,
  };
}

function etimsFingerprint(view: View) {
  return JSON.stringify(etimsFields(view));
}

export function EtimsSettings({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void } = {}) {
  const toast = useToast();
  const [view, setView] = useState<View>(EMPTY);
  const [savedEnv, setSavedEnv] = useState<EtimsEnvironment>("sandbox");
  const [baseline, setBaseline] = useState("");
  const [confirmProduction, setConfirmProduction] = useState(false);
  const [forceInit, setForceInit] = useState(false);
  const [note, setNote] = useState<SettingsNote>(null);
  const [testNote, setTestNote] = useState<SettingsNote>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  function apply(next: View) {
    setView(next);
    setSavedEnv(next.environment);
    setConfirmProduction(false);
    setForceInit(false);
    setBaseline(etimsFingerprint(next));
  }

  useEffect(() => {
    let alive = true;
    getEtimsSettings()
      .then((next) => {
        if (alive) apply(next);
      })
      .catch((err: unknown) => {
        if (alive) setNote({ ok: false, text: err instanceof Error ? err.message : "Could not load eTIMS settings" });
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  const needsConfirm = view.environment === "production" && savedEnv !== "production";
  const dirty = loaded && baseline !== "" && etimsFingerprint(view) !== baseline;
  useUnsavedGuard(dirty, "eTIMS settings have unsaved changes. Leave without saving?");
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const health = etimsHealth(view);
  const dot =
    health.tone === "ok" ? "bg-ok" : health.tone === "warn" ? "bg-warn" : health.tone === "danger" ? "bg-danger" : "bg-muted";

  async function save() {
    setNote(null);
    if (needsConfirm && !confirmProduction) {
      setNote({ ok: false, text: "Confirm production before invoices are sent to KRA's live environment" });
      return;
    }
    setBusy(true);
    try {
      const next = await saveEtimsSettingsFn({
        data: {
          enabled: view.enabled,
          environment: view.environment,
          kraPin: view.kraPin,
          branchId: view.branchId,
          deviceSerial: view.deviceSerial,
          defaultItemCd: view.defaultItemCd,
          defaultItemClsCd: view.defaultItemClsCd,
          defaultTaxTyCd: view.defaultTaxTyCd,
          defaultQtyUnitCd: view.defaultQtyUnitCd,
          defaultPkgUnitCd: view.defaultPkgUnitCd,
          confirmProduction: needsConfirm ? confirmProduction : view.productionConfirmed,
          maps: view.maps,
        },
      });
      apply(next);
      setNote({ ok: true, text: "eTIMS settings saved" });
      toast.success("eTIMS settings saved");
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not save eTIMS settings" });
      toast.error("Could not save eTIMS", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  }

  async function initialize(force: boolean) {
    setNote(null);
    setBusy(true);
    try {
      const result = await initializeEtimsFn({ data: { force } });
      apply(result.view);
      setNote({ ok: true, text: result.already ? "Already initialized" : "Device initialized" });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Initialization failed" });
      try {
        apply(await getEtimsSettings());
      } catch {
        /* keep the form */
      }
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setTestNote(null);
    setBusy(true);
    try {
      const result = await testEtimsFn();
      setTestNote({ ok: result.ok, text: result.message });
    } catch (err) {
      setTestNote({ ok: false, text: err instanceof Error ? err.message : "Connection test failed" });
    } finally {
      setBusy(false);
    }
  }

  async function retry(invoiceId: string) {
    setNote(null);
    setBusy(true);
    try {
      apply(await retryEtimsInvoiceFn({ data: { invoiceId } }));
      setNote({ ok: true, text: "eTIMS submission queued again" });
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : "Could not retry" });
    } finally {
      setBusy(false);
    }
  }

  function setMap(packageId: string, patch: Partial<MapRow>) {
    setView((current) => ({
      ...current,
      maps: current.maps.map((row) => (row.packageId === packageId ? { ...row, ...patch } : row)),
    }));
  }

  return (
    <form
      className="grid max-w-3xl gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div>
        <h2 className="font-medium">eTIMS</h2>
        <p className="mt-1 text-sm text-muted">
          OSCU sends this ISP's invoices to KRA. Sandbox is for testing. Production reaches KRA's live environment and is
          only for a taxpayer that has finished KRA onboarding. This software is not shown as KRA-certified.
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className={cn("size-2 rounded-full", dot)} aria-hidden />
        <span className="font-medium">{loaded ? health.title : "Loading"}</span>
        <span className="text-muted">{loaded ? health.detail : ""}</span>
      </div>
      {view.lastSuccessAt ? <p className="text-xs text-muted">Last submission: {ago(view.lastSuccessAt)}</p> : null}
      <p className="text-xs text-muted">
        Pending {view.counts.pending} · Failed {view.counts.failed} · Rejected {view.counts.rejected} · Submitted{" "}
        {view.counts.submitted}
      </p>

      <SettingsCheck label="Enable eTIMS" checked={view.enabled} onChange={(enabled) => setView({ ...view, enabled })} />

      <SettingsField label="Environment" hint="Each ISP uses its own PIN, branch, device, and invoice sequence.">
        <Select
          value={view.environment}
          onChange={(e) => setView({ ...view, environment: e.target.value === "production" ? "production" : "sandbox" })}
        >
          <option value="sandbox">Sandbox</option>
          <option value="production">Production</option>
        </Select>
      </SettingsField>

      {view.environment === "production" ? (
        <div className="rounded-lg border border-warn/40 bg-elevated p-3 text-sm">
          Production eTIMS is connected to KRA's live environment. Only enable this after the taxpayer and integration
          have completed the required KRA onboarding, testing, and certification process.
          {needsConfirm ? (
            <div className="mt-3">
              <SettingsCheck
                label="I confirm this ISP may send invoices to KRA production"
                checked={confirmProduction}
                onChange={setConfirmProduction}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <SettingsField label="KRA PIN" hint="The PIN registered for this ISP, for example A123456789Z.">
          <Input value={view.kraPin} autoComplete="off" onChange={(e) => setView({ ...view, kraPin: e.target.value })} />
        </SettingsField>
        <SettingsField label="Branch ID" hint="The 2-character branch registered with this device at KRA.">
          <Input value={view.branchId} autoComplete="off" maxLength={2} onChange={(e) => setView({ ...view, branchId: e.target.value })} />
        </SettingsField>
      </div>
      <SettingsField label="Device serial" hint="The serial from KRA onboarding. A new serial is not generated here.">
        <Input value={view.deviceSerial} autoComplete="off" onChange={(e) => setView({ ...view, deviceSerial: e.target.value })} />
      </SettingsField>

      <div className="grid gap-3 sm:grid-cols-2">
        <SettingsField label="Item code" optional hint="From the KRA item list. Leave empty until you have the code.">
          <Input value={view.defaultItemCd} onChange={(e) => setView({ ...view, defaultItemCd: e.target.value })} />
        </SettingsField>
        <SettingsField label="Item classification" optional hint="From the KRA classification list.">
          <Input value={view.defaultItemClsCd} onChange={(e) => setView({ ...view, defaultItemClsCd: e.target.value })} />
        </SettingsField>
        <SettingsField label="Tax type" optional hint="KRA tax type code for these lines.">
          <Input value={view.defaultTaxTyCd} onChange={(e) => setView({ ...view, defaultTaxTyCd: e.target.value })} />
        </SettingsField>
        <SettingsField label="Quantity unit" optional>
          <Input value={view.defaultQtyUnitCd} onChange={(e) => setView({ ...view, defaultQtyUnitCd: e.target.value })} />
        </SettingsField>
        <SettingsField label="Package unit" optional>
          <Input value={view.defaultPkgUnitCd} onChange={(e) => setView({ ...view, defaultPkgUnitCd: e.target.value })} />
        </SettingsField>
      </div>
      <p className="text-xs text-muted">
        Codes are sent only as entered. A package mapping below overrides the default. An invoice without a complete
        mapping is rejected instead of being sent with a guessed code.
      </p>

      {view.maps.length ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-elevated text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Package</th>
                <th className="px-3 py-2 font-medium">Item code</th>
                <th className="px-3 py-2 font-medium">Classification</th>
                <th className="px-3 py-2 font-medium">Tax</th>
                <th className="px-3 py-2 font-medium">Qty unit</th>
                <th className="px-3 py-2 font-medium">Pkg unit</th>
              </tr>
            </thead>
            <tbody>
              {view.maps.map((row) => (
                <tr key={row.packageId} className="border-t border-border">
                  <td className="px-3 py-2">{row.name}</td>
                  {(["itemCd", "itemClsCd", "taxTyCd", "qtyUnitCd", "pkgUnitCd"] as const).map((key) => (
                    <td key={key} className="px-3 py-2">
                      <Input value={row[key]} onChange={(e) => setMap(row.packageId, { [key]: e.target.value })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <SettingsStatus note={note} />
      <StickySaveBar
        dirty={dirty}
        saving={busy}
        saved={note?.ok === true && !dirty}
        onDiscard={() => {
          if (!baseline) return;
          const saved = JSON.parse(baseline) as ReturnType<typeof etimsFields>;
          setView((current) => ({ ...current, ...saved, maps: saved.maps }));
          setConfirmProduction(false);
        }}
        onSave={() => void save()}
      />

      <div className="grid gap-3 rounded-lg border border-border p-3">
        <p className="text-sm">
          Status: {view.status === "initialized" ? "Initialized" : view.status === "error" ? "Error" : "Not initialized"}
          {view.initializedAt ? ` · ${ago(view.initializedAt)}` : ""}
          {view.sdcId ? ` · SDC ${view.sdcId}` : ""}
        </p>
        {view.hasKey ? <p className="text-xs text-muted">Communication key is stored on the server.</p> : null}
        {view.status === "initialized" ? (
          <>
            <p className="text-sm">Already initialized</p>
            <SettingsCheck
              label="Replace the stored communication key"
              checked={forceInit}
              onChange={setForceInit}
            />
            <Button type="button" variant="secondary" disabled={busy || !forceInit} onClick={() => void initialize(true)}>
              Re-initialize device
            </Button>
          </>
        ) : (
          <Button type="button" disabled={busy || !view.enabled} onClick={() => void initialize(false)}>
            Register device
          </Button>
        )}
        <Button type="button" variant="secondary" disabled={busy || view.status !== "initialized"} onClick={() => void testConnection()}>
          Test connection
        </Button>
        <SettingsStatus note={testNote} />
      </div>

      {view.failures.length ? (
        <div className="grid gap-2">
          <h3 className="text-sm font-medium">Needs attention</h3>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {view.failures.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                <div>
                  <p className="font-mono">{row.number}</p>
                  <p className="text-xs text-muted">
                    {row.etims_status}
                    {row.etims_error ? ` · ${row.etims_error}` : ""}
                  </p>
                </div>
                <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => void retry(row.id)}>
                  Retry eTIMS
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </form>
  );
}

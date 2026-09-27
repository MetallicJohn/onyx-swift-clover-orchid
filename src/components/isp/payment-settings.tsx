import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { mergeKeptEdits } from "@/lib/isp/company-info-tabs";
import {
  kopoConfigComplete,
  mpesaConfigComplete,
  PAYMENT_SAVE_FAIL,
  PAYMENT_SAVE_OK,
  PAYMENT_TEST_BUSY,
  PAYMENT_TEST_FAIL,
  PAYMENT_TEST_OK,
  gatewayStatus,
  safeSettingsError,
  type GatewayTestState,
} from "@/lib/isp/settings-feedback";
import { getKopokopo, saveKopokopo, testKopokopo } from "@/lib/isp/server-kopo";
import { getMpesa, saveMpesa, savePublicBase, testMpesa } from "@/lib/isp/server-mpesa";
import { listProviders, toggleProvider } from "@/lib/isp/server-ops";
import { cn } from "@/lib/utils";
import { SaveButton, SecretInput, SettingsCheck, SettingsField, SettingsStatus, type SettingsNote } from "@/components/isp/settings-ui";

type ProviderRow = { id: string; kind: string; label: string; enabled: boolean; sandbox: boolean };
type MpesaForm = {
  enabled: boolean;
  sandbox: boolean;
  client_id: string;
  client_secret: string;
  till_number: string;
  passkey: string;
  stk_type: string;
};
type KopoForm = {
  enabled: boolean;
  sandbox: boolean;
  client_id: string;
  client_secret: string;
  till_number: string;
};

const EMPTY_MPESA: MpesaForm = {
  enabled: true,
  sandbox: true,
  client_id: "",
  client_secret: "",
  till_number: "",
  passkey: "",
  stk_type: "paybill",
};
const EMPTY_KOPO: KopoForm = {
  enabled: true,
  sandbox: true,
  client_id: "",
  client_secret: "",
  till_number: "",
};

export function PaymentSettings({ onPublicBase }: { onPublicBase: (url: string) => void }) {
  const [gateway, setGateway] = useState("mpesa");
  const [providers, setProviders] = useState<ProviderRow[]>([]);
  const [mpesa, setMpesa] = useState<MpesaForm>(EMPTY_MPESA);
  const [kopo, setKopo] = useState<KopoForm>(EMPTY_KOPO);
  const [secretStored, setSecretStored] = useState(false);
  const [passkeyStored, setPasskeyStored] = useState(false);
  const [kopoSecretStored, setKopoSecretStored] = useState(false);
  const [secretHint, setSecretHint] = useState("");
  const [passHint, setPassHint] = useState("");
  const [kopoHint, setKopoHint] = useState("");
  const [publicBase, setPublicBase] = useState("");
  const [mpesaCallback, setMpesaCallback] = useState("");
  const [kopoCallback, setKopoCallback] = useState("");
  const [mpesaTest, setMpesaTest] = useState<GatewayTestState>(null);
  const [kopoTest, setKopoTest] = useState<GatewayTestState>(null);
  const [note, setNote] = useState<SettingsNote>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const saveLock = useRef(false);
  const testLock = useRef(false);
  const mpesaRef = useRef(mpesa);
  const kopoRef = useRef(kopo);
  const baseRef = useRef(publicBase);
  mpesaRef.current = mpesa;
  kopoRef.current = kopo;
  baseRef.current = publicBase;

  function applyMpesa(daraja: Awaited<ReturnType<typeof getMpesa>>, submitted?: MpesaForm) {
    const next: MpesaForm = {
      enabled: daraja.enabled,
      sandbox: daraja.sandbox,
      client_id: daraja.client_id,
      client_secret: daraja.client_secret_hint,
      till_number: daraja.till_number,
      passkey: daraja.passkey_hint,
      stk_type: daraja.stk_type,
    };
    const resolved = submitted ? mergeKeptEdits(mpesaRef.current, submitted, next) : next;
    mpesaRef.current = resolved;
    setMpesa(resolved);
    setSecretStored(Boolean(daraja.client_secret_set));
    setPasskeyStored(Boolean(daraja.passkey_set));
    setSecretHint(daraja.client_secret_set ? daraja.client_secret_hint : "");
    setPassHint(daraja.passkey_set ? daraja.passkey_hint : "");
    setMpesaCallback(daraja.callback_url);
    setKopoCallback(daraja.kopokopo_callback_url);
    const base = daraja.public_base_url || (typeof window !== "undefined" ? window.location.origin : "");
    if (!submitted) {
      baseRef.current = base;
      setPublicBase(base);
      onPublicBase(base);
    }
  }

  function applyKopo(row: Awaited<ReturnType<typeof getKopokopo>>, submitted?: KopoForm) {
    const next: KopoForm = {
      enabled: row.enabled,
      sandbox: row.sandbox,
      client_id: row.client_id,
      client_secret: row.client_secret_hint,
      till_number: row.till_number,
    };
    const resolved = submitted ? mergeKeptEdits(kopoRef.current, submitted, next) : next;
    kopoRef.current = resolved;
    setKopo(resolved);
    setKopoSecretStored(Boolean(row.client_secret_set));
    setKopoHint(row.client_secret_set ? row.client_secret_hint : "");
  }

  async function reload(which?: "mpesa" | "kopo" | "base", submitted?: MpesaForm | KopoForm | string) {
    const [listed, row, daraja] = await Promise.all([listProviders(), getKopokopo(), getMpesa()]);
    setProviders(listed.providers);
    if (which !== "kopo") applyMpesa(daraja, which === "mpesa" ? (submitted as MpesaForm) : undefined);
    else {
      setMpesaCallback(daraja.callback_url);
      setKopoCallback(daraja.kopokopo_callback_url);
    }
    if (which !== "mpesa") applyKopo(row, which === "kopo" ? (submitted as KopoForm) : undefined);
    if (which === "base") {
      const urls = submitted as string;
      baseRef.current = urls;
      setPublicBase(urls);
      onPublicBase(urls);
    }
  }

  useEffect(() => {
    let cancel = false;
    Promise.all([listProviders(), getKopokopo(), getMpesa()])
      .then(([listed, row, daraja]) => {
        if (cancel) return;
        setProviders(listed.providers);
        applyMpesa(daraja);
        applyKopo(row);
      })
      .catch((err) => {
        if (!cancel) setNote({ ok: false, text: safeSettingsError(err, PAYMENT_SAVE_FAIL) });
      });
    return () => {
      cancel = true;
    };
    // Load once when Payment is opened. Later edits stay in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const mpesaComplete = mpesaConfigComplete({
    clientId: mpesa.client_id,
    clientSecret: mpesa.client_secret,
    till: mpesa.till_number,
    passkey: mpesa.passkey,
    secretStored,
    passkeyStored,
  });
  const kopoComplete = kopoConfigComplete({
    clientId: kopo.client_id,
    clientSecret: kopo.client_secret,
    till: kopo.till_number,
    secretStored: kopoSecretStored,
  });
  const mpesaStatus = gatewayStatus({ tested: mpesaTest, complete: mpesaComplete });
  const kopoStatus = gatewayStatus({ tested: kopoTest, complete: kopoComplete });

  const extras = providers.filter((p) => p.kind !== "mpesa" && p.kind !== "kopokopo");
  const nav: { id: string; label: string; status?: string }[] = [
    { id: "mpesa", label: "M-Pesa", status: mpesaStatus.label },
    { id: "kopokopo", label: "Kopo Kopo", status: kopoStatus.label },
    { id: "callbacks", label: "Callbacks" },
    ...extras.map((p) => ({ id: `extra:${p.id}`, label: p.label, status: p.enabled ? "Enabled" : "Disabled" })),
  ];

  function selectGateway(id: string) {
    setGateway(id);
    setNote(null);
  }

  async function saveMpesaForm(e: React.FormEvent) {
    e.preventDefault();
    if (saveLock.current) return;
    setNote(null);
    const submitted = mpesa;
    saveLock.current = true;
    setBusy(true);
    try {
      await saveMpesa({ data: submitted });
      await reload("mpesa", submitted);
      setMpesaTest(null);
      setNote({ ok: true, text: PAYMENT_SAVE_OK });
    } catch (err) {
      setNote({
        ok: false,
        text: safeSettingsError(err, PAYMENT_SAVE_FAIL, [submitted.client_secret, submitted.passkey]),
      });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  async function saveKopoForm(e: React.FormEvent) {
    e.preventDefault();
    if (saveLock.current) return;
    setNote(null);
    const submitted = kopo;
    saveLock.current = true;
    setBusy(true);
    try {
      await saveKopokopo({ data: submitted });
      await reload("kopo", submitted);
      setKopoTest(null);
      setNote({ ok: true, text: PAYMENT_SAVE_OK });
    } catch (err) {
      setNote({
        ok: false,
        text: safeSettingsError(err, PAYMENT_SAVE_FAIL, [submitted.client_secret]),
      });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  async function saveBase(e: React.FormEvent) {
    e.preventDefault();
    if (saveLock.current) return;
    setNote(null);
    saveLock.current = true;
    setBusy(true);
    try {
      const urls = await savePublicBase({ data: { public_base_url: publicBase } });
      setMpesaCallback(urls.mpesa);
      setKopoCallback(urls.kopokopo);
      const next = urls.public_base_url || publicBase;
      baseRef.current = next;
      setPublicBase(next);
      onPublicBase(next);
      setNote({ ok: true, text: PAYMENT_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, PAYMENT_SAVE_FAIL) });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  async function runTest(kind: "mpesa" | "kopo") {
    if (testLock.current || saveLock.current) return;
    setNote(null);
    testLock.current = true;
    setTesting(true);
    try {
      if (kind === "mpesa") {
        await testMpesa();
        setMpesaTest("ok");
      } else {
        await testKopokopo();
        setKopoTest("ok");
      }
      setNote({ ok: true, text: PAYMENT_TEST_OK });
    } catch (err) {
      if (kind === "mpesa") setMpesaTest("fail");
      else setKopoTest("fail");
      const secrets = kind === "mpesa" ? [mpesa.client_secret, mpesa.passkey] : [kopo.client_secret];
      const message = safeSettingsError(err, PAYMENT_TEST_FAIL, secrets);
      setNote({ ok: false, text: message === PAYMENT_TEST_FAIL ? message : message });
    } finally {
      testLock.current = false;
      setTesting(false);
    }
  }

  async function toggleExtra(row: ProviderRow) {
    if (saveLock.current) return;
    setNote(null);
    saveLock.current = true;
    setBusy(true);
    try {
      await toggleProvider({ data: { id: row.id, enabled: !row.enabled } });
      setProviders((list) => list.map((p) => (p.id === row.id ? { ...p, enabled: !p.enabled } : p)));
      setNote({ ok: true, text: PAYMENT_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, PAYMENT_SAVE_FAIL) });
    } finally {
      saveLock.current = false;
      setBusy(false);
    }
  }

  const activeExtra = gateway.startsWith("extra:") ? extras.find((p) => `extra:${p.id}` === gateway) : null;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
      <div>
        <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">Available gateways</h2>
        <div role="tablist" aria-label="Available gateways" className="flex snap-x gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
          {nav.map((item) => {
            const active = gateway === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-gateway={item.id}
                className={cn(
                  "flex min-h-11 shrink-0 snap-start flex-col items-start rounded-xl border px-3 py-2 text-left lg:w-full",
                  active ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-elevated",
                )}
                onClick={() => selectGateway(item.id)}
              >
                <span className="text-sm font-medium">
                  <span aria-hidden="true">{active ? "● " : "○ "}</span>
                  {item.label}
                </span>
                {item.status ? <span className="text-xs text-muted">{item.status}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div
        role="tabpanel"
        className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface p-4 md:p-5"
        aria-label="Gateway configuration"
      >
        {gateway === "mpesa" ? (
          <form className="grid gap-3" onSubmit={(e) => void saveMpesaForm(e)}>
            <div>
              <h2 className="font-medium">M-Pesa</h2>
              <p className="text-sm text-muted">Safaricom Daraja STK. Status: {mpesaStatus.label}.</p>
            </div>
            <SettingsCheck label="Enabled" checked={mpesa.enabled} onChange={(v) => { setMpesaTest(null); setMpesa({ ...mpesa, enabled: v }); }} />
            <SettingsCheck label="Sandbox" checked={mpesa.sandbox} onChange={(v) => { setMpesaTest(null); setMpesa({ ...mpesa, sandbox: v }); }} />
            <SettingsField label="STK type" hint="Paybill or till decides the Daraja transaction type.">
              <Select value={mpesa.stk_type} onChange={(e) => setMpesa({ ...mpesa, stk_type: e.target.value })}>
                <option value="paybill">Paybill (CustomerPayBillOnline)</option>
                <option value="till">Till / Buy Goods (CustomerBuyGoodsOnline)</option>
              </Select>
            </SettingsField>
            <SettingsField label="Consumer key" required hint="Daraja app consumer key. Required before this gateway can take payments.">
              <Input value={mpesa.client_id} onChange={(e) => { setMpesaTest(null); setMpesa({ ...mpesa, client_id: e.target.value }); }} />
            </SettingsField>
            <SettingsField label="Consumer secret" required hint="Used to authenticate requests to Safaricom. Leave blank to keep the saved secret.">
              <SecretInput
                value={mpesa.client_secret}
                placeholder={secretHint || "Paste secret"}
                onChange={(client_secret) => { setMpesaTest(null); setMpesa({ ...mpesa, client_secret }); }}
              />
            </SettingsField>
            <SettingsField label="Business short code" required hint="Paybill or till number customers pay to.">
              <Input
                placeholder="Paybill or till"
                value={mpesa.till_number}
                onChange={(e) => { setMpesaTest(null); setMpesa({ ...mpesa, till_number: e.target.value }); }}
              />
            </SettingsField>
            <SettingsField label="Lipa Na M-Pesa passkey" required hint="Daraja passkey for STK push. Leave blank to keep the saved passkey.">
              <SecretInput
                value={mpesa.passkey}
                placeholder={passHint || "Passkey"}
                onChange={(passkey) => { setMpesaTest(null); setMpesa({ ...mpesa, passkey }); }}
              />
            </SettingsField>
            <SettingsField label="Callback URL" hint="Generated from the public site URL. Daraja must be able to reach it.">
              <Input readOnly value={mpesaCallback || "Save the public URL on Callbacks to generate this"} />
            </SettingsField>
            <SettingsStatus note={note} />
            {testing ? <p className="text-sm text-muted">{PAYMENT_TEST_BUSY}</p> : null}
            <div className="flex flex-wrap gap-2">
              <SaveButton busy={busy} label="Save changes" />
              <Button type="button" variant="secondary" disabled={busy || testing} aria-busy={testing} onClick={() => void runTest("mpesa")}>
                {testing ? PAYMENT_TEST_BUSY : "Test connection"}
              </Button>
            </div>
          </form>
        ) : null}

        {gateway === "kopokopo" ? (
          <form className="grid gap-3" onSubmit={(e) => void saveKopoForm(e)}>
            <div>
              <h2 className="font-medium">Kopo Kopo</h2>
              <p className="text-sm text-muted">Incoming payments via Kopo Kopo. Status: {kopoStatus.label}.</p>
            </div>
            <SettingsCheck label="Enabled" checked={kopo.enabled} onChange={(v) => { setKopoTest(null); setKopo({ ...kopo, enabled: v }); }} />
            <SettingsCheck label="Sandbox" checked={kopo.sandbox} onChange={(v) => { setKopoTest(null); setKopo({ ...kopo, sandbox: v }); }} />
            <SettingsField label="Client ID" required hint="Required before this gateway can take payments.">
              <Input value={kopo.client_id} onChange={(e) => { setKopoTest(null); setKopo({ ...kopo, client_id: e.target.value }); }} />
            </SettingsField>
            <SettingsField label="Client secret" required hint="Used to authenticate requests to Kopo Kopo. Leave blank to keep the saved secret.">
              <SecretInput
                value={kopo.client_secret}
                placeholder={kopoHint || "Paste secret"}
                onChange={(client_secret) => { setKopoTest(null); setKopo({ ...kopo, client_secret }); }}
              />
            </SettingsField>
            <SettingsField label="Till number" required hint="Kopo Kopo till or online payments account.">
              <Input
                placeholder="K000000 or 1234567"
                value={kopo.till_number}
                onChange={(e) => { setKopoTest(null); setKopo({ ...kopo, till_number: e.target.value }); }}
              />
            </SettingsField>
            <SettingsField label="Callback URL" hint="Generated from the public site URL.">
              <Input readOnly value={kopoCallback || "Save the public URL on Callbacks to generate this"} />
            </SettingsField>
            <SettingsStatus note={note} />
            {testing ? <p className="text-sm text-muted">{PAYMENT_TEST_BUSY}</p> : null}
            <div className="flex flex-wrap gap-2">
              <SaveButton busy={busy} label="Save changes" />
              <Button type="button" variant="secondary" disabled={busy || testing} aria-busy={testing} onClick={() => void runTest("kopo")}>
                {testing ? PAYMENT_TEST_BUSY : "Test connection"}
              </Button>
            </div>
          </form>
        ) : null}

        {gateway === "callbacks" ? (
          <form className="grid gap-3" onSubmit={(e) => void saveBase(e)}>
            <div>
              <h2 className="font-medium">Callbacks</h2>
              <p className="text-sm text-muted">
                Public hostname for this ISP. Bootstrap, the customer portal, and payment callbacks use it only after
                platform DNS and HTTPS verification. Until then the central application domain is used.
              </p>
            </div>
            <SettingsField label="Public site URL" optional hint="Must start with https:// when set. Leave blank to keep the central domain.">
              <Input
                placeholder="https://ops.yourisp.co.ke"
                value={publicBase}
                onChange={(e) => setPublicBase(e.target.value)}
              />
            </SettingsField>
            <SettingsField label="M-Pesa Daraja callback">
              <Input readOnly value={mpesaCallback || "Save the public URL to generate this"} />
            </SettingsField>
            <SettingsField label="Kopo Kopo callback">
              <Input readOnly value={kopoCallback || "Save the public URL to generate this"} />
            </SettingsField>
            <SettingsStatus note={note} />
            <SaveButton busy={busy} label="Save changes" />
          </form>
        ) : null}

        {activeExtra ? (
          <div className="grid gap-3">
            <div>
              <h2 className="font-medium">{activeExtra.label}</h2>
              <p className="text-sm text-muted">
                {activeExtra.kind} · {activeExtra.sandbox ? "sandbox" : "live"} · {activeExtra.enabled ? "Enabled" : "Disabled"}
              </p>
            </div>
            <p className="text-sm text-muted">This provider has no extra credential form. Enable or disable it here.</p>
            <SettingsStatus note={note} />
            <Button type="button" disabled={busy} aria-busy={busy} onClick={() => void toggleExtra(activeExtra)}>
              {busy ? "Saving…" : activeExtra.enabled ? "Disable" : "Enable"}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { mergeKeptEdits } from "@/lib/isp/company-info-tabs";
import {
  EMAIL_SAVE_FAIL,
  EMAIL_SAVE_OK,
  WHATSAPP_SAVE_FAIL,
  WHATSAPP_SAVE_OK,
  safeSettingsError,
  type GatewayTestState,
} from "@/lib/isp/settings-feedback";
import { getMessaging, saveMessaging, saveSmsGateway, testMessaging, testSmsConnection } from "@/lib/isp/server-ops";
import {
  emptyGateway,
  EXISTING_SMS_GATEWAYS,
  gatewayConfigured,
  isSmsGatewayId,
  NEW_SMS_GATEWAYS,
  SMS_GATEWAY_SAVE_FAIL,
  SMS_GATEWAY_SAVE_OK,
  SMS_SEND_FAIL,
  SMS_SEND_OK,
  SMS_TEST_BUSY,
  SMS_TEST_FAIL,
  SMS_TEST_OK,
  smsGatewayFields,
  smsGatewayLabel,
  smsGatewayNote,
  type PublicSmsGateway,
  type SmsGatewayConfig,
  type SmsGatewayId,
} from "@/lib/isp/sms-gateways";
import { cn } from "@/lib/utils";
import {
  SaveButton,
  SecretInput,
  SettingsCheck,
  SettingsField,
  SettingsStatus,
  SettingsSubnav,
  type SettingsNote,
} from "@/components/isp/settings-ui";

type Channel = "sms" | "whatsapp" | "email";

type MsgForm = {
  payment_sms: boolean;
  payment_whatsapp: boolean;
  billing_sms: boolean;
  billing_whatsapp: boolean;
  sms_provider: string;
  sms_sender_id: string;
  sms_username: string;
  sms_api_key: string;
  sms_sandbox: boolean;
  wa_provider: string;
  wa_phone_id: string;
  wa_access_token: string;
  wa_business_id: string;
  wa_sandbox: boolean;
  payment_email: boolean;
  billing_email: boolean;
  email_provider: string;
  email_from_name: string;
  email_from_address: string;
  email_reply_to: string;
  email_api_key: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_secure: boolean;
  email_sandbox: boolean;
};

const EMPTY: MsgForm = {
  payment_sms: true,
  payment_whatsapp: true,
  billing_sms: true,
  billing_whatsapp: false,
  sms_provider: "africastalking",
  sms_sender_id: "",
  sms_username: "",
  sms_api_key: "",
  sms_sandbox: true,
  wa_provider: "meta",
  wa_phone_id: "",
  wa_access_token: "",
  wa_business_id: "",
  wa_sandbox: true,
  payment_email: true,
  billing_email: true,
  email_provider: "resend",
  email_from_name: "",
  email_from_address: "",
  email_reply_to: "",
  email_api_key: "",
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_secure: false,
  email_sandbox: true,
};

function publicToDraft(row: PublicSmsGateway): SmsGatewayConfig {
  return {
    auth: row.auth === "password" ? "password" : "apikey",
    apiKey: "",
    token: "",
    password: "",
    userId: row.userId,
    partnerId: row.partnerId,
    senderId: row.senderId,
    messageType: row.messageType,
  };
}

function sameConfig(a: SmsGatewayConfig, b: SmsGatewayConfig) {
  return (
    a.auth === b.auth &&
    a.apiKey === b.apiKey &&
    a.token === b.token &&
    a.password === b.password &&
    a.userId === b.userId &&
    a.partnerId === b.partnerId &&
    a.senderId === b.senderId &&
    a.messageType === b.messageType
  );
}

function draftReady(id: SmsGatewayId, draft: SmsGatewayConfig, row?: PublicSmsGateway) {
  return gatewayConfigured(id, {
    ...draft,
    apiKey: draft.apiKey.trim() || (row?.apiKeySet ? "stored" : ""),
    token: draft.token.trim() || (row?.tokenSet ? "stored" : ""),
    password: draft.password.trim() || (row?.passwordSet ? "stored" : ""),
  });
}

function secretPlaceholder(field: "apiKey" | "token" | "password", row?: PublicSmsGateway) {
  if (!row) return "";
  if (field === "apiKey") return row.apiKeySet ? row.apiKeyHint : "";
  if (field === "token") return row.tokenSet ? row.tokenHint : "";
  return row.passwordSet ? row.passwordHint : "";
}

function smsStatusLabel(configured: boolean, tested: GatewayTestState) {
  if (tested === "ok") return "Connected";
  if (tested === "fail") return "Connection failed";
  return configured ? "Configured" : "Not configured";
}

export function CommunicationsSettings({ supportPhone, supportEmail }: { supportPhone: string; supportEmail: string }) {
  const [section, setSection] = useState<Channel>("sms");
  const [msg, setMsg] = useState<MsgForm>(EMPTY);
  const [waHint, setWaHint] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [smtpHint, setSmtpHint] = useState("");
  const [testPhone, setTestPhone] = useState(supportPhone);
  const [testEmail, setTestEmail] = useState(supportEmail);
  const [testMessage, setTestMessage] = useState("");
  const [testOut, setTestOut] = useState<SettingsNote>(null);
  const [connOut, setConnOut] = useState<SettingsNote>(null);
  const [note, setNote] = useState<SettingsNote>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [probing, setProbing] = useState(false);
  const [gateways, setGateways] = useState<PublicSmsGateway[]>([]);
  const [drafts, setDrafts] = useState<Partial<Record<SmsGatewayId, SmsGatewayConfig>>>({});
  const [baselines, setBaselines] = useState<Partial<Record<SmsGatewayId, SmsGatewayConfig>>>({});
  const [selected, setSelected] = useState<SmsGatewayId>("hostpinnacle");
  const [defaultId, setDefaultId] = useState("africastalking");
  const [makeDefault, setMakeDefault] = useState(false);
  const [tested, setTested] = useState<Partial<Record<SmsGatewayId, GatewayTestState>>>({});
  const [pendingSwitch, setPendingSwitch] = useState<SmsGatewayId | null>(null);
  const lock = useRef(false);
  const testLock = useRef(false);
  const msgRef = useRef(msg);
  const savedMsg = useRef<MsgForm>(EMPTY);
  const draftsRef = useRef(drafts);
  const baselinesRef = useRef(baselines);
  const picked = useRef(false);
  msgRef.current = msg;
  draftsRef.current = drafts;
  baselinesRef.current = baselines;

  useEffect(() => {
    if (!testPhone && supportPhone) setTestPhone(supportPhone);
  }, [supportPhone, testPhone]);
  useEffect(() => {
    if (!testEmail && supportEmail) setTestEmail(supportEmail);
  }, [supportEmail, testEmail]);

  function adoptGateways(list: PublicSmsGateway[], def: string) {
    const nextDrafts = { ...draftsRef.current };
    const nextBase = { ...baselinesRef.current };
    for (const row of list) {
      const base = publicToDraft(row);
      const previous = nextBase[row.id] || base;
      const current = nextDrafts[row.id] || previous;
      nextDrafts[row.id] = sameConfig(current, previous) ? base : current;
      nextBase[row.id] = base;
    }
    draftsRef.current = nextDrafts;
    baselinesRef.current = nextBase;
    setDrafts(nextDrafts);
    setBaselines(nextBase);
    setGateways(list);
    setDefaultId(def);
    if (!picked.current && isSmsGatewayId(def)) setSelected(def);
  }

  async function load() {
    const m = await getMessaging();
    const next: MsgForm = {
      payment_sms: m.payment_sms,
      payment_whatsapp: m.payment_whatsapp,
      billing_sms: m.billing_sms,
      billing_whatsapp: m.billing_whatsapp,
      sms_provider: m.sms_provider,
      sms_sender_id: m.sms_sender_id,
      sms_username: m.sms_username,
      sms_api_key: m.sms_api_key_hint,
      sms_sandbox: m.sms_sandbox,
      wa_provider: m.wa_provider,
      wa_phone_id: m.wa_phone_id,
      wa_access_token: m.wa_token_hint,
      wa_business_id: m.wa_business_id,
      wa_sandbox: m.wa_sandbox,
      payment_email: m.payment_email,
      billing_email: m.billing_email,
      email_provider: m.email_provider,
      email_from_name: m.email_from_name,
      email_from_address: m.email_from_address,
      email_reply_to: m.email_reply_to,
      email_api_key: m.email_api_key_hint,
      smtp_host: m.smtp_host,
      smtp_port: m.smtp_port,
      smtp_username: m.smtp_username,
      smtp_password: m.smtp_password_hint,
      smtp_secure: m.smtp_secure,
      email_sandbox: m.email_sandbox,
    };
    const resolved = mergeKeptEdits(msgRef.current, savedMsg.current, next);
    savedMsg.current = next;
    msgRef.current = resolved;
    setMsg(resolved);
    adoptGateways(m.sms_gateways || [], m.default_sms_gateway || m.sms_provider);
    setWaHint(m.wa_token_set ? m.wa_token_hint : "");
    setEmailHint(m.email_api_key_set ? m.email_api_key_hint : "");
    setSmtpHint(m.smtp_password_set ? m.smtp_password_hint : "");
  }

  useEffect(() => {
    load().catch((err) => setNote({ ok: false, text: safeSettingsError(err, SMS_GATEWAY_SAVE_FAIL) }));
    // Load once when Communications opens. Later edits stay in this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedRow = gateways.find((row) => row.id === selected);
  const draft = drafts[selected] || emptyGateway(selected);
  const baseline = baselines[selected] || emptyGateway(selected);
  const ready = draftReady(selected, draft, selectedRow);
  const fields = smsGatewayFields(selected, draft);
  const gatewayDirty = !sameConfig(draft, baseline) || (makeDefault && defaultId !== selected);
  const channelsDirty =
    msg.payment_sms !== savedMsg.current.payment_sms ||
    msg.billing_sms !== savedMsg.current.billing_sms ||
    msg.sms_sandbox !== savedMsg.current.sms_sandbox;

  function patchDraft(patch: Partial<SmsGatewayConfig>) {
    setDrafts((prev) => {
      const next = { ...prev, [selected]: { ...(prev[selected] || emptyGateway(selected)), ...patch } };
      draftsRef.current = next;
      return next;
    });
    setTested((prev) => ({ ...prev, [selected]: null }));
    setConnOut(null);
  }

  function gatewaySecrets() {
    return [draft.apiKey, draft.token, draft.password];
  }

  async function saveGateway(id: SmsGatewayId = selected) {
    if (lock.current) return false;
    setNote(null);
    const current = draftsRef.current[id] || emptyGateway(id);
    const row = gateways.find((item) => item.id === id);
    if (id === "bytewave") {
      setNote({ ok: false, text: "Bytewave cannot be saved until its API contract is verified." });
      return false;
    }
    const wantsDefault = id === selected ? makeDefault || defaultId === id : defaultId === id;
    const dirty = !sameConfig(current, baselinesRef.current[id] || emptyGateway(id)) || (id === selected && makeDefault && defaultId !== id);
    if (!draftReady(id, current, row) && (dirty || wantsDefault)) {
      setNote({ ok: false, text: "Enter the required fields for this gateway." });
      return false;
    }
    if (id === "talksasa" && current.senderId.trim().length > 11) {
      setNote({ ok: false, text: "Talksasa sender ID must be 11 characters or fewer." });
      return false;
    }
    lock.current = true;
    setBusy(true);
    try {
      if (draftReady(id, current, row)) {
        await saveSmsGateway({
          data: {
            id,
            config: current,
            makeDefault: wantsDefault,
            payment_sms: msgRef.current.payment_sms,
            billing_sms: msgRef.current.billing_sms,
            sms_sandbox: msgRef.current.sms_sandbox,
          },
        });
      } else {
        await saveMessaging({
          data: {
            payment_sms: msgRef.current.payment_sms,
            billing_sms: msgRef.current.billing_sms,
            sms_sandbox: msgRef.current.sms_sandbox,
          },
        });
      }
      setMakeDefault(false);
      await load();
      setNote({ ok: true, text: SMS_GATEWAY_SAVE_OK });
      return true;
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, SMS_GATEWAY_SAVE_FAIL, gatewaySecrets()) });
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  function discardGateway(id: SmsGatewayId) {
    const base = baselinesRef.current[id] || emptyGateway(id);
    const next = { ...draftsRef.current, [id]: base };
    draftsRef.current = next;
    setDrafts(next);
    setMakeDefault(false);
    const restored = savedMsg.current;
    msgRef.current = restored;
    setMsg(restored);
  }

  function requestSwitch(id: SmsGatewayId) {
    if (id === selected) return;
    picked.current = true;
    if (gatewayDirty || channelsDirty) {
      setPendingSwitch(id);
      return;
    }
    setSelected(id);
    setMakeDefault(false);
    setNote(null);
    setConnOut(null);
  }

  async function saveWhatsApp(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    setNote(null);
    if (!msg.wa_sandbox && !msg.wa_phone_id.trim()) {
      setNote({ ok: false, text: "Enter the Meta phone number ID, or keep sandbox on." });
      return;
    }
    if (!msg.wa_sandbox && !msg.wa_access_token.trim() && !waHint) {
      setNote({ ok: false, text: "Enter an access token, or keep sandbox on until you go live." });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await saveMessaging({
        data: {
          payment_whatsapp: msg.payment_whatsapp,
          billing_whatsapp: msg.billing_whatsapp,
          wa_provider: msg.wa_provider || "meta",
          wa_phone_id: msg.wa_phone_id.trim(),
          wa_business_id: msg.wa_business_id.trim(),
          wa_access_token: msg.wa_access_token,
          wa_sandbox: msg.wa_sandbox,
        },
      });
      await load();
      setNote({ ok: true, text: WHATSAPP_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, WHATSAPP_SAVE_FAIL, [msg.wa_access_token]) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function saveEmail(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    setNote(null);
    const from = msg.email_from_address.trim();
    if (!msg.email_sandbox && !from) {
      setNote({ ok: false, text: "Enter this ISP's from address, or keep sandbox on." });
      return;
    }
    if (msg.email_provider === "resend" && !msg.email_sandbox && !msg.email_api_key.trim() && !emailHint) {
      setNote({ ok: false, text: "Enter a Resend API key, or keep sandbox on until you go live." });
      return;
    }
    if (msg.email_provider === "smtp" && !msg.email_sandbox && !msg.smtp_host.trim()) {
      setNote({ ok: false, text: "Enter the SMTP host, or keep sandbox on." });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await saveMessaging({
        data: {
          payment_email: msg.payment_email,
          billing_email: msg.billing_email,
          email_provider: msg.email_provider,
          email_from_name: msg.email_from_name.trim(),
          email_from_address: from,
          email_reply_to: msg.email_reply_to.trim(),
          email_api_key: msg.email_api_key,
          smtp_host: msg.smtp_host.trim(),
          smtp_port: Number(msg.smtp_port) || 587,
          smtp_username: msg.smtp_username.trim(),
          smtp_password: msg.smtp_password,
          smtp_secure: msg.smtp_secure,
          email_sandbox: msg.email_sandbox,
        },
      });
      await load();
      setNote({ ok: true, text: EMAIL_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, EMAIL_SAVE_FAIL, [msg.email_api_key, msg.smtp_password]) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function runTest(channel: Channel) {
    if (testLock.current) return;
    setTestOut(null);
    testLock.current = true;
    setTesting(true);
    try {
      if (channel === "email") {
        const r = await testMessaging({ data: { channel: "email", email: testEmail } });
        setTestOut({ ok: r.status !== "failed", text: `Email ${r.status} · ${r.detail}` });
      } else if (channel === "whatsapp") {
        const r = await testMessaging({ data: { channel: "whatsapp", phone: testPhone } });
        setTestOut({ ok: r.status !== "failed", text: `WhatsApp ${r.status} · ${r.detail}` });
      } else {
        const r = await testMessaging({ data: { channel: "sms", phone: testPhone, message: testMessage } });
        if (r.status === "sent") setTestOut({ ok: true, text: SMS_SEND_OK });
        else if (r.status === "sandbox") setTestOut({ ok: false, text: "Not sent. SMS sandbox is on, so no message was delivered." });
        else setTestOut({ ok: false, text: SMS_SEND_FAIL });
      }
    } catch (err) {
      setTestOut({ ok: false, text: safeSettingsError(err, channel === "sms" ? SMS_SEND_FAIL : "Test failed. Check the gateway configuration.", gatewaySecrets()) });
    } finally {
      testLock.current = false;
      setTesting(false);
    }
  }

  async function runConnectionTest() {
    if (testLock.current || selected === "bytewave" || !ready) return;
    setConnOut(null);
    testLock.current = true;
    setProbing(true);
    try {
      const r = await testSmsConnection({ data: { id: selected, config: draft } });
      setTested((prev) => ({ ...prev, [selected]: r.ok ? "ok" : "fail" }));
      setConnOut({ ok: r.ok, text: r.ok ? SMS_TEST_OK : r.detail || SMS_TEST_FAIL });
    } catch (err) {
      setTested((prev) => ({ ...prev, [selected]: "fail" }));
      setConnOut({ ok: false, text: safeSettingsError(err, SMS_TEST_FAIL, gatewaySecrets()) });
    } finally {
      testLock.current = false;
      setProbing(false);
    }
  }

  const waTokenRequired = !msg.wa_sandbox && !waHint;
  const emailFromRequired = !msg.email_sandbox;
  const resendKeyRequired = msg.email_provider === "resend" && !msg.email_sandbox && !emailHint;
  const smtpHostRequired = msg.email_provider === "smtp" && !msg.email_sandbox;
  const title = smsGatewayLabel(selected);
  const heading = title.endsWith("SMS") || title === "TextSMS" ? title : `${title} SMS`;

  function gatewayButton(id: SmsGatewayId, label: string) {
    const row = gateways.find((item) => item.id === id);
    const active = selected === id;
    const configured = row ? draftReady(id, drafts[id] || publicToDraft(row), row) : false;
    const status = smsStatusLabel(configured, tested[id] || null);
    return (
      <button
        key={id}
        type="button"
        role="tab"
        aria-selected={active}
        data-gateway={id}
        className={cn(
          "flex min-h-11 shrink-0 snap-start flex-col items-start rounded-xl border px-3 py-2 text-left lg:w-full",
          active ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-elevated",
        )}
        onClick={() => requestSwitch(id)}
      >
        <span className="text-sm font-medium">
          <span aria-hidden="true">{active ? "● " : "○ "}</span>
          {label}
        </span>
        <span className="text-xs text-muted">{status}</span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <SettingsSubnav
        label="Communications"
        value={section}
        onChange={setSection}
        tabs={[
          { id: "sms", label: "SMS" },
          { id: "whatsapp", label: "WhatsApp" },
          { id: "email", label: "Email" },
        ]}
      />

      {section === "sms" ? (
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <SettingsCheck label="Payment receipts · SMS" checked={msg.payment_sms} onChange={(v) => setMsg({ ...msg, payment_sms: v })} />
            <SettingsCheck label="Billing reminders · SMS" checked={msg.billing_sms} onChange={(v) => setMsg({ ...msg, billing_sms: v })} />
          </div>
          <SettingsCheck
            label="SMS sandbox (log only, do not hit live API)"
            checked={msg.sms_sandbox}
            onChange={(v) => setMsg({ ...msg, sms_sandbox: v })}
          />
          <div className="grid items-start gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
            <div>
              <h2 className="mb-2 text-xs font-medium tracking-wide text-muted uppercase">SMS gateways</h2>
              <div role="tablist" aria-label="SMS gateways" className="flex snap-x gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                {NEW_SMS_GATEWAYS.map((gateway) => gatewayButton(gateway.id, gateway.label))}
              </div>
              <h3 className="mt-4 mb-2 text-xs font-medium tracking-wide text-muted uppercase">Existing gateways</h3>
              <div role="tablist" aria-label="Existing SMS gateways" className="flex snap-x gap-2 overflow-x-auto lg:flex-col lg:overflow-visible">
                {EXISTING_SMS_GATEWAYS.map((gateway) => gatewayButton(gateway.id, gateway.label))}
              </div>
            </div>
            <form
              role="tabpanel"
              aria-label="SMS gateway configuration"
              className="grid min-w-0 gap-3 rounded-xl border border-border bg-surface p-4 md:p-5"
              onSubmit={(e) => {
                e.preventDefault();
                void saveGateway(selected);
              }}
            >
              <div>
                <h2 className="font-medium">{heading}</h2>
                <p className="text-sm text-muted">{smsGatewayNote(selected)}</p>
                <p className="text-xs text-muted">Status: {smsStatusLabel(ready, tested[selected] || null)}.</p>
              </div>
              {selected === "hostpinnacle" ? (
                <fieldset className="grid gap-2">
                  <legend className="text-sm font-medium">Authentication method</legend>
                  <label className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
                    <input type="radio" name="hostpinnacle-auth" checked={draft.auth !== "password"} onChange={() => patchDraft({ auth: "apikey" })} />
                    API Key
                  </label>
                  <label className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
                    <input type="radio" name="hostpinnacle-auth" checked={draft.auth === "password"} onChange={() => patchDraft({ auth: "password" })} />
                    Username & Password
                  </label>
                </fieldset>
              ) : null}
              {fields.map((field) => (
                <SettingsField key={field.key} label={field.label} required={field.required} optional={!field.required && !field.options} hint={field.hint}>
                  {field.options ? (
                    <Select value={draft[field.key] || field.options[0]?.value || ""} onChange={(e) => patchDraft({ [field.key]: e.target.value })}>
                      {field.options.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  ) : field.secret ? (
                    <SecretInput
                      value={draft[field.key]}
                      placeholder={secretPlaceholder(field.key as "apiKey" | "token" | "password", selectedRow) || "Paste secret"}
                      onChange={(value) => patchDraft({ [field.key]: value })}
                    />
                  ) : (
                    <Input value={draft[field.key]} onChange={(e) => patchDraft({ [field.key]: e.target.value })} />
                  )}
                </SettingsField>
              ))}
              <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
                <input
                  type="checkbox"
                  checked={defaultId === selected || makeDefault}
                  disabled={!ready}
                  onChange={(e) => setMakeDefault(e.target.checked && defaultId !== selected)}
                />
                Default SMS gateway
              </label>
              {!ready ? <p className="text-xs text-muted">Only a configured gateway can be the default.</p> : null}
              <SettingsStatus note={note} />
              {selected === "bytewave" ? (
                <Button type="button" disabled>
                  Save changes
                </Button>
              ) : (
                <SaveButton busy={busy} label="Save changes" />
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="secondary" disabled={probing || testing || !ready || selected === "bytewave"} aria-busy={probing} onClick={() => void runConnectionTest()}>
                  {probing ? SMS_TEST_BUSY : "Test connection"}
                </Button>
              </div>
              {probing ? <p className="text-sm text-muted">{SMS_TEST_BUSY}</p> : null}
              <SettingsStatus note={connOut} />
              <h3 className="mt-2 text-sm font-medium">Send Test SMS</h3>
              <SettingsField label="Test phone number" required>
                <Input placeholder="+2547…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
              </SettingsField>
              <SettingsField label="Test message" optional hint="Leave blank to send the standard test text. Maximum 320 characters.">
                <Textarea value={testMessage} maxLength={320} onChange={(e) => setTestMessage(e.target.value)} />
              </SettingsField>
              <Button type="button" variant="secondary" disabled={testing} aria-busy={testing} onClick={() => void runTest("sms")}>
                {testing ? "Sending…" : "Send Test SMS"}
              </Button>
              <SettingsStatus note={testOut} />
            </form>
          </div>
          {pendingSwitch ? (
            <div role="alertdialog" aria-label="Unsaved changes" className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4">
              <div>
                <p className="font-medium">Unsaved changes</p>
                <p className="text-sm text-muted">
                  You have unsaved changes to {smsGatewayLabel(selected)}. Do you want to save before switching?
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void saveGateway(selected).then((ok) => {
                      if (!ok || !pendingSwitch) return;
                      setSelected(pendingSwitch);
                      setPendingSwitch(null);
                      setMakeDefault(false);
                    });
                  }}
                >
                  Save changes
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    discardGateway(selected);
                    setSelected(pendingSwitch);
                    setPendingSwitch(null);
                    setNote(null);
                    setConnOut(null);
                  }}
                >
                  Discard
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPendingSwitch(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {section === "whatsapp" ? (
        <form className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" onSubmit={(e) => void saveWhatsApp(e)}>
          <div>
            <h2 className="font-medium">WhatsApp</h2>
            <p className="text-sm text-muted">Meta Cloud API for payment receipts and billing reminders.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SettingsCheck label="Payment receipts · WhatsApp" checked={msg.payment_whatsapp} onChange={(v) => setMsg({ ...msg, payment_whatsapp: v })} />
            <SettingsCheck label="Billing reminders · WhatsApp" checked={msg.billing_whatsapp} onChange={(v) => setMsg({ ...msg, billing_whatsapp: v })} />
          </div>
          <SettingsField label="Phone number ID" required={!msg.wa_sandbox} optional={msg.wa_sandbox} hint="Meta phone number ID.">
            <Input placeholder="Meta phone number ID" value={msg.wa_phone_id} onChange={(e) => setMsg({ ...msg, wa_phone_id: e.target.value })} />
          </SettingsField>
          <SettingsField label="WhatsApp Business Account ID" optional>
            <Input value={msg.wa_business_id} onChange={(e) => setMsg({ ...msg, wa_business_id: e.target.value })} />
          </SettingsField>
          <SettingsField label="Access token" required={waTokenRequired} optional={!waTokenRequired} hint="Meta access token. Leave blank to keep the saved token.">
            <SecretInput
              value={msg.wa_access_token}
              placeholder={waHint || "Paste token"}
              onChange={(wa_access_token) => setMsg({ ...msg, wa_access_token })}
            />
          </SettingsField>
          <SettingsCheck
            label="WhatsApp sandbox (log only until go-live)"
            checked={msg.wa_sandbox}
            onChange={(v) => setMsg({ ...msg, wa_sandbox: v })}
          />
          <SettingsStatus note={note} />
          <SaveButton busy={busy} label="Save changes" />
          <h3 className="mt-2 text-sm font-medium">Send a test WhatsApp</h3>
          <SettingsField label="Phone" optional>
            <Input placeholder="+2547…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          </SettingsField>
          <Button type="button" variant="secondary" disabled={testing} aria-busy={testing} onClick={() => void runTest("whatsapp")}>
            {testing ? "Testing…" : "Test WhatsApp"}
          </Button>
          <SettingsStatus note={testOut} />
        </form>
      ) : null}

      {section === "email" ? (
        <form className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" onSubmit={(e) => void saveEmail(e)}>
          <div>
            <h2 className="font-medium">Email</h2>
            <p className="text-sm text-muted">
              This ISP’s own from address and credentials. Receipts, billing reminders, invoice PDFs, and staff campaigns never use another ISP’s mailbox.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SettingsCheck label="Payment receipts · Email" checked={msg.payment_email} onChange={(v) => setMsg({ ...msg, payment_email: v })} />
            <SettingsCheck label="Billing reminders · Email" checked={msg.billing_email} onChange={(v) => setMsg({ ...msg, billing_email: v })} />
          </div>
          <SettingsField label="Provider" required>
            <Select value={msg.email_provider} onChange={(e) => setMsg({ ...msg, email_provider: e.target.value })}>
              <option value="resend">Resend</option>
              <option value="smtp">SMTP (VPS / Google / Zoho)</option>
            </Select>
          </SettingsField>
          <SettingsField label="From name" optional>
            <Input placeholder="Imani Networks" value={msg.email_from_name} onChange={(e) => setMsg({ ...msg, email_from_name: e.target.value })} />
          </SettingsField>
          <SettingsField label="From address" required={emailFromRequired} optional={!emailFromRequired}>
            <Input type="email" placeholder="billing@yourisp.co.ke" value={msg.email_from_address} onChange={(e) => setMsg({ ...msg, email_from_address: e.target.value })} />
          </SettingsField>
          <SettingsField label="Reply-to" optional>
            <Input type="email" placeholder="support@yourisp.co.ke" value={msg.email_reply_to} onChange={(e) => setMsg({ ...msg, email_reply_to: e.target.value })} />
          </SettingsField>
          {msg.email_provider === "resend" ? (
            <SettingsField label="Resend API key" required={resendKeyRequired} optional={!resendKeyRequired} hint="Leave blank to keep the saved key.">
              <SecretInput
                value={msg.email_api_key}
                placeholder={emailHint || "re_…"}
                onChange={(email_api_key) => setMsg({ ...msg, email_api_key })}
              />
            </SettingsField>
          ) : (
            <>
              <SettingsField label="SMTP host" required={smtpHostRequired} optional={!smtpHostRequired}>
                <Input placeholder="smtp.gmail.com or 127.0.0.1" value={msg.smtp_host} onChange={(e) => setMsg({ ...msg, smtp_host: e.target.value })} />
              </SettingsField>
              <div className="grid gap-3 sm:grid-cols-2">
                <SettingsField label="Port">
                  <Input type="number" min={1} max={65535} value={msg.smtp_port} onChange={(e) => setMsg({ ...msg, smtp_port: Number(e.target.value) || 587 })} />
                </SettingsField>
                <SettingsCheck label="TLS on connect (465)" checked={msg.smtp_secure} onChange={(v) => setMsg({ ...msg, smtp_secure: v })} />
              </div>
              <SettingsField label="SMTP username" optional>
                <Input value={msg.smtp_username} onChange={(e) => setMsg({ ...msg, smtp_username: e.target.value })} />
              </SettingsField>
              <SettingsField label="SMTP password" optional hint="Leave blank to keep the saved password.">
                <SecretInput
                  value={msg.smtp_password}
                  placeholder={smtpHint || "App password"}
                  onChange={(smtp_password) => setMsg({ ...msg, smtp_password })}
                />
              </SettingsField>
            </>
          )}
          <SettingsCheck
            label="Email sandbox (log only, do not send live)"
            checked={msg.email_sandbox}
            onChange={(v) => setMsg({ ...msg, email_sandbox: v })}
          />
          <SettingsStatus note={note} />
          <SaveButton busy={busy} label="Save changes" />
          <h3 className="mt-2 text-sm font-medium">Send a test email</h3>
          <SettingsField label="Email" optional>
            <Input type="email" placeholder="you@example.com" value={testEmail} onChange={(e) => setTestEmail(e.target.value)} />
          </SettingsField>
          <Button type="button" variant="secondary" disabled={testing} aria-busy={testing} onClick={() => void runTest("email")}>
            {testing ? "Testing…" : "Test email"}
          </Button>
          <SettingsStatus note={testOut} />
        </form>
      ) : null}
    </div>
  );
}

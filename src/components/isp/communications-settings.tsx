import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { mergeKeptEdits } from "@/lib/isp/company-info-tabs";
import {
  EMAIL_SAVE_FAIL,
  EMAIL_SAVE_OK,
  SMS_SAVE_FAIL,
  SMS_SAVE_OK,
  WHATSAPP_SAVE_FAIL,
  WHATSAPP_SAVE_OK,
  safeSettingsError,
} from "@/lib/isp/settings-feedback";
import { checkSmsAccount, getMessaging, saveMessaging, testMessaging } from "@/lib/isp/server-ops";
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

export function CommunicationsSettings({ supportPhone, supportEmail }: { supportPhone: string; supportEmail: string }) {
  const [section, setSection] = useState<Channel>("sms");
  const [msg, setMsg] = useState<MsgForm>(EMPTY);
  const [smsHint, setSmsHint] = useState("");
  const [waHint, setWaHint] = useState("");
  const [emailHint, setEmailHint] = useState("");
  const [smtpHint, setSmtpHint] = useState("");
  const [testPhone, setTestPhone] = useState(supportPhone);
  const [testEmail, setTestEmail] = useState(supportEmail);
  const [testOut, setTestOut] = useState<SettingsNote>(null);
  const [note, setNote] = useState<SettingsNote>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const lock = useRef(false);
  const testLock = useRef(false);
  const msgRef = useRef(msg);
  const savedMsg = useRef<MsgForm>(EMPTY);
  msgRef.current = msg;

  useEffect(() => {
    if (!testPhone && supportPhone) setTestPhone(supportPhone);
  }, [supportPhone, testPhone]);
  useEffect(() => {
    if (!testEmail && supportEmail) setTestEmail(supportEmail);
  }, [supportEmail, testEmail]);

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
    setSmsHint(m.sms_api_key_set ? m.sms_api_key_hint : "");
    setWaHint(m.wa_token_set ? m.wa_token_hint : "");
    setEmailHint(m.email_api_key_set ? m.email_api_key_hint : "");
    setSmtpHint(m.smtp_password_set ? m.smtp_password_hint : "");
  }

  useEffect(() => {
    load().catch((err) => setNote({ ok: false, text: safeSettingsError(err, SMS_SAVE_FAIL) }));
  }, []);

  async function saveSms(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current) return;
    setNote(null);
    const sender = msg.sms_sender_id.trim();
    if (!msg.sms_provider) {
      setNote({ ok: false, text: "Choose an SMS provider." });
      return;
    }
    if (msg.sms_provider === "talksasa" && sender.length > 11) {
      setNote({ ok: false, text: "Talksasa sender ID must be 11 characters or fewer." });
      return;
    }
    if (!msg.sms_sandbox && !msg.sms_api_key.trim() && !smsHint) {
      setNote({ ok: false, text: "Enter an API key, or keep sandbox on until you go live." });
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      await saveMessaging({
        data: {
          payment_sms: msg.payment_sms,
          billing_sms: msg.billing_sms,
          sms_provider: msg.sms_provider,
          sms_sender_id: sender,
          sms_username: msg.sms_username.trim(),
          sms_api_key: msg.sms_api_key,
          sms_sandbox: msg.sms_sandbox,
        },
      });
      await load();
      setNote({ ok: true, text: SMS_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: safeSettingsError(err, SMS_SAVE_FAIL, [msg.sms_api_key]) });
    } finally {
      lock.current = false;
      setBusy(false);
    }
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
        const r = await testMessaging({ data: { channel: "sms", phone: testPhone } });
        setTestOut({ ok: r.status !== "failed", text: `SMS ${r.status} · ${r.detail}` });
      }
    } catch (err) {
      setTestOut({ ok: false, text: safeSettingsError(err, "Test failed. Check the gateway configuration.") });
    } finally {
      testLock.current = false;
      setTesting(false);
    }
  }

  const smsKeyRequired = !msg.sms_sandbox && !smsHint;
  const waTokenRequired = !msg.wa_sandbox && !waHint;
  const emailFromRequired = !msg.email_sandbox;
  const resendKeyRequired = msg.email_provider === "resend" && !msg.email_sandbox && !emailHint;
  const smtpHostRequired = msg.email_provider === "smtp" && !msg.email_sandbox;

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
        <form className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" onSubmit={(e) => void saveSms(e)}>
          <div>
            <h2 className="font-medium">SMS</h2>
            <p className="text-sm text-muted">Provider used for receipts, billing reminders, and staff campaigns.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <SettingsCheck label="Payment receipts · SMS" checked={msg.payment_sms} onChange={(v) => setMsg({ ...msg, payment_sms: v })} />
            <SettingsCheck label="Billing reminders · SMS" checked={msg.billing_sms} onChange={(v) => setMsg({ ...msg, billing_sms: v })} />
          </div>
          <SettingsField label="Provider" required>
            <Select value={msg.sms_provider} onChange={(e) => setMsg({ ...msg, sms_provider: e.target.value })}>
              <option value="blessedtexts">Blessed Texts</option>
              <option value="talksasa">Talksasa</option>
              <option value="webfam">Webfam SMS</option>
              <option value="africastalking">Africa's Talking</option>
              <option value="advanta">Advanta SMS</option>
              <option value="twilio">Twilio</option>
            </Select>
          </SettingsField>
          <p className="text-xs text-subtle">
            {msg.sms_provider === "talksasa"
              ? "Talksasa: API token from bulksms.talksasa.com. Sender ID max 11 characters."
              : msg.sms_provider === "blessedtexts"
                ? "Blessed Texts: Partner ID + API key. Sender ID is your approved short name."
                : msg.sms_provider === "webfam"
                  ? "WebfamSMS: Bearer API key (WFK-…). POST /api/v1/sms/send"
                  : msg.sms_provider === "twilio"
                    ? "Twilio: Account SID as username, Auth Token as API key."
                    : "Username / partner ID plus API key from the provider dashboard."}
          </p>
          <SettingsField label="Sender ID" optional hint="Approved short name. Talksasa allows 11 characters.">
            <Input placeholder="ISPSOL" value={msg.sms_sender_id} onChange={(e) => setMsg({ ...msg, sms_sender_id: e.target.value })} />
          </SettingsField>
          <SettingsField
            label={msg.sms_provider === "twilio" ? "Account SID" : "Partner ID / username"}
            optional={msg.sms_provider === "talksasa" || msg.sms_provider === "webfam"}
          >
            <Input value={msg.sms_username} onChange={(e) => setMsg({ ...msg, sms_username: e.target.value })} />
          </SettingsField>
          <SettingsField label="API key" required={smsKeyRequired} optional={!smsKeyRequired} hint="Stored for this ISP only. Shown as a hint after save.">
            <SecretInput
              value={msg.sms_api_key}
              placeholder={smsHint || (msg.sms_provider === "webfam" ? "WFK-…" : "Paste key")}
              onChange={(sms_api_key) => setMsg({ ...msg, sms_api_key })}
            />
          </SettingsField>
          <SettingsCheck
            label="SMS sandbox (log only, do not hit live API)"
            checked={msg.sms_sandbox}
            onChange={(v) => setMsg({ ...msg, sms_sandbox: v })}
          />
          <SettingsStatus note={note} />
          <SaveButton busy={busy} label="Save changes" />
          <h3 className="mt-2 text-sm font-medium">Send a test SMS</h3>
          <SettingsField label="Phone" optional>
            <Input placeholder="+2547…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
          </SettingsField>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={testing} aria-busy={testing} onClick={() => void runTest("sms")}>
              {testing ? "Testing…" : "Test SMS"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={testing}
              onClick={() => {
                if (testLock.current) return;
                testLock.current = true;
                setTesting(true);
                checkSmsAccount()
                  .then((r) => setTestOut({ ok: r.ok, text: `Account ${r.ok ? "ok" : "error"} · ${r.detail}` }))
                  .catch((err) => setTestOut({ ok: false, text: safeSettingsError(err, "Could not check the Webfam balance.") }))
                  .finally(() => {
                    testLock.current = false;
                    setTesting(false);
                  });
              }}
            >
              Check Webfam balance
            </Button>
          </div>
          <SettingsStatus note={testOut} />
        </form>
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

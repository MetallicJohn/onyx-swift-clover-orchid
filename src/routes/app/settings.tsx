import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { getDashboard, renameTenant } from "@/lib/isp/server";
import { getKopokopo, saveKopokopo, testKopokopo } from "@/lib/isp/server-kopo";
import { getMpesa, saveMpesa, savePublicBase, testMpesa } from "@/lib/isp/server-mpesa";
import { checkSmsAccount, getMessaging, listProviders, saveMessaging, testMessaging, toggleProvider, workspaceSlug } from "@/lib/isp/server-ops";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/settings")({ component: SettingsPage });

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
};

const EMPTY_MSG: MsgForm = {
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
};

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function SettingsPage() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [form, setForm] = useState({ name: "", supportEmail: "", supportPhone: "" });
  const [slug, setSlug] = useState("");
  const [providers, setProviders] = useState<{ id: string; kind: string; label: string; enabled: boolean; sandbox: boolean }[]>([]);
  const [msg, setMsg] = useState<MsgForm>(EMPTY_MSG);
  const [smsHint, setSmsHint] = useState("");
  const [waHint, setWaHint] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testOut, setTestOut] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [kopo, setKopo] = useState({
    enabled: true,
    sandbox: true,
    client_id: "",
    client_secret: "",
    till_number: "",
  });
  const [kopoHint, setKopoHint] = useState("");
  const [kopoOut, setKopoOut] = useState<string | null>(null);
  const [mpesa, setMpesa] = useState({
    enabled: true,
    sandbox: true,
    client_id: "",
    client_secret: "",
    till_number: "",
    passkey: "",
    stk_type: "paybill",
  });
  const [mpesaSecretHint, setMpesaSecretHint] = useState("");
  const [mpesaPassHint, setMpesaPassHint] = useState("");
  const [mpesaOut, setMpesaOut] = useState<string | null>(null);
  const [publicBase, setPublicBase] = useState("");
  const [mpesaCallback, setMpesaCallback] = useState("");
  const [kopoCallback, setKopoCallback] = useState("");

  async function load() {
    const [d, s, p, m, k, daraja] = await Promise.all([
      getDashboard(),
      workspaceSlug(),
      listProviders(),
      getMessaging(),
      getKopokopo(),
      getMpesa(),
    ]);
    setWs(d.workspace);
    setSlug(s.slug);
    setProviders(p.providers);
    setForm({
      name: d.workspace.tenantName,
      supportEmail: d.workspace.supportEmail,
      supportPhone: d.workspace.supportPhone,
    });
    setTestPhone(d.workspace.supportPhone || "");
    setMsg({
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
    });
    setSmsHint(m.sms_api_key_set ? m.sms_api_key_hint : "");
    setWaHint(m.wa_token_set ? m.wa_token_hint : "");
    setKopo({
      enabled: k.enabled,
      sandbox: k.sandbox,
      client_id: k.client_id,
      client_secret: k.client_secret_hint,
      till_number: k.till_number,
    });
    setKopoHint(k.client_secret_set ? k.client_secret_hint : "");
    setMpesa({
      enabled: daraja.enabled,
      sandbox: daraja.sandbox,
      client_id: daraja.client_id,
      client_secret: daraja.client_secret_hint,
      till_number: daraja.till_number,
      passkey: daraja.passkey_hint,
      stk_type: daraja.stk_type,
    });
    setMpesaSecretHint(daraja.client_secret_set ? daraja.client_secret_hint : "");
    setMpesaPassHint(daraja.passkey_set ? daraja.passkey_hint : "");
    setPublicBase(daraja.public_base_url || (typeof window !== "undefined" ? window.location.origin : ""));
    setMpesaCallback(daraja.callback_url);
    setKopoCallback(daraja.kopokopo_callback_url);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Tenant branding, payment rails, and customer messaging APIs.</p>
      </div>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          await renameTenant({ data: form });
          await load();
        }}
      >
        <h2 className="font-medium">ISP profile</h2>
        <Field label="ISP name">
          <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <Field label="Support email">
          <Input value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
        </Field>
        <Field label="Support phone">
          <Input value={form.supportPhone} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} />
        </Field>
        <p className="text-xs text-subtle">
          Role: {ws?.role} · Plan: {ws?.status} · Customer portal slug: <span className="font-mono text-fg">{slug}</span>
        </p>
        <Button type="submit">Save</Button>
      </form>

      <section className="max-w-xl space-y-3">
        <h2 className="font-medium">Payment providers</h2>
        {providers.map((p) => (
          <div key={p.id} className="flex items-center justify-between rounded-xl border border-border bg-surface px-4 py-3">
            <div>
              <div className="font-medium">{p.label}</div>
              <div className="text-xs text-muted">
                {p.kind} · {p.sandbox ? "sandbox" : "live"}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={async () => {
                await toggleProvider({ data: { id: p.id, enabled: !p.enabled } });
                await load();
              }}
            >
              {p.enabled ? "Enabled" : "Disabled"}
            </Button>
          </div>
        ))}
        <p className="text-sm text-muted">
          Customers pay at{" "}
          <Link to="/portal" className="text-accent hover:underline">
            /portal
          </Link>{" "}
          using slug <span className="font-mono">{slug}</span>.
        </p>
      </section>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const urls = await savePublicBase({ data: { public_base_url: publicBase } });
          setMpesaCallback(urls.mpesa);
          setKopoCallback(urls.kopokopo);
          setPublicBase(urls.public_base_url);
        }}
      >
        <h2 className="font-medium">Callback URLs</h2>
        <p className="text-sm text-muted">
          Public HTTPS origin Daraja and Kopo Kopo will POST to after STK. Register these exact URLs on the provider
          dashboards.
        </p>
        <Field label="Public site URL">
          <Input
            placeholder="https://ops.yourisp.co.ke"
            value={publicBase}
            onChange={(e) => setPublicBase(e.target.value)}
          />
        </Field>
        <Field label="M-Pesa Daraja callback">
          <Input readOnly value={mpesaCallback || "Save the public URL to generate this"} />
        </Field>
        <Field label="Kopo Kopo callback">
          <Input readOnly value={kopoCallback || "Save the public URL to generate this"} />
        </Field>
        <Button type="submit">Save public URL</Button>
      </form>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setMpesaOut(null);
          await saveMpesa({ data: mpesa });
          setMpesaOut("M-Pesa Daraja saved. STK uses Lipa Na M-Pesa Online.");
          await load();
        }}
      >
        <h2 className="font-medium">M-Pesa Daraja</h2>
        <p className="text-sm text-muted">
          Consumer key/secret and Lipa Na M-Pesa Online passkey from the Safaricom developer portal. Sandbox is
          sandbox.safaricom.co.ke; live is api.safaricom.co.ke.
        </p>
        <Check label="Enabled" checked={mpesa.enabled} onChange={(v) => setMpesa({ ...mpesa, enabled: v })} />
        <Check label="Sandbox" checked={mpesa.sandbox} onChange={(v) => setMpesa({ ...mpesa, sandbox: v })} />
        <Field label="STK type">
          <Select value={mpesa.stk_type} onChange={(e) => setMpesa({ ...mpesa, stk_type: e.target.value })}>
            <option value="paybill">Paybill (CustomerPayBillOnline)</option>
            <option value="till">Till / Buy Goods (CustomerBuyGoodsOnline)</option>
          </Select>
        </Field>
        <Field label="Consumer key">
          <Input value={mpesa.client_id} onChange={(e) => setMpesa({ ...mpesa, client_id: e.target.value })} />
        </Field>
        <Field label="Consumer secret">
          <Input
            type="password"
            autoComplete="off"
            placeholder={mpesaSecretHint || "Paste secret"}
            value={mpesa.client_secret}
            onChange={(e) => setMpesa({ ...mpesa, client_secret: e.target.value })}
          />
        </Field>
        <Field label="Shortcode">
          <Input
            placeholder="Paybill or till"
            value={mpesa.till_number}
            onChange={(e) => setMpesa({ ...mpesa, till_number: e.target.value })}
          />
        </Field>
        <Field label="Lipa Na M-Pesa passkey">
          <Input
            type="password"
            autoComplete="off"
            placeholder={mpesaPassHint || "Passkey"}
            value={mpesa.passkey}
            onChange={(e) => setMpesa({ ...mpesa, passkey: e.target.value })}
          />
        </Field>
        <p className="text-xs text-subtle">
          STK CallBackURL: <span className="font-mono text-fg">{mpesaCallback || "set public URL above"}</span>
        </p>
        {mpesaOut ? <p className="text-sm text-accent">{mpesaOut}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Save M-Pesa</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                const r = await testMpesa();
                setMpesaOut(`Token ok on ${r.host} (${r.token_prefix}…)`);
              } catch (ex) {
                setMpesaOut(ex instanceof Error ? ex.message : "Token failed");
              }
            }}
          >
            Test token
          </Button>
        </div>
      </form>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setKopoOut(null);
          await saveKopokopo({ data: kopo });
          setKopoOut("Kopo Kopo saved. STK uses incoming_payments v2.");
          await load();
        }}
      >
        <h2 className="font-medium">Kopo Kopo</h2>
        <p className="text-sm text-muted">
          Client credentials from K2 Connect. Sandbox host is sandbox.kopokopo.com; live is api.kopokopo.com. Till can
          be your M-Pesa till or a K-prefixed online payments account.
        </p>
        <Check label="Enabled" checked={kopo.enabled} onChange={(v) => setKopo({ ...kopo, enabled: v })} />
        <Check label="Sandbox" checked={kopo.sandbox} onChange={(v) => setKopo({ ...kopo, sandbox: v })} />
        <Field label="Client ID">
          <Input value={kopo.client_id} onChange={(e) => setKopo({ ...kopo, client_id: e.target.value })} />
        </Field>
        <Field label="Client secret">
          <Input
            type="password"
            autoComplete="off"
            placeholder={kopoHint || "Paste secret"}
            value={kopo.client_secret}
            onChange={(e) => setKopo({ ...kopo, client_secret: e.target.value })}
          />
        </Field>
        <Field label="Till / online payments account">
          <Input
            placeholder="K000000 or 1234567"
            value={kopo.till_number}
            onChange={(e) => setKopo({ ...kopo, till_number: e.target.value })}
          />
        </Field>
        <p className="text-xs text-subtle">
          Incoming payment callback: <span className="font-mono text-fg">{kopoCallback || "set public URL above"}</span>
        </p>
        {kopoOut ? <p className="text-sm text-accent">{kopoOut}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit">Save Kopo Kopo</Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              try {
                const r = await testKopokopo();
                setKopoOut(`Token ok on ${r.host} (${r.token_prefix}…)`);
              } catch (ex) {
                setKopoOut(ex instanceof Error ? ex.message : "Token failed");
              }
            }}
          >
            Test token
          </Button>
        </div>
      </form>

      <form
        className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setSaved(null);
          await saveMessaging({ data: msg });
          setSaved("Messaging saved. Payment events now follow these channels.");
          await load();
        }}
      >
        <h2 className="font-medium">Payment SMS & WhatsApp</h2>
        <p className="text-sm text-muted">
          Choose which APIs fire when a payment is confirmed. Billing reminders are separate so you can be quieter on
          WhatsApp.
        </p>

        <div className="grid gap-2 sm:grid-cols-2">
          <Check label="Payment receipts · SMS" checked={msg.payment_sms} onChange={(v) => setMsg({ ...msg, payment_sms: v })} />
          <Check
            label="Payment receipts · WhatsApp"
            checked={msg.payment_whatsapp}
            onChange={(v) => setMsg({ ...msg, payment_whatsapp: v })}
          />
          <Check label="Billing reminders · SMS" checked={msg.billing_sms} onChange={(v) => setMsg({ ...msg, billing_sms: v })} />
          <Check
            label="Billing reminders · WhatsApp"
            checked={msg.billing_whatsapp}
            onChange={(v) => setMsg({ ...msg, billing_whatsapp: v })}
          />
        </div>

        <h3 className="mt-2 text-sm font-medium">SMS API</h3>
        <Field label="Provider">
          <Select value={msg.sms_provider} onChange={(e) => setMsg({ ...msg, sms_provider: e.target.value })}>
            <option value="blessedtexts">Blessed Texts</option>
            <option value="talksasa">Talksasa</option>
            <option value="webfam">Webfam SMS</option>
            <option value="africastalking">Africa's Talking</option>
            <option value="advanta">Advanta SMS</option>
            <option value="twilio">Twilio</option>
          </Select>
        </Field>
        <p className="text-xs text-subtle">
          {msg.sms_provider === "talksasa"
            ? "Talksasa: API token from bulksms.talksasa.com. Sender ID max 11 characters. Username not required."
            : msg.sms_provider === "blessedtexts"
              ? "Blessed Texts: Partner ID + API key from the BlessedTexts dashboard. Sender ID is your approved short name."
              : msg.sms_provider === "webfam"
                ? "WebfamSMS: Bearer API key from Developer → API Keys (WFK-…). Approved sender ID optional. POST https://sms.webfam.co.ke/api/v1/sms/send"
                : msg.sms_provider === "twilio"
                  ? "Twilio: Account SID as username, Auth Token as API key, From number as sender ID."
                  : "Username / partner ID plus API key from the provider dashboard."}
        </p>
        <Field label="Sender ID / shortcode">
          <Input
            placeholder="GRIDLINE"
            value={msg.sms_sender_id}
            onChange={(e) => setMsg({ ...msg, sms_sender_id: e.target.value })}
          />
        </Field>
        <Field
          label={
            msg.sms_provider === "twilio"
              ? "Account SID"
              : msg.sms_provider === "talksasa" || msg.sms_provider === "webfam"
                ? "Account (optional)"
                : "Partner ID / username"
          }
        >
          <Input value={msg.sms_username} onChange={(e) => setMsg({ ...msg, sms_username: e.target.value })} />
        </Field>
        <Field label="API key">
          <Input
            type="password"
            autoComplete="off"
            placeholder={smsHint || (msg.sms_provider === "webfam" ? "WFK-…" : "Paste key")}
            value={msg.sms_api_key}
            onChange={(e) => setMsg({ ...msg, sms_api_key: e.target.value })}
          />
        </Field>
        <Check label="SMS sandbox (log only, do not hit live API)" checked={msg.sms_sandbox} onChange={(v) => setMsg({ ...msg, sms_sandbox: v })} />

        <h3 className="mt-2 text-sm font-medium">WhatsApp Cloud API</h3>
        <Field label="Phone number ID">
          <Input
            placeholder="Meta phone number ID"
            value={msg.wa_phone_id}
            onChange={(e) => setMsg({ ...msg, wa_phone_id: e.target.value })}
          />
        </Field>
        <Field label="WhatsApp Business Account ID">
          <Input value={msg.wa_business_id} onChange={(e) => setMsg({ ...msg, wa_business_id: e.target.value })} />
        </Field>
        <Field label="Access token">
          <Input
            type="password"
            autoComplete="off"
            placeholder={waHint || "Paste token"}
            value={msg.wa_access_token}
            onChange={(e) => setMsg({ ...msg, wa_access_token: e.target.value })}
          />
        </Field>
        <Check
          label="WhatsApp sandbox (log only until go-live)"
          checked={msg.wa_sandbox}
          onChange={(v) => setMsg({ ...msg, wa_sandbox: v })}
        />

        {saved ? <p className="text-sm text-accent">{saved}</p> : null}
        <Button type="submit">Save messaging</Button>
      </form>

      <section className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4">
        <h2 className="font-medium">Send a test</h2>
        <Field label="Phone">
          <Input placeholder="+2547…" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const r = await testMessaging({ data: { channel: "sms", phone: testPhone } });
              setTestOut(`SMS ${r.status} · ${r.detail}`);
            }}
          >
            Test SMS
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const r = await checkSmsAccount();
              setTestOut(`Account ${r.ok ? "ok" : "error"} · ${r.detail}`);
            }}
          >
            Check Webfam balance
          </Button>
        </div>
        {testOut ? <p className="text-sm text-muted">{testOut}</p> : null}
        <p className="text-xs text-subtle">
          Leave sandbox on until keys are verified. Blessed Texts, Talksasa, and Webfam send through their Kenyan
          gateways; Africa's Talking / Advanta / Twilio remain available. Keys never leave the tenant row.
        </p>
      </section>
    </div>
  );
}

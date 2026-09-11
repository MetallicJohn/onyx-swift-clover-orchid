import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import { AppearanceSettings } from "@/components/isp/appearance-settings";
import { NotificationsSettings } from "@/components/isp/notifications-settings";
import { hasPermission } from "@/lib/isp/rbac";
import { changeMyPassword, getDashboard, renameTenant, setStaffPassword } from "@/lib/isp/server";
import { getDocumentBranding, saveDocumentBranding } from "@/lib/isp/server-docs";
import { getKopokopo, saveKopokopo, testKopokopo } from "@/lib/isp/server-kopo";
import { getMpesa, saveMpesa, savePublicBase, testMpesa } from "@/lib/isp/server-mpesa";
import { getPlan, listTicketStaff, recordPlanPayment, sendPlanStk, setPlan, createStaffAccount, changeMemberRole } from "@/lib/isp/server-more";
import { checkSmsAccount, confirmStk, getMessaging, listProviders, saveMessaging, testMessaging, toggleProvider, workspaceSlug } from "@/lib/isp/server-ops";
import { getGracePolicyFn, saveGracePolicyFn } from "@/lib/isp/server-grace";
import type { GracePolicy } from "@/lib/isp/grace";
import { downloadWireGuardServer, getVpsPublishGuide, getWireGuardHub, rotateWireGuardHub, saveWireGuardHub } from "@/lib/isp/server-wg";
import { vpsInstallCommand, vpsUpdateCommand } from "@/lib/isp/vps-publish";
import { cn, kes } from "@/lib/utils";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } => ({
    tab: isTabId(search.tab) ? search.tab : undefined,
  }),
  component: SettingsPage,
});

type TabId = "company" | "appearance" | "network" | "sms" | "notifications" | "payment" | "plan" | "staff" | "grace";

const TABS: { id: TabId; label: string }[] = [
  { id: "company", label: "Company info" },
  { id: "appearance", label: "Appearance" },
  { id: "network", label: "Network" },
  { id: "sms", label: "SMS" },
  { id: "notifications", label: "Notifications" },
  { id: "payment", label: "Payment" },
  { id: "plan", label: "Plan" },
  { id: "staff", label: "Staff" },
  { id: "grace", label: "Grace period" },
];

function isTabId(value: unknown): value is TabId {
  return TABS.some((t) => t.id === value);
}

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
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab: TabId = tabParam ?? "company";
  const [ws, setWs] = useState<Workspace | null>(null);
  const [form, setForm] = useState({ name: "", supportEmail: "", supportPhone: "" });
  const [brand, setBrand] = useState({
    address: "",
    website: "",
    tax_pin: "",
    invoice_footer: "",
    invoice_notes: "",
    brand_color: "#4aa8a0",
    bank_name: "",
    bank_account: "",
    bank_branch: "",
  });
  const [slug, setSlug] = useState("");
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
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
  const [plan, setPlanState] = useState<Awaited<ReturnType<typeof getPlan>> | null>(null);
  const [staff, setStaff] = useState<{ user_id: string; role: string; name: string; email?: string }[]>([]);
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "technician",
  });
  const [staffErr, setStaffErr] = useState<string | null>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const [planRef, setPlanRef] = useState("");
  const [planStk, setPlanStk] = useState<string | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [hub, setHub] = useState<{
    publicKey: string;
    address: string;
    network: string;
    listenPort: number;
    endpointHost: string;
    ready: boolean;
  } | null>(null);
  const [hubForm, setHubForm] = useState({ endpoint_host: "", listen_port: 51820 });
  const [hubConf, setHubConf] = useState<string | null>(null);
  const [hubInstall, setHubInstall] = useState<string | null>(null);
  const [hubCopied, setHubCopied] = useState<"conf" | "install" | null>(null);
  const [vpsGuide, setVpsGuide] = useState<{
    domain: string;
    command: string;
    updateCommand: string;
    notes: string[];
  } | null>(null);
  const [vpsCopied, setVpsCopied] = useState<"install" | "update" | null>(null);
  const [gracePolicy, setGracePolicy] = useState<GracePolicy | null>(null);
  const [graceBusy, setGraceBusy] = useState(false);

  async function load() {
    const [d, s, p, m, k, daraja, sub, st, branding, gp] = await Promise.all([
      getDashboard(),
      workspaceSlug(),
      listProviders(),
      getMessaging(),
      getKopokopo(),
      getMpesa(),
      getPlan(),
      listTicketStaff(),
      getDocumentBranding(),
      getGracePolicyFn(),
    ]);
    setWs(d.workspace);
    setGracePolicy(gp);
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
    setPlanState(sub);
    setStaff(st.staff);
    setBrand({
      address: branding.address,
      website: branding.website,
      tax_pin: branding.tax_pin,
      invoice_footer: branding.invoice_footer,
      invoice_notes: branding.invoice_notes,
      brand_color: branding.brand_color || "#4aa8a0",
      bank_name: branding.bank_name,
      bank_account: branding.bank_account,
      bank_branch: branding.bank_branch,
    });
    try {
      const wg = await getWireGuardHub();
      setHub(wg);
      setHubForm({ endpoint_host: wg.endpointHost, listen_port: wg.listenPort });
    } catch {
      setHub(null);
    }
    try {
      setVpsGuide(await getVpsPublishGuide());
    } catch {
      setVpsGuide(null);
    }
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function saveMsg(e: React.FormEvent) {
    e.preventDefault();
    setSaved(null);
    await saveMessaging({ data: msg });
    setSaved("Messaging saved.");
    await load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Company profile, appearance, WireGuard hub, SMS, notifications, and payment rails.</p>
      </div>

      <div
        role="tablist"
        aria-label="Settings sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              tab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => {
              void navigate({ search: { tab: t.id }, replace: true });
              setSaved(null);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "company" ? (
        <form
          className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await renameTenant({ data: form });
            await load();
          }}
        >
          <h2 className="font-medium">Company info</h2>
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
            Role: {ws?.role} · Plan: {ws?.status} · Customer portal slug:{" "}
            <span className="font-mono text-fg">{slug}</span>
          </p>
          <p className="text-sm text-muted">
            Customers sign in at{" "}
            <Link to="/portal" className="text-accent hover:underline">
              /portal
            </Link>
            .
          </p>
          <Button type="submit">Save company</Button>
        </form>
      ) : null}

      {tab === "appearance" ? (
        <AppearanceSettings canManage={Boolean(ws && hasPermission(ws.role, "settings.manage"))} />
      ) : null}

      {tab === "company" ? (
        <form
          className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await saveDocumentBranding({ data: brand });
            setSaved("Invoice branding saved.");
            await load();
          }}
        >
          <h2 className="font-medium">Invoices & statements</h2>
          <p className="text-sm text-muted">
            Shown on PDFs for this ISP only. Leave a field empty to hide it.
          </p>
          <Field label="Address">
            <Input value={brand.address} onChange={(e) => setBrand({ ...brand, address: e.target.value })} />
          </Field>
          <Field label="Website">
            <Input value={brand.website} onChange={(e) => setBrand({ ...brand, website: e.target.value })} />
          </Field>
          <Field label="Tax / PIN">
            <Input value={brand.tax_pin} onChange={(e) => setBrand({ ...brand, tax_pin: e.target.value })} />
          </Field>
          <p className="text-xs text-muted">Invoice accent colour follows Appearance → Primary.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bank name">
              <Input value={brand.bank_name} onChange={(e) => setBrand({ ...brand, bank_name: e.target.value })} />
            </Field>
            <Field label="Account number">
              <Input value={brand.bank_account} onChange={(e) => setBrand({ ...brand, bank_account: e.target.value })} />
            </Field>
          </div>
          <Field label="Bank branch">
            <Input value={brand.bank_branch} onChange={(e) => setBrand({ ...brand, bank_branch: e.target.value })} />
          </Field>
          <Field label="Invoice notes">
            <Textarea
              value={brand.invoice_notes}
              onChange={(e) => setBrand({ ...brand, invoice_notes: e.target.value })}
              placeholder="Shown on invoices when no invoice-specific note is set"
            />
          </Field>
          <Field label="Footer">
            <Textarea
              value={brand.invoice_footer}
              onChange={(e) => setBrand({ ...brand, invoice_footer: e.target.value })}
              placeholder="Thank you for your business."
            />
          </Field>
          {saved ? <p className="text-sm text-ok">{saved}</p> : null}
          <Button type="submit">Save document branding</Button>
        </form>
      ) : null}

      {tab === "company" ? (
        <form
          className="grid max-w-xl gap-3 rounded-xl bg-surface p-5 shadow-card md:p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            setPwErr(null);
            if (pw.next !== pw.confirm) {
              setPwErr("Passwords do not match");
              return;
            }
            setPwBusy(true);
            try {
              await changeMyPassword({ data: { current: pw.current, password: pw.next } });
              setPw({ current: "", next: "", confirm: "" });
              setSaved("Your login password was updated.");
            } catch (err) {
              setPwErr(err instanceof Error ? err.message : "Could not change password");
            } finally {
              setPwBusy(false);
            }
          }}
        >
          <h2 className="font-medium">Your password</h2>
          <p className="text-sm text-muted">
            This is the email login for the ISP console and for {APP_NAME} superadmin, if you have that role.
          </p>
          <Field label="Current password">
            <Input
              type="password"
              required
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              autoComplete="current-password"
            />
          </Field>
          <Field label="New password">
            <Input
              type="password"
              required
              minLength={8}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
          <Field label="Confirm">
            <Input
              type="password"
              required
              minLength={8}
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              autoComplete="new-password"
            />
          </Field>
          {pwErr ? <p className="text-sm text-danger">{pwErr}</p> : null}
          {saved ? <p className="text-sm text-ok">{saved}</p> : null}
          <Button type="submit" disabled={pwBusy}>
            {pwBusy ? "Saving…" : "Update password"}
          </Button>
        </form>
      ) : null}

      {tab === "network" ? (
        <section className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5">
          <h2 className="font-medium">WireGuard hub</h2>
          <p className="text-sm text-muted">
            This VPS is <span className="font-mono text-fg">{hub?.address || "10.200.0.1/24"}</span> on{" "}
            <span className="font-mono text-fg">{hub?.network || "10.200.0.0/24"}</span>. Routers dial it; Winbox and
            API stay on the overlay. Paste the public hostname or IP of the server that will run{" "}
            <span className="font-mono">wg-quick</span>.
          </p>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              const next = await saveWireGuardHub({
                data: {
                  endpoint_host: hubForm.endpoint_host,
                  listen_port: Number(hubForm.listen_port) || 51820,
                },
              });
              setHub(next);
              setHubForm({ endpoint_host: next.endpointHost, listen_port: next.listenPort });
              setSaved("WireGuard hub endpoint saved. Re-copy router enroll scripts so they pick up the endpoint.");
            }}
          >
            <Field label="Public endpoint">
              <Input
                placeholder="vpn.yourisp.co.ke or 102.68.10.2"
                value={hubForm.endpoint_host}
                onChange={(e) => setHubForm({ ...hubForm, endpoint_host: e.target.value })}
              />
            </Field>
            <Field label="Listen port">
              <Input
                type="number"
                min={1}
                max={65535}
                value={hubForm.listen_port}
                onChange={(e) => setHubForm({ ...hubForm, listen_port: Number(e.target.value) || 51820 })}
              />
            </Field>
            <Field label="Hub public key">
              <Input readOnly value={hub?.publicKey || "Generated on first save"} />
            </Field>
            <Button type="submit">Save hub</Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const pack = await downloadWireGuardServer();
                setHubConf(pack.conf);
                setHubInstall(pack.install);
                setHub(pack.hub);
                try {
                  await navigator.clipboard.writeText(pack.conf);
                  setHubCopied("conf");
                  setTimeout(() => setHubCopied(null), 2500);
                } catch {
                  setHubCopied(null);
                }
              }}
            >
              {hubCopied === "conf" ? "Copied wg-gridline.conf" : "Download server config"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const pack = await downloadWireGuardServer();
                setHubConf(pack.conf);
                setHubInstall(pack.install);
                try {
                  await navigator.clipboard.writeText(pack.install);
                  setHubCopied("install");
                  setTimeout(() => setHubCopied(null), 2500);
                } catch {
                  setHubCopied(null);
                }
              }}
            >
              {hubCopied === "install" ? "Copied install script" : "Copy VPS install script"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                if (!window.confirm("Rotate the hub keypair? Every router enroll script must be copied again.")) return;
                const next = await rotateWireGuardHub();
                setHub(next);
                setHubConf(null);
                setHubInstall(null);
                setSaved("Hub keys rotated. Download a new server config and re-copy each router script.");
              }}
            >
              Rotate hub keys
            </Button>
          </div>
          {hubConf ? (
            <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
              {hubCopied === "install" && hubInstall ? hubInstall : hubConf}
            </pre>
          ) : null}
        </section>
      ) : null}

      {tab === "network" ? (
        <section className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5">
          <h2 className="font-medium">Publish to your VPS</h2>
          <p className="text-sm text-muted">
            We build here and push to GitHub. After the first install, the VPS pulls that push and rebuilds — usually
            within a few minutes. Secrets on the server stay put.
          </p>
          <Field label="First time (Ubuntu 24.04)">
            <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
              {vpsGuide?.command || vpsInstallCommand({ domain: publicBase, email: form.supportEmail })}
            </pre>
          </Field>
          <Field label="Already installed — publish now">
            <pre className="overflow-x-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed text-fg">
              {vpsGuide?.updateCommand || vpsUpdateCommand()}
            </pre>
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const text = vpsGuide?.command || vpsInstallCommand({ domain: publicBase, email: form.supportEmail });
                try {
                  await navigator.clipboard.writeText(text);
                  setVpsCopied("install");
                  setTimeout(() => setVpsCopied(null), 2500);
                } catch {
                  setVpsCopied(null);
                }
              }}
            >
              {vpsCopied === "install" ? "Copied install" : "Copy first-time install"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                const text = vpsGuide?.updateCommand || vpsUpdateCommand();
                try {
                  await navigator.clipboard.writeText(text);
                  setVpsCopied("update");
                  setTimeout(() => setVpsCopied(null), 2500);
                } catch {
                  setVpsCopied(null);
                }
              }}
            >
              {vpsCopied === "update" ? "Copied updater" : "Copy publish now"}
            </Button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
            {(vpsGuide?.notes || []).map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {tab === "sms" ? (
        <form className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4" onSubmit={saveMsg}>
          <h2 className="font-medium">SMS</h2>
          <p className="text-sm text-muted">Gateway used for receipts and billing reminders. WhatsApp is on the same save.</p>

          <div className="grid gap-2 sm:grid-cols-2">
            <Check label="Payment receipts · SMS" checked={msg.payment_sms} onChange={(v) => setMsg({ ...msg, payment_sms: v })} />
            <Check label="Billing reminders · SMS" checked={msg.billing_sms} onChange={(v) => setMsg({ ...msg, billing_sms: v })} />
            <Check
              label="Payment receipts · WhatsApp"
              checked={msg.payment_whatsapp}
              onChange={(v) => setMsg({ ...msg, payment_whatsapp: v })}
            />
            <Check
              label="Billing reminders · WhatsApp"
              checked={msg.billing_whatsapp}
              onChange={(v) => setMsg({ ...msg, billing_whatsapp: v })}
            />
          </div>

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
              ? "Talksasa: API token from bulksms.talksasa.com. Sender ID max 11 characters."
              : msg.sms_provider === "blessedtexts"
                ? "Blessed Texts: Partner ID + API key. Sender ID is your approved short name."
                : msg.sms_provider === "webfam"
                  ? "WebfamSMS: Bearer API key (WFK-…). POST /api/v1/sms/send"
                  : msg.sms_provider === "twilio"
                    ? "Twilio: Account SID as username, Auth Token as API key."
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
          <Check
            label="SMS sandbox (log only, do not hit live API)"
            checked={msg.sms_sandbox}
            onChange={(v) => setMsg({ ...msg, sms_sandbox: v })}
          />

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

          <h3 className="mt-2 text-sm font-medium">Send a test</h3>
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
        </form>
      ) : null}

      {tab === "notifications" ? <NotificationsSettings /> : null}

      {tab === "payment" ? (
        <div className="space-y-6">
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
            <h2 className="font-medium">Public URL</h2>
            <p className="text-sm text-muted">
              HTTPS origin of this console. Daraja and Kopo Kopo POST here after STK, and operator
              sign-in on this custom domain is allowed.
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
              setMpesaOut("M-Pesa Daraja saved.");
              await load();
            }}
          >
            <h2 className="font-medium">M-Pesa Daraja</h2>
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
              setKopoOut("Kopo Kopo saved.");
              await load();
            }}
          >
            <h2 className="font-medium">Kopo Kopo</h2>
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
              Incoming payment callback:{" "}
              <span className="font-mono text-fg">{kopoCallback || "set public URL above"}</span>
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
        </div>
      ) : null}

      {tab === "plan" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {APP_NAME} subscription for this ISP. Customer invoices stay on Billing. Paid plans issue an invoice and activate after M-Pesa (Stripe is not used).
          </p>
          {planErr ? <p className="text-sm text-danger">{planErr}</p> : null}
          {saved && tab === "plan" ? <p className="text-sm text-accent">{saved}</p> : null}
          {plan ? (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  Current: <strong className="capitalize">{plan.plan}</strong> ({plan.status}) · {plan.max_customers} customers ·{" "}
                  {plan.max_routers} routers
                </div>
                <div className="text-muted">
                  {plan.plan === "trial"
                    ? plan.trial_expired
                      ? "Trial ended"
                      : `${plan.days_left} day${plan.days_left === 1 ? "" : "s"} left`
                    : plan.period_end
                      ? `Renews ${plan.period_end.slice(0, 10)}`
                      : null}
                </div>
              </div>
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {(plan?.catalog ?? []).map((p) => {
              const current = plan?.plan === p.code && !plan.pending_plan;
              const pending = plan?.pending_plan === p.code;
              return (
                <div key={p.code} className="flex flex-col rounded-xl border border-border bg-surface p-4">
                  <div className="text-xs tracking-wide text-accent uppercase">{p.label}</div>
                  <div className="mt-1 font-mono text-2xl">{p.monthly_kes ? kes(p.monthly_kes) : "Free"}</div>
                  <p className="mt-1 text-sm text-muted">{p.blurb}</p>
                  <p className="mt-2 text-xs text-subtle">
                    {p.max_customers} customers · {p.max_routers} routers
                  </p>
                  <Button
                    className="mt-4"
                    variant={current ? "default" : "secondary"}
                    disabled={current}
                    onClick={async () => {
                      setPlanErr(null);
                      setSaved(null);
                      try {
                        const r = await setPlan({ data: { plan: p.code } });
                        setPlanState(r);
                        setSaved(
                          p.monthly_kes === 0
                            ? "Trial is active."
                            : r.invoice
                              ? `Invoice ${r.invoice.number} issued. Pay to activate ${p.label}.`
                              : `Plan set to ${p.label}.`,
                        );
                      } catch (ex) {
                        setPlanErr(ex instanceof Error ? ex.message : "Plan change failed");
                      }
                    }}
                  >
                    {current ? "Current" : pending ? "Pay to activate" : p.monthly_kes === 0 ? "Switch to trial" : "Select"}
                  </Button>
                </div>
              );
            })}
          </div>
          {plan?.invoice ? (
            <form
              className="grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4"
              onSubmit={async (e) => {
                e.preventDefault();
                setPlanErr(null);
                try {
                  const r = await recordPlanPayment({
                    data: { invoice_id: plan.invoice!.id, provider: "mpesa", reference: planRef },
                  });
                  setPlanState(r);
                  setPlanRef("");
                  setPlanStk(null);
                  setSaved(`Paid ${plan.invoice!.number}. ${r.plan} is active.`);
                } catch (ex) {
                  setPlanErr(ex instanceof Error ? ex.message : "Payment failed");
                }
              }}
            >
              <h2 className="font-medium">Pay {plan.invoice.number}</h2>
              <p className="text-sm text-muted">
                {plan.invoice.plan} · {kes(plan.invoice.amount_kes)} · due {plan.invoice.due_date}. The plan does not change until this is paid.
              </p>
              <Field label="M-Pesa receipt">
                <Input required placeholder="QK7X…" value={planRef} onChange={(e) => setPlanRef(e.target.value)} />
              </Field>
              {planErr ? <p className="text-sm text-danger">{planErr}</p> : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit">Record payment</Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    setPlanErr(null);
                    try {
                      const r = await sendPlanStk({ data: { invoice_id: plan.invoice!.id, provider: "mpesa" } });
                      setPlanStk(r.checkout_id);
                      if (r.note) setPlanErr(r.note);
                    } catch (ex) {
                      setPlanErr(ex instanceof Error ? ex.message : "STK failed");
                    }
                  }}
                >
                  Send STK to company phone
                </Button>
              </div>
              {planStk ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono">{planStk}</span>
                  {planStk.startsWith("ws_") ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={async () => {
                        await confirmStk({ data: { checkout_id: planStk } });
                        setPlanStk(null);
                        setPlanState(await getPlan());
                        setSaved("Platform invoice paid. Plan is active.");
                      }}
                    >
                      Simulate Daraja callback
                    </Button>
                  ) : (
                    <span className="text-muted">Waiting for the live callback.</span>
                  )}
                </div>
              ) : null}
            </form>
          ) : null}
          {plan?.invoices?.length ? (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border text-sm">
              {plan.invoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between bg-surface px-4 py-3">
                  <span>
                    {inv.number} · {inv.plan} · due {inv.due_date}
                  </span>
                  <span className="font-mono">
                    {kes(inv.amount_kes)} · {inv.status}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {tab === "staff" ? (
        <div className="space-y-6">
          <form
            className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              setStaffErr(null);
              setStaffBusy(true);
              try {
                await createStaffAccount({
                  data: {
                    name: staffForm.name,
                    email: staffForm.email,
                    password: staffForm.password,
                    role: staffForm.role,
                  },
                });
                setStaffForm({ name: "", email: "", password: "", role: "technician" });
                setSaved("Staff login created. They can sign in with that email and password.");
                await load();
              } catch (err) {
                setStaffErr(err instanceof Error ? err.message : "Could not create staff");
              } finally {
                setStaffBusy(false);
              }
            }}
          >
            <div className="sm:col-span-2">
              <h2 className="font-medium">Create a staff login</h2>
              <p className="mt-1 text-sm text-muted">
                They sign in at the same {APP_NAME} login with this email and password. No extra signup needed.
              </p>
            </div>
            <Field label="Name">
              <Input
                required
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                placeholder="Kamau Otieno"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                required
                value={staffForm.email}
                onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                placeholder="tech@isp.co.ke"
              />
            </Field>
            <Field label="Temporary password">
              <Input
                type="password"
                required
                minLength={8}
                value={staffForm.password}
                onChange={(e) => setStaffForm({ ...staffForm, password: e.target.value })}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </Field>
            <Field label="Role">
              <Select
                value={staffForm.role}
                onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
              >
                <option value="isp_admin">Admin</option>
                <option value="finance">Finance</option>
                <option value="customer_care">Customer care</option>
                <option value="network_engineer">Network engineer</option>
                <option value="technician">Technician</option>
                <option value="isp_owner">Owner</option>
              </Select>
            </Field>
            {staffErr ? <p className="text-sm text-danger sm:col-span-2">{staffErr}</p> : null}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={staffBusy}>
                {staffBusy ? "Creating…" : "Create login"}
              </Button>
            </div>
          </form>

          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {staff.map((s) => (
              <li key={s.user_id} className="flex flex-col gap-2 bg-surface px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">{s.name}</div>
                  <div className="text-xs text-muted">{s.email || s.user_id}</div>
                </div>
                <Select
                  className="sm:w-52"
                  value={s.role}
                  onChange={async (e) => {
                    try {
                      await changeMemberRole({ data: { user_id: s.user_id, role: e.target.value } });
                      await load();
                    } catch (err) {
                      setStaffErr(err instanceof Error ? err.message : "Could not change role");
                    }
                  }}
                >
                  <option value="isp_owner">Owner</option>
                  <option value="isp_admin">Admin</option>
                  <option value="finance">Finance</option>
                  <option value="customer_care">Customer care</option>
                  <option value="network_engineer">Network engineer</option>
                  <option value="technician">Technician</option>
                </Select>
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const password = String(fd.get("password") || "");
                    setStaffErr(null);
                    try {
                      await setStaffPassword({ data: { user_id: s.user_id, password } });
                      e.currentTarget.reset();
                      setSaved(`Password updated for ${s.email || s.name}.`);
                    } catch (err) {
                      setStaffErr(err instanceof Error ? err.message : "Could not reset password");
                    }
                  }}
                >
                  <Input
                    name="password"
                    type="password"
                    required
                    minLength={8}
                    placeholder="New password"
                    autoComplete="new-password"
                    className="sm:w-44"
                  />
                  <Button type="submit" size="sm" variant="secondary">
                    Reset
                  </Button>
                </form>
              </li>
            ))}
            {staff.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No members yet.</li> : null}
          </ul>
        </div>
      ) : null}

      {tab === "grace" && gracePolicy ? (
        <form
          className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setGraceBusy(true);
            setSaved(null);
            try {
              const next = await saveGracePolicyFn({
                data: {
                  staff_max_days: gracePolicy.staff_max_days,
                  staff_preset_days: gracePolicy.staff_preset_days,
                  allow_custom_days: gracePolicy.allow_custom_days,
                  customer_self_service: gracePolicy.customer_self_service,
                  customer_max_days: gracePolicy.customer_max_days,
                  customer_preset_days: gracePolicy.customer_preset_days,
                  customer_max_uses_per_period: gracePolicy.customer_max_uses_per_period,
                  customer_min_account_days: gracePolicy.customer_min_account_days,
                  customer_require_prior_payment: gracePolicy.customer_require_prior_payment,
                  customer_block_if_already_grace: gracePolicy.customer_block_if_already_grace,
                  customer_cooldown_days: gracePolicy.customer_cooldown_days,
                  notify_nearing_hours: gracePolicy.notify_nearing_hours,
                },
              });
              setGracePolicy(next);
              setSaved("Grace period terms saved.");
            } catch (err) {
              setSaved(err instanceof Error ? err.message : "Could not save grace terms");
            } finally {
              setGraceBusy(false);
            }
          }}
        >
          <div className="sm:col-span-2">
            <h2 className="font-medium">Grace Period terms</h2>
            <p className="mt-1 text-sm text-muted">
              Staff can grant temporary access after expiry without changing the renewal date. Customers can add
              grace themselves only when they meet the terms below.
            </p>
          </div>
          <Field label="Staff maximum days">
            <Input
              type="number"
              min={1}
              max={30}
              value={gracePolicy.staff_max_days}
              onChange={(e) => setGracePolicy({ ...gracePolicy, staff_max_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Staff day options (comma separated)">
            <Input
              value={gracePolicy.staff_preset_days.join(",")}
              onChange={(e) =>
                setGracePolicy({
                  ...gracePolicy,
                  staff_preset_days: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0),
                })
              }
            />
          </Field>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.allow_custom_days}
              onChange={(e) => setGracePolicy({ ...gracePolicy, allow_custom_days: e.target.checked })}
            />
            Allow staff to enter a custom number of days
          </label>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_self_service}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_self_service: e.target.checked })}
            />
            Allow eligible customers to add grace from the portal
          </label>
          <Field label="Customer maximum days">
            <Input
              type="number"
              min={1}
              max={30}
              value={gracePolicy.customer_max_days}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_max_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Customer day options (comma separated)">
            <Input
              value={gracePolicy.customer_preset_days.join(",")}
              onChange={(e) =>
                setGracePolicy({
                  ...gracePolicy,
                  customer_preset_days: e.target.value.split(/[,\s]+/).map(Number).filter((n) => n > 0),
                })
              }
            />
          </Field>
          <Field label="Uses allowed per period">
            <Input
              type="number"
              min={1}
              max={12}
              value={gracePolicy.customer_max_uses_per_period}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_max_uses_per_period: Number(e.target.value) })}
            />
          </Field>
          <Field label="Minimum account age (days)">
            <Input
              type="number"
              min={0}
              max={365}
              value={gracePolicy.customer_min_account_days}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_min_account_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Days between customer requests">
            <Input
              type="number"
              min={0}
              max={365}
              value={gracePolicy.customer_cooldown_days}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_cooldown_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Remind before expiry (hours)">
            <Input
              type="number"
              min={1}
              max={72}
              value={gracePolicy.notify_nearing_hours}
              onChange={(e) => setGracePolicy({ ...gracePolicy, notify_nearing_hours: Number(e.target.value) })}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_require_prior_payment}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_require_prior_payment: e.target.checked })}
            />
            Require a previous confirmed payment
          </label>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_block_if_already_grace}
              onChange={(e) => setGracePolicy({ ...gracePolicy, customer_block_if_already_grace: e.target.checked })}
            />
            Block a second grace request while one is already active
          </label>
          {saved && tab === "grace" ? <p className="text-sm text-accent sm:col-span-2">{saved}</p> : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={graceBusy || !hasPermission(ws?.role || "", "settings.manage")}>
              Save terms
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

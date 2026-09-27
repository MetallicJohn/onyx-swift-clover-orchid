import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { APP_NAME, ROS_WG_INTERFACE } from "@/lib/brand";
import { DEFAULT_DATE_FORMAT, formatDate, normalizeDateFormat, setActiveDateFormat, type DateFormatId } from "@/lib/isp/display";
import { AppearanceSettings } from "@/components/isp/appearance-settings";
import { CompanyInfoSettings } from "@/components/isp/company-info-settings";
import { CommunicationsSettings } from "@/components/isp/communications-settings";
import { PaymentSettings } from "@/components/isp/payment-settings";
import { SaveButton, SecretInput, SettingsField, SettingsStatus, SettingsSubnav, type SettingsNote } from "@/components/isp/settings-ui";
import { companyBrandDirty, companyProfileDirty, mergeKeptEdits, type CompanyBrandFields, type CompanyProfileFields } from "@/lib/isp/company-info-tabs";
import { CustomerTagsSettings } from "@/components/isp/customer-tags-settings";
import { CustomerIdSettings } from "@/components/isp/customer-id-settings";
import { NotificationsSettings } from "@/components/isp/notifications-settings";
import { hasPermission, STAFF_ROLES } from "@/lib/isp/rbac";
import { getDashboard, setStaffPassword } from "@/lib/isp/server";
import { getDocumentBranding } from "@/lib/isp/server-docs";
import { getMpesa } from "@/lib/isp/server-mpesa";
import { getPlan, listTicketStaff, recordPlanPayment, sendPlanStk, setPlan, createStaffAccount, changeMemberRole } from "@/lib/isp/server-more";
import { confirmStk, workspaceSlug } from "@/lib/isp/server-ops";
import { getGracePolicyFn, saveGracePolicyFn } from "@/lib/isp/server-grace";
import type { GracePolicy } from "@/lib/isp/grace";
import { getPartialPolicyFn, savePartialPolicyFn } from "@/lib/isp/server-partial";
import type { PartialPolicySnapshot } from "@/lib/isp/partial-payment-format";
import { PartialPaymentSettingsForm } from "@/components/isp/partial-payment-panel";
import { downloadWireGuardServer, getVpsPublishGuide, getWireGuardHub, rotateWireGuardHub, saveWireGuardHub } from "@/lib/isp/server-wg";
import {
  GRACE_SAVE_FAIL,
  GRACE_SAVE_OK,
  NETWORK_SAVE_FAIL,
  NETWORK_SAVE_OK,
  PARTIAL_SAVE_FAIL,
  PARTIAL_SAVE_OK,
  STAFF_SAVE_FAIL,
} from "@/lib/isp/settings-feedback";
import { parseSettingsSearch, SETTINGS_PAGES, type SettingsPageId } from "@/lib/isp/settings-nav";
import { vpsInstallCommand, vpsUpdateCommand } from "@/lib/isp/vps-publish";
import { kes } from "@/lib/utils";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app/settings")({
  validateSearch: (search: Record<string, unknown>) => parseSettingsSearch(search),
  component: SettingsPage,
});

function SettingsPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const tab: SettingsPageId = search.tab ?? "general";
  const section = search.section;
  const [ws, setWs] = useState<Workspace | null>(null);
  const [form, setForm] = useState({
    name: "",
    supportEmail: "",
    supportPhone: "",
    dateFormat: DEFAULT_DATE_FORMAT as DateFormatId,
  });
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
  const [savedForm, setSavedForm] = useState(form);
  const [savedBrand, setSavedBrand] = useState(brand);
  const formRef = useRef(form);
  const brandRef = useRef(brand);
  const savedFormRef = useRef(savedForm);
  const savedBrandRef = useRef(savedBrand);
  formRef.current = form;
  brandRef.current = brand;
  savedFormRef.current = savedForm;
  savedBrandRef.current = savedBrand;
  const [saved, setSaved] = useState<string | null>(null);
  const [publicBase, setPublicBase] = useState("");
  const [plan, setPlanState] = useState<Awaited<ReturnType<typeof getPlan>> | null>(null);
  const [staff, setStaff] = useState<{ user_id: string; role: string; name: string; email?: string }[]>([]);
  const [staffForm, setStaffForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "technician",
  });
  const [staffNote, setStaffNote] = useState<SettingsNote>(null);
  const [staffBusy, setStaffBusy] = useState(false);
  const staffLock = useRef(false);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [planRef, setPlanRef] = useState("");
  const [planStk, setPlanStk] = useState<string | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
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
  const [hubNote, setHubNote] = useState<SettingsNote>(null);
  const [hubBusy, setHubBusy] = useState(false);
  const networkSection = section === "publish" ? "publish" : "hub";
  const hubDirty = useRef(false);
  const [vpsGuide, setVpsGuide] = useState<{
    domain: string;
    command: string;
    updateCommand: string;
    notes: string[];
  } | null>(null);
  const [vpsCopied, setVpsCopied] = useState<"install" | "update" | null>(null);
  const [gracePolicy, setGracePolicy] = useState<GracePolicy | null>(null);
  const [graceBusy, setGraceBusy] = useState(false);
  const [graceSection, setGraceSection] = useState<"staff" | "customer">("staff");
  const [graceNote, setGraceNote] = useState<SettingsNote>(null);
  const graceDirty = useRef(false);
  const [partialPolicy, setPartialPolicy] = useState<PartialPolicySnapshot | null>(null);
  const [partialBusy, setPartialBusy] = useState(false);
  const [partialNote, setPartialNote] = useState<SettingsNote>(null);
  const partialDirty = useRef(false);

  async function load() {
    const [d, s, daraja, sub, st, branding, gp, pp] = await Promise.all([
      getDashboard(),
      workspaceSlug(),
      getMpesa(),
      getPlan(),
      listTicketStaff(),
      getDocumentBranding(),
      getGracePolicyFn(),
      getPartialPolicyFn(),
    ]);
    setWs(d.workspace);
    if (!graceDirty.current) setGracePolicy(gp);
    if (!partialDirty.current) setPartialPolicy(pp);
    setSlug(s.slug);
    const nextForm = {
      name: d.workspace.tenantName,
      supportEmail: d.workspace.supportEmail,
      supportPhone: d.workspace.supportPhone,
      dateFormat: normalizeDateFormat(d.workspace.dateFormat),
    };
    if (!companyProfileDirty(formRef.current, savedFormRef.current)) {
      formRef.current = nextForm;
      savedFormRef.current = nextForm;
      setForm(nextForm);
      setSavedForm(nextForm);
    }
    setActiveDateFormat(d.workspace.dateFormat || DEFAULT_DATE_FORMAT);
    setPublicBase(daraja.public_base_url || (typeof window !== "undefined" ? window.location.origin : ""));
    setPlanState(sub);
    setStaff(st.staff);
    const nextBrand: CompanyBrandFields = {
      address: branding.address,
      website: branding.website,
      tax_pin: branding.tax_pin,
      invoice_footer: branding.invoice_footer,
      invoice_notes: branding.invoice_notes,
      brand_color: branding.brand_color || "#4aa8a0",
      bank_name: branding.bank_name,
      bank_account: branding.bank_account,
      bank_branch: branding.bank_branch,
    };
    if (!companyBrandDirty(brandRef.current, savedBrandRef.current)) {
      brandRef.current = nextBrand;
      savedBrandRef.current = nextBrand;
      setBrand(nextBrand);
      setSavedBrand(nextBrand);
    }
    if (!hubDirty.current) {
      try {
        const wg = await getWireGuardHub();
        setHub(wg);
        setHubForm({ endpoint_host: wg.endpointHost, listen_port: wg.listenPort });
      } catch {
        setHub(null);
      }
    }
    try {
      setVpsGuide(await getVpsPublishGuide());
    } catch {
      setVpsGuide(null);
    }
  }

  async function reloadProfile(submitted: CompanyProfileFields & { dateFormat: DateFormatId }) {
    const d = await getDashboard();
    const next = {
      name: d.workspace.tenantName,
      supportEmail: d.workspace.supportEmail,
      supportPhone: d.workspace.supportPhone,
      dateFormat: normalizeDateFormat(d.workspace.dateFormat),
    };
    setWs(d.workspace);
    setActiveDateFormat(d.workspace.dateFormat || DEFAULT_DATE_FORMAT);
    const resolved = mergeKeptEdits(formRef.current, submitted, next);
    formRef.current = resolved;
    savedFormRef.current = next;
    setForm(resolved);
    setSavedForm(next);
  }

  async function reloadBrand(submitted: CompanyBrandFields) {
    const branding = await getDocumentBranding();
    const next: CompanyBrandFields = {
      address: branding.address,
      website: branding.website,
      tax_pin: branding.tax_pin,
      invoice_footer: branding.invoice_footer,
      invoice_notes: branding.invoice_notes,
      brand_color: branding.brand_color || "#4aa8a0",
      bank_name: branding.bank_name,
      bank_account: branding.bank_account,
      bank_branch: branding.bank_branch,
    };
    const resolved = mergeKeptEdits(brandRef.current, submitted, next);
    brandRef.current = resolved;
    savedBrandRef.current = next;
    setBrand(resolved);
    setSavedBrand(next);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  function editGrace(next: GracePolicy) {
    graceDirty.current = true;
    setGracePolicy(next);
  }

  function openPage(next: SettingsPageId, nextSection?: string) {
    void navigate({ search: { tab: next, section: nextSection }, replace: true });
    setSaved(null);
    setHubNote(null);
    setGraceNote(null);
    setPartialNote(null);
    setStaffNote(null);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">
          Company, communications, payments, network, staff, and customer defaults for this ISP.
        </p>
        {hasPermission(ws?.role || "", "recycle_bin.view") ? (
          <p className="mt-2 text-sm">
            <Link to="/app/recycle-bin" className="text-accent hover:underline">
              Recycle Bin
            </Link>
            <span className="text-muted"> — restore or permanently delete archived customers and services.</span>
          </p>
        ) : null}
      </div>

      <SettingsSubnav
        label="Settings sections"
        value={tab}
        onChange={(id) => openPage(id)}
        tabs={SETTINGS_PAGES.map((page) => ({ id: page.id, label: page.label }))}
      />

      {tab === "general" ? (
        <div className="space-y-4">
          <SettingsSubnav
            label="General"
            value={section === "appearance" ? "appearance" : "company"}
            onChange={(id) => openPage("general", id)}
            tabs={[
              { id: "company", label: "Company" },
              { id: "appearance", label: "Appearance" },
            ]}
          />
          {section === "appearance" ? (
            <AppearanceSettings canManage={Boolean(ws && hasPermission(ws.role, "settings.manage"))} />
          ) : (
            <CompanyInfoSettings
              ws={ws}
              slug={slug}
              form={form}
              setForm={setForm}
              savedForm={savedForm}
              brand={brand}
              setBrand={setBrand}
              savedBrand={savedBrand}
              reloadProfile={reloadProfile}
              reloadBrand={reloadBrand}
            />
          )}
        </div>
      ) : null}

      {tab === "network" ? (
        <div className="space-y-4">
          <SettingsSubnav
            label="Network"
            value={networkSection}
            onChange={(id) => openPage("network", id)}
            tabs={[
              { id: "hub", label: "WireGuard" },
              { id: "publish", label: "Publish" },
            ]}
          />
        <section hidden={networkSection !== "hub"} className={networkSection === "hub" ? "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}>
          <h2 className="font-medium">WireGuard hub</h2>
          <p className="text-sm text-muted">
            This VPS is <span className="font-mono text-fg">{hub?.address || "10.200.0.1/24"}</span> on{" "}
            <span className="font-mono text-fg">{hub?.network || "10.200.0.0/24"}</span>. Routers dial{" "}
            <span className="font-mono text-fg">{ROS_WG_INTERFACE}</span>. API is TCP 8728 on the overlay only. Paste the
            public WireGuard hostname (never the HTTPS apex). Production default is{" "}
            <span className="font-mono text-fg">wg.ispsolutions.co.ke</span>. Cloudflare stays DNS-only.
          </p>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (hubBusy) return;
              setHubNote(null);
              setHubBusy(true);
              try {
                const next = await saveWireGuardHub({
                  data: {
                    endpoint_host: hubForm.endpoint_host,
                    listen_port: Number(hubForm.listen_port) || 51820,
                  },
                });
                hubDirty.current = false;
                setHub(next);
                setHubForm({ endpoint_host: next.endpointHost, listen_port: next.listenPort });
                setHubNote({ ok: true, text: NETWORK_SAVE_OK });
              } catch (err) {
                setHubNote({ ok: false, text: err instanceof Error ? err.message : NETWORK_SAVE_FAIL });
              } finally {
                setHubBusy(false);
              }
            }}
          >
            <Field label="Public endpoint">
              <Input
                placeholder="wg.ispsolutions.co.ke"
                value={hubForm.endpoint_host}
                onChange={(e) => {
                  hubDirty.current = true;
                  setHubForm({ ...hubForm, endpoint_host: e.target.value });
                }}
              />
            </Field>
            <Field label="Listen port">
              <Input
                type="number"
                min={1}
                max={65535}
                value={hubForm.listen_port}
                onChange={(e) => {
                  hubDirty.current = true;
                  setHubForm({ ...hubForm, listen_port: Number(e.target.value) || 51820 });
                }}
              />
            </Field>
            <Field label="Hub public key">
              <Input readOnly value={hub?.publicKey || "Generated on first save"} />
            </Field>
            <SettingsStatus note={hubNote} />
            <SaveButton busy={hubBusy} label="Save changes" />
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
              {hubCopied === "conf" ? `Copied ${ROS_WG_INTERFACE}.conf` : "Download server config"}
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
                setHubNote(null);
                setHubBusy(true);
                try {
                  const next = await rotateWireGuardHub();
                  hubDirty.current = false;
                  setHub(next);
                  setHubConf(null);
                  setHubInstall(null);
                  setHubNote({ ok: true, text: "Hub keys rotated. Download a new server config and re-copy each router script." });
                } catch (err) {
                  setHubNote({ ok: false, text: err instanceof Error ? err.message : "Unable to rotate hub keys." });
                } finally {
                  setHubBusy(false);
                }
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
        <section hidden={networkSection !== "publish"} className={networkSection === "publish" ? "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}>
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
        </div>
      ) : null}

      {tab === "communications" ? (
        <CommunicationsSettings supportPhone={form.supportPhone} supportEmail={form.supportEmail} />
      ) : null}

      {tab === "notifications" ? <NotificationsSettings /> : null}

      {tab === "payments" ? (
        <div className="space-y-4">
          <SettingsSubnav
            label="Payments"
            value={section === "grace" || section === "partial" ? section : "gateways"}
            onChange={(id) => openPage("payments", id)}
            tabs={[
              { id: "gateways", label: "Gateways" },
              { id: "grace", label: "Grace period" },
              { id: "partial", label: "Partial payments" },
            ]}
          />
          <div hidden={section === "grace" || section === "partial"} className={section === "grace" || section === "partial" ? "hidden" : undefined}>
            <PaymentSettings onPublicBase={setPublicBase} />
          </div>
        </div>
      ) : null}

      {tab === "plan" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {APP_NAME} subscription for this ISP. Customer invoices stay on Billing. Paid plans issue an invoice and activate after M-Pesa (Stripe is not used).
          </p>
          <SettingsStatus note={planErr ? { ok: false, text: planErr } : saved ? { ok: true, text: saved } : null} />
          {plan ? (
            <div className="rounded-xl border border-border bg-surface p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  Current: <strong className="capitalize">{plan.plan}</strong> ({plan.status}) · {plan.max_customers} customers ·{" "}
                  {plan.max_routers} routers
                </div>
                <div className="text-muted">
                  {plan.plan === "trial"
                    ? plan.trial_expired || plan.status === "expired"
                      ? "Trial ended — choose a paid plan"
                      : `${plan.days_left} day${plan.days_left === 1 ? "" : "s"} left`
                    : plan.period_end
                      ? `Renews ${formatDate(plan.period_end)}`
                      : null}
                </div>
              </div>
              {!plan.trial_available && plan.plan === "trial" ? (
                <p className="mt-2 text-sm text-muted">
                  This email or phone already used a free trial. Subscribe to keep using the console.
                </p>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 md:grid-cols-3">
            {(plan?.catalog ?? []).map((p) => {
              const current = plan?.plan === p.code && !plan.pending_plan;
              const pending = plan?.pending_plan === p.code;
              const trialAvailable = Boolean(plan?.trial_available);
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
                    disabled={planBusy || current || (p.monthly_kes === 0 && !trialAvailable && !current)}
                    aria-busy={planBusy}
                    onClick={async () => {
                      if (planBusy) return;
                      setPlanErr(null);
                      setSaved(null);
                      setPlanBusy(true);
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
                        setPlanErr(ex instanceof Error ? ex.message : "Unable to update the plan.");
                      } finally {
                        setPlanBusy(false);
                      }
                    }}
                  >
                    {current
                      ? "Current"
                      : pending
                        ? "Pay to activate"
                        : p.monthly_kes === 0
                          ? trialAvailable
                            ? "Switch to trial"
                            : "Trial already used"
                          : "Select"}
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
                if (planBusy) return;
                setPlanErr(null);
                setSaved(null);
                setPlanBusy(true);
                try {
                  const r = await recordPlanPayment({
                    data: { invoice_id: plan.invoice!.id, provider: "mpesa", reference: planRef },
                  });
                  setPlanState(r);
                  setPlanRef("");
                  setPlanStk(null);
                  setSaved(`Paid ${plan.invoice!.number}. ${r.plan} is active.`);
                } catch (ex) {
                  setPlanErr(ex instanceof Error ? ex.message : "Unable to record the plan payment.");
                } finally {
                  setPlanBusy(false);
                }
              }}
            >
              <h2 className="font-medium">Pay {plan.invoice.number}</h2>
              <p className="text-sm text-muted">
                {plan.invoice.plan} · {kes(plan.invoice.amount_kes)} · due {plan.invoice.due_date}. The plan does not change until this is paid.
              </p>
              <SettingsField label="M-Pesa receipt" required>
                <Input required placeholder="QK7X…" value={planRef} onChange={(e) => setPlanRef(e.target.value)} />
              </SettingsField>
              <SettingsStatus note={planErr ? { ok: false, text: planErr } : null} />
              <div className="flex flex-wrap gap-2">
                <SaveButton busy={planBusy} label="Record payment" />
                <Button
                  type="button"
                  variant="secondary"
                  disabled={planBusy}
                  aria-busy={planBusy}
                  onClick={async () => {
                    if (planBusy) return;
                    setPlanErr(null);
                    setPlanBusy(true);
                    try {
                      const r = await sendPlanStk({ data: { invoice_id: plan.invoice!.id, provider: "mpesa" } });
                      setPlanStk(r.checkout_id);
                      if (r.note) setPlanErr(r.note);
                      else setSaved("STK prompt sent to the company phone.");
                    } catch (ex) {
                      setPlanErr(ex instanceof Error ? ex.message : "Unable to send the STK prompt.");
                    } finally {
                      setPlanBusy(false);
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
          {hasPermission(ws?.role || "", "recycle_bin.view") ? (
            <div className="rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium">Recycle Bin</h2>
              <p className="mt-1 text-sm text-muted">
                Deleted customers and services stay archived until staff restore them or permanently delete them.
                Restore never bills or messages the customer.
              </p>
              <Link
                to="/app/recycle-bin"
                className="mt-3 inline-flex h-11 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-bg"
              >
                Open Recycle Bin
              </Link>
            </div>
          ) : null}
          <div className="rounded-xl border border-border bg-surface p-4">
            <h2 className="font-medium">What each role can do</h2>
            <p className="mt-1 text-sm text-muted">
              Access follows these permissions. Support is read-only and only used when {APP_NAME} staff is inside this
              workspace — you cannot invite it.
            </p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {STAFF_ROLES.map((r) => (
                <li key={r.role} className="rounded-lg border border-border bg-bg px-3 py-2">
                  <div className="text-sm font-medium">{r.label}</div>
                  <p className="mt-1 text-sm text-muted">{r.summary}</p>
                </li>
              ))}
            </ul>
          </div>
          <form
            className="grid gap-3 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (staffLock.current) return;
              setStaffNote(null);
              staffLock.current = true;
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
                setStaffNote({ ok: true, text: "Staff login created successfully." });
                await load();
              } catch (err) {
                setStaffNote({ ok: false, text: err instanceof Error ? err.message : STAFF_SAVE_FAIL });
              } finally {
                staffLock.current = false;
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
            <SettingsField label="Name" required>
              <Input
                required
                value={staffForm.name}
                onChange={(e) => setStaffForm({ ...staffForm, name: e.target.value })}
                placeholder="Kamau Otieno"
              />
            </SettingsField>
            <SettingsField label="Email" required>
              <Input
                type="email"
                required
                value={staffForm.email}
                onChange={(e) => setStaffForm({ ...staffForm, email: e.target.value })}
                placeholder="tech@isp.co.ke"
              />
            </SettingsField>
            <SettingsField label="Temporary password" required hint="At least 8 characters. They can change it after signing in.">
              <SecretInput
                value={staffForm.password}
                autoComplete="new-password"
                placeholder="At least 8 characters"
                minLength={8}
                onChange={(password) => setStaffForm({ ...staffForm, password })}
              />
            </SettingsField>
            <SettingsField label="Role" required>
              <Select
                value={staffForm.role}
                onChange={(e) => setStaffForm({ ...staffForm, role: e.target.value })}
              >
                {STAFF_ROLES.map((r) => (
                  <option key={r.role} value={r.role}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </SettingsField>
            <div className="sm:col-span-2">
              <SaveButton busy={staffBusy} label="Create login" pending="Saving…" />
            </div>
          </form>

          <SettingsStatus note={staffNote} />

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
                    setStaffNote(null);
                    try {
                      await changeMemberRole({ data: { user_id: s.user_id, role: e.target.value } });
                      setStaffNote({ ok: true, text: "Staff role updated successfully." });
                      await load();
                    } catch (err) {
                      setStaffNote({ ok: false, text: err instanceof Error ? err.message : STAFF_SAVE_FAIL });
                    }
                  }}
                >
                  {STAFF_ROLES.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </Select>
                <form
                  className="flex flex-col gap-2 sm:flex-row sm:items-center"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const fd = new FormData(e.currentTarget);
                    const password = String(fd.get("password") || "");
                    setStaffNote(null);
                    setResettingId(s.user_id);
                    try {
                      await setStaffPassword({ data: { user_id: s.user_id, password } });
                      e.currentTarget.reset();
                      setStaffNote({ ok: true, text: "Staff password updated successfully." });
                    } catch (err) {
                      setStaffNote({ ok: false, text: err instanceof Error ? err.message : STAFF_SAVE_FAIL });
                    } finally {
                      setResettingId(null);
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
                  <Button type="submit" size="sm" variant="secondary" disabled={resettingId === s.user_id} aria-busy={resettingId === s.user_id}>
                    {resettingId === s.user_id ? "Saving…" : "Reset"}
                  </Button>
                </form>
              </li>
            ))}
            {staff.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No members yet.</li> : null}
          </ul>
        </div>
      ) : null}

      {tab === "payments" && section === "grace" && gracePolicy ? (
        <form
          className="grid gap-4 rounded-xl border border-border bg-surface p-4 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (graceBusy) return;
            setGraceBusy(true);
            setGraceNote(null);
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
              graceDirty.current = false;
              setGracePolicy(next);
              setGraceNote({ ok: true, text: GRACE_SAVE_OK });
            } catch (err) {
              setGraceNote({ ok: false, text: err instanceof Error ? err.message : GRACE_SAVE_FAIL });
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
          <div className="sm:col-span-2">
            <SettingsSubnav
              label="Grace period"
              value={graceSection}
              onChange={setGraceSection}
              tabs={[
                { id: "staff", label: "Staff grants" },
                { id: "customer", label: "Customer self-service" },
              ]}
            />
          </div>
          <div hidden={graceSection !== "staff"} className={graceSection === "staff" ? "grid gap-4 sm:col-span-2 sm:grid-cols-2" : "hidden"}>
            <Field label="Staff maximum days">
            <Input
              type="number"
              min={1}
              max={30}
              value={gracePolicy.staff_max_days}
              onChange={(e) => editGrace({ ...gracePolicy, staff_max_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Staff day options (comma separated)">
            <Input
              value={gracePolicy.staff_preset_days.join(",")}
              onChange={(e) =>
                editGrace({
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
              onChange={(e) => editGrace({ ...gracePolicy, allow_custom_days: e.target.checked })}
            />
            Allow staff to enter a custom number of days
          </label>
          </div>
          <div hidden={graceSection !== "customer"} className={graceSection === "customer" ? "grid gap-4 sm:col-span-2 sm:grid-cols-2" : "hidden"}>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_self_service}
              onChange={(e) => editGrace({ ...gracePolicy, customer_self_service: e.target.checked })}
            />
            Allow eligible customers to add grace from the portal
          </label>
          <Field label="Customer maximum days">
            <Input
              type="number"
              min={1}
              max={30}
              value={gracePolicy.customer_max_days}
              onChange={(e) => editGrace({ ...gracePolicy, customer_max_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Customer day options (comma separated)">
            <Input
              value={gracePolicy.customer_preset_days.join(",")}
              onChange={(e) =>
                editGrace({
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
              onChange={(e) => editGrace({ ...gracePolicy, customer_max_uses_per_period: Number(e.target.value) })}
            />
          </Field>
          <Field label="Minimum account age (days)">
            <Input
              type="number"
              min={0}
              max={365}
              value={gracePolicy.customer_min_account_days}
              onChange={(e) => editGrace({ ...gracePolicy, customer_min_account_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Days between customer requests">
            <Input
              type="number"
              min={0}
              max={365}
              value={gracePolicy.customer_cooldown_days}
              onChange={(e) => editGrace({ ...gracePolicy, customer_cooldown_days: Number(e.target.value) })}
            />
          </Field>
          <Field label="Remind before expiry (hours)">
            <Input
              type="number"
              min={1}
              max={72}
              value={gracePolicy.notify_nearing_hours}
              onChange={(e) => editGrace({ ...gracePolicy, notify_nearing_hours: Number(e.target.value) })}
            />
          </Field>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_require_prior_payment}
              onChange={(e) => editGrace({ ...gracePolicy, customer_require_prior_payment: e.target.checked })}
            />
            Require a previous confirmed payment
          </label>
          <label className="flex h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={gracePolicy.customer_block_if_already_grace}
              onChange={(e) => editGrace({ ...gracePolicy, customer_block_if_already_grace: e.target.checked })}
            />
            Block a second grace request while one is already active
          </label>
          </div>
          <div className="sm:col-span-2 grid gap-3">
            <SettingsStatus note={graceNote} />
            <Button type="submit" disabled={graceBusy || !hasPermission(ws?.role || "", "settings.manage")} aria-busy={graceBusy}>
              {graceBusy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      ) : null}

      {tab === "payments" && section === "partial" && partialPolicy ? (
        <PartialPaymentSettingsForm
          policy={partialPolicy}
          busy={partialBusy}
          note={partialNote}
          onChange={(next) => {
            partialDirty.current = true;
            setPartialPolicy(next);
          }}
          onSave={async () => {
            if (partialBusy) return;
            setPartialBusy(true);
            setPartialNote(null);
            try {
              const next = await savePartialPolicyFn({ data: partialPolicy });
              partialDirty.current = false;
              setPartialPolicy(next);
              setPartialNote({ ok: true, text: PARTIAL_SAVE_OK });
            } catch (err) {
              setPartialNote({ ok: false, text: err instanceof Error ? err.message : PARTIAL_SAVE_FAIL });
            } finally {
              setPartialBusy(false);
            }
          }}
        />
      ) : null}

      {tab === "customers" ? (
        <div className="space-y-4">
          <SettingsSubnav
            label="Customers"
            value={section === "ids" ? "ids" : "tags"}
            onChange={(id) => openPage("customers", id)}
            tabs={[
              { id: "tags", label: "Customer tags" },
              { id: "ids", label: "ID Settings" },
            ]}
          />
          {section === "ids" ? <CustomerIdSettings /> : <CustomerTagsSettings />}
        </div>
      ) : null}
    </div>
  );
}

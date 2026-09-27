import { useRef, useState } from "react";
import { AppearanceSettings } from "@/components/isp/appearance-settings";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { APP_NAME } from "@/lib/brand";
import {
  basicInfoComplete,
  COMPANY_INFO_TABS,
  COMPANY_SAVE_OK,
  companySaveError,
  companyTabDirty,
  PASSWORD_SAVE_OK,
  type CompanyBrandFields,
  type CompanyInfoTabId,
  type CompanyProfileFields,
} from "@/lib/isp/company-info-tabs";
import { DATE_FORMATS, dateFormatExample, normalizeDateFormat, type DateFormatId } from "@/lib/isp/display";
import { hasPermission } from "@/lib/isp/rbac";
import { changeMyPassword, renameTenant } from "@/lib/isp/server";
import { saveDocumentBranding } from "@/lib/isp/server-docs";
import type { Workspace } from "@/lib/isp/types";
import { cn } from "@/lib/utils";

type Note = { ok: boolean; text: string } | null;
type ProfileForm = CompanyProfileFields & { dateFormat: DateFormatId };

export function CompanyInfoSettings({
  ws,
  slug,
  form,
  setForm,
  savedForm,
  brand,
  setBrand,
  savedBrand,
  reloadProfile,
  reloadBrand,
}: {
  ws: Workspace | null;
  slug: string;
  form: ProfileForm;
  setForm: (next: ProfileForm) => void;
  savedForm: CompanyProfileFields;
  brand: CompanyBrandFields;
  setBrand: (next: CompanyBrandFields) => void;
  savedBrand: CompanyBrandFields;
  reloadProfile: (submitted: ProfileForm) => Promise<void>;
  reloadBrand: (submitted: CompanyBrandFields) => Promise<void>;
}) {
  const [section, setSection] = useState<CompanyInfoTabId>("basic");
  const [brandingSeen, setBrandingSeen] = useState(false);
  const [brandingDirty, setBrandingDirty] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [brandBusy, setBrandBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [basicNote, setBasicNote] = useState<Note>(null);
  const [contactNote, setContactNote] = useState<Note>(null);
  const [legalNote, setLegalNote] = useState<Note>(null);
  const [dateNote, setDateNote] = useState<Note>(null);
  const [pwNote, setPwNote] = useState<Note>(null);
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const profileLock = useRef(false);
  const brandLock = useRef(false);
  const pwLock = useRef(false);
  const passwordDirty = Boolean(pw.current || pw.next || pw.confirm);

  function dirty(tab: CompanyInfoTabId) {
    return companyTabDirty(tab, form, savedForm, brand, savedBrand, passwordDirty);
  }

  function openSection(id: CompanyInfoTabId) {
    if (id === "branding") setBrandingSeen(true);
    const el = document.getElementById(`company-tab-${id}`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
    setSection(id);
  }

  async function saveProfile(which: "basic" | "additional") {
    if (profileLock.current) return;
    const setNote = which === "basic" ? setBasicNote : setDateNote;
    setNote(null);
    if (!form.name.trim()) {
      setNote({ ok: false, text: "Enter the ISP name." });
      return;
    }
    const submitted = form;
    profileLock.current = true;
    setProfileBusy(true);
    try {
      await renameTenant({ data: submitted });
      await reloadProfile(submitted);
      setNote({ ok: true, text: COMPANY_SAVE_OK });
    } catch (err) {
      setNote({ ok: false, text: companySaveError(err) });
    } finally {
      profileLock.current = false;
      setProfileBusy(false);
    }
  }

  async function saveBrand() {
    if (brandLock.current) return;
    setLegalNote(null);
    const submitted = brand;
    brandLock.current = true;
    setBrandBusy(true);
    try {
      await saveDocumentBranding({ data: submitted });
      await reloadBrand(submitted);
      setLegalNote({ ok: true, text: COMPANY_SAVE_OK });
    } catch (err) {
      setLegalNote({ ok: false, text: companySaveError(err) });
    } finally {
      brandLock.current = false;
      setBrandBusy(false);
    }
  }

  async function saveContact() {
    if (profileLock.current || brandLock.current) return;
    setContactNote(null);
    if (!form.name.trim()) {
      setContactNote({ ok: false, text: "Enter the ISP name." });
      return;
    }
    const submittedProfile = form;
    const submittedBrand = brand;
    profileLock.current = true;
    brandLock.current = true;
    setProfileBusy(true);
    setBrandBusy(true);
    try {
      await renameTenant({ data: submittedProfile });
      await reloadProfile(submittedProfile);
      try {
        await saveDocumentBranding({ data: submittedBrand });
        await reloadBrand(submittedBrand);
      } catch (err) {
        setContactNote({ ok: false, text: companySaveError(err) });
        return;
      }
      setContactNote({ ok: true, text: COMPANY_SAVE_OK });
    } catch (err) {
      setContactNote({ ok: false, text: companySaveError(err) });
    } finally {
      profileLock.current = false;
      brandLock.current = false;
      setProfileBusy(false);
      setBrandBusy(false);
    }
  }

  async function savePassword() {
    if (pwLock.current) return;
    setPwNote(null);
    if (pw.next !== pw.confirm) {
      setPwNote({ ok: false, text: "Passwords do not match" });
      return;
    }
    pwLock.current = true;
    setPwBusy(true);
    try {
      await changeMyPassword({ data: { current: pw.current, password: pw.next } });
      setPw({ current: "", next: "", confirm: "" });
      setPwNote({ ok: true, text: PASSWORD_SAVE_OK });
    } catch (err) {
      setPwNote({ ok: false, text: companySaveError(err) });
    } finally {
      pwLock.current = false;
      setPwBusy(false);
    }
  }

  const contactBusy = profileBusy || brandBusy;

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Company information"
        className="flex snap-x gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {COMPANY_INFO_TABS.map((tab) => {
          const active = section === tab.id;
          const unsaved = tab.id === "branding" ? brandingDirty : dirty(tab.id);
          const complete = tab.id === "basic" && basicInfoComplete(savedForm.name);
          return (
            <button
              key={tab.id}
              id={`company-tab-${tab.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`company-panel-${tab.id}`}
              data-company-tab={tab.id}
              className={cn(
                "h-11 shrink-0 snap-start rounded-lg px-4 text-sm font-medium transition-colors",
                active ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
              )}
              onClick={() => openSection(tab.id)}
            >
              {tab.label}
              {complete ? (
                <span className="ml-1" aria-label="Required name saved">
                  ✓
                </span>
              ) : null}
              {unsaved ? (
                <span className="ml-1" aria-label="Unsaved changes">
                  •
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <section
        id="company-panel-basic"
        role="tabpanel"
        aria-labelledby="company-tab-basic"
        hidden={section !== "basic"}
        className={section === "basic" ? "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile("basic");
          }}
        >
          {dirty("basic") ? <p className="text-xs text-muted">Unsaved changes</p> : null}
          <h2 className="font-medium">Basic information</h2>
          <Field label="ISP name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <p className="text-xs text-subtle">
            Role: {ws?.role} · Plan: {ws?.status} · Customer portal slug: <span className="font-mono text-fg">{slug}</span>
          </p>
          <p className="text-sm text-muted">
            Customers sign in at{" "}
            <a href="/portal" className="text-accent hover:underline">
              /portal
            </a>
            .
          </p>
          <SaveRow note={basicNote} busy={profileBusy} label="Save basic information" />
        </form>
      </section>

      <section
        id="company-panel-contact"
        role="tabpanel"
        aria-labelledby="company-tab-contact"
        hidden={section !== "contact"}
        className={section === "contact" ? "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveContact();
          }}
        >
          {dirty("contact") ? <p className="text-xs text-muted">Unsaved changes</p> : null}
          <h2 className="font-medium">Contact information</h2>
          <Field label="Support email">
            <Input value={form.supportEmail} onChange={(e) => setForm({ ...form, supportEmail: e.target.value })} />
          </Field>
          <Field label="Support phone">
            <Input value={form.supportPhone} onChange={(e) => setForm({ ...form, supportPhone: e.target.value })} />
          </Field>
          <Field label="Address">
            <Input value={brand.address} onChange={(e) => setBrand({ ...brand, address: e.target.value })} />
          </Field>
          <Field label="Website">
            <Input value={brand.website} onChange={(e) => setBrand({ ...brand, website: e.target.value })} />
          </Field>
          <SaveRow note={contactNote} busy={contactBusy} label="Save contact information" />
        </form>
      </section>

      <section
        id="company-panel-branding"
        role="tabpanel"
        aria-labelledby="company-tab-branding"
        hidden={section !== "branding"}
        className={section === "branding" ? "space-y-3" : "hidden"}
      >
        {brandingSeen ? (
          <>
            {brandingDirty ? <p className="text-xs text-muted">Unsaved changes</p> : null}
            <div>
              <h2 className="font-medium">Branding</h2>
              <p className="mt-1 text-sm text-muted">
                Logo, favicon, and colours for this ISP. Invoice accent colour follows the primary colour.
              </p>
            </div>
            <AppearanceSettings
              canManage={Boolean(ws && hasPermission(ws.role, "settings.manage"))}
              live={section === "branding"}
              embedded
              savedMessage={COMPANY_SAVE_OK}
              onDirtyChange={setBrandingDirty}
            />
          </>
        ) : null}
      </section>

      <section
        id="company-panel-legal"
        role="tabpanel"
        aria-labelledby="company-tab-legal"
        hidden={section !== "legal"}
        className={section === "legal" ? "grid max-w-xl gap-3 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveBrand();
          }}
        >
          {dirty("legal") ? <p className="text-xs text-muted">Unsaved changes</p> : null}
          <h2 className="font-medium">Business / legal</h2>
          <p className="text-sm text-muted">Shown on PDFs for this ISP only. Leave a field empty to hide it.</p>
          <Field label="Tax / PIN">
            <Input value={brand.tax_pin} onChange={(e) => setBrand({ ...brand, tax_pin: e.target.value })} />
          </Field>
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
          <SaveRow note={legalNote} busy={brandBusy} label="Save business information" />
        </form>
      </section>

      <section
        id="company-panel-additional"
        role="tabpanel"
        aria-labelledby="company-tab-additional"
        hidden={section !== "additional"}
        className={section === "additional" ? "grid max-w-xl gap-6 rounded-xl border border-border bg-surface p-4 md:p-5" : "hidden"}
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void saveProfile("additional");
          }}
        >
          {dirty("additional") ? <p className="text-xs text-muted">Unsaved changes</p> : null}
          <h2 className="font-medium">Additional information</h2>
          <Field label="Date format">
            <Select
              value={form.dateFormat}
              onChange={(e) => setForm({ ...form, dateFormat: normalizeDateFormat(e.target.value) })}
            >
              {DATE_FORMATS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label} — {opt.sample}
                </option>
              ))}
            </Select>
          </Field>
          <p className="text-xs text-muted">
            Used on every page, invoice, statement, SMS, and date field. Date entry uses this format (default dd/mm/yy).
            Preview: <span className="font-medium text-fg">{dateFormatExample(form.dateFormat)}</span>.
          </p>
          <SaveRow note={dateNote} busy={profileBusy} label="Save date format" />
        </form>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void savePassword();
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
          <SaveRow note={pwNote} busy={pwBusy} label="Update password" />
        </form>
      </section>
    </div>
  );
}

function SaveRow({
  note,
  busy,
  label,
}: {
  note: Note;
  busy: boolean;
  label: string;
}) {
  return (
    <>
      {note ? (
        <p role="status" aria-live="polite" className={note.ok ? "text-sm text-ok" : "text-sm text-danger"}>
          {note.text}
        </p>
      ) : null}
      <Button type="submit" disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : label}
      </Button>
    </>
  );
}

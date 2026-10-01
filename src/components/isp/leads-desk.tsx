import { useEffect, useState } from "react";
import { DateYmdInput } from "@/components/isp/date-ymd-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  COVERAGE_STATUSES,
  INSTALL_STATUSES,
  LEAD_STATUSES,
  leadStatusLabel,
  type LeadInput,
} from "@/lib/isp/leads-format";
import type { LeadRow } from "@/lib/isp/leads";
import {
  archiveLeadFn,
  convertLeadFn,
  createLeadFn,
  exportLeadsFn,
  getLeadFn,
  listLeadsFn,
  logLeadActivityFn,
  recordCoverageFn,
  recordInstallationFn,
  scheduleFollowUpFn,
  setLeadStatusFn,
  updateLeadFn,
} from "@/lib/isp/server-leads";

type Desk = Awaited<ReturnType<typeof listLeadsFn>>;
type Detail = Awaited<ReturnType<typeof getLeadFn>>;

const EMPTY: LeadInput = {
  name: "",
  phone: "",
  alternative_phone: "",
  email: "",
  identifier: "",
  lead_source: "Walk-in",
  lead_type: "individual",
  interested_package_id: "",
  latitude: "",
  longitude: "",
  county: "",
  town: "",
  area: "",
  building: "",
  physical_address: "",
  location_notes: "",
  preferred_contact_method: "phone",
  assigned_to: "",
  notes: "",
};

function toneFor(status: string) {
  if (status === "converted" || status === "covered" || status === "completed") return "ok";
  if (status === "lost" || status === "cancelled" || status === "outside_coverage" || status === "failed") return "danger";
  if (status === "qualified" || status === "confirmed" || status === "installation_completed") return "accent";
  return "muted";
}

function localWhen(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function rowToInput(row: LeadRow): LeadInput {
  return {
    name: row.name,
    phone: row.phone,
    alternative_phone: row.alternative_phone,
    email: row.email,
    identifier: row.identifier,
    lead_source: row.lead_source,
    lead_type: row.lead_type,
    interested_package_id: row.interested_package_id || "",
    latitude: row.latitude ?? "",
    longitude: row.longitude ?? "",
    county: row.county,
    town: row.town,
    area: row.area,
    building: row.building,
    physical_address: row.physical_address,
    location_notes: row.location_notes,
    preferred_contact_method: row.preferred_contact_method,
    assigned_to: row.assigned_to,
    notes: row.notes,
  };
}

export function LeadsDesk({ focusId }: { focusId?: string } = {}) {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [coverage, setCoverage] = useState("");
  const [sort, setSort] = useState("created");
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<LeadInput>(EMPTY);
  const [dirty, setDirty] = useState(false);
  const [locMsg, setLocMsg] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [convertOpen, setConvertOpen] = useState(false);
  const [useCustomerId, setUseCustomerId] = useState("");
  const [ack, setAck] = useState(false);
  const [expiry, setExpiry] = useState("");
  const [onboarding, setOnboarding] = useState<"new" | "continuing">("new");
  const [activation, setActivation] = useState<"after_payment" | "active">("after_payment");
  const [followAt, setFollowAt] = useState("");
  const [followNote, setFollowNote] = useState("");
  const [activityBody, setActivityBody] = useState("");
  const [installAt, setInstallAt] = useState("");
  const [installTech, setInstallTech] = useState("");
  const [installNotes, setInstallNotes] = useState("");
  const [coverageNotes, setCoverageNotes] = useState("");
  const [lostReason, setLostReason] = useState("");

  async function load(nextPage = page) {
    setBusy(true);
    try {
      const row = await listLeadsFn({ data: { q, status, coverage, page: nextPage, sort } });
      setDesk(row);
      setPage(nextPage);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not load leads");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (focusId) void openLead(focusId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  function patch(partial: Partial<LeadInput>) {
    setForm((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }

  function closeForm(next: boolean) {
    void (async () => {
      if (!next && dirty && !(await askConfirm({ title: "Discard unsaved lead changes?", description: "The lead form has changes that have not been saved.", confirmLabel: "Discard", variant: "warning" }))) return;
      setOpenForm(next);
      if (!next) {
        setDirty(false);
        setEditing(null);
        setForm(EMPTY);
        setLocMsg("");
      }
    })();
  }

  function locate() {
    if (!navigator.geolocation) {
      setLocMsg("Unable to get location");
      return;
    }
    setLocMsg("Getting location...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        patch({ latitude: pos.coords.latitude.toFixed(6), longitude: pos.coords.longitude.toFixed(6) });
        setLocMsg("Location acquired");
      },
      (err) => setLocMsg(err.code === 1 ? "Permission denied" : "Unable to get location"),
      { enableHighAccuracy: true, timeout: 12000 },
    );
  }

  async function saveForm() {
    setBusy(true);
    setNote(null);
    try {
      if (editing) await updateLeadFn({ data: { id: editing, ...form } });
      else await createLeadFn({ data: form });
      setDirty(false);
      setOpenForm(false);
      setEditing(null);
      setForm(EMPTY);
      setNote(editing ? "Lead updated." : "Lead saved. It is not a customer.");
      await load(1);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save the lead");
    } finally {
      setBusy(false);
    }
  }

  async function openLead(id: string) {
    setBusy(true);
    setNote(null);
    try {
      const row = await getLeadFn({ data: { id } });
      setDetail(row);
      setUseCustomerId("");
      setAck(false);
      setInstallAt(localWhen(row.lead.scheduled_installation_at));
      setInstallTech(row.lead.assigned_technician || "");
      setInstallNotes(row.lead.installation_notes || "");
      setCoverageNotes(row.lead.coverage_notes || "");
      setLostReason(row.lead.lost_reason || "");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not open the lead");
    } finally {
      setBusy(false);
    }
  }

  async function refreshDetail(id: string) {
    const row = await getLeadFn({ data: { id } });
    setDetail(row);
    await load(page);
  }

  const can = desk?.can;
  const report = desk?.report;
  const pages = Math.max(1, Math.ceil((desk?.total || 0) / (desk?.pageSize || 25)));
  const lat = Number(form.latitude);
  const lng = Number(form.longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng) && form.latitude !== "" && form.longitude !== "";
  const mapHref = hasPoint ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}` : "https://www.openstreetmap.org/#map=6/0.02/37.9";

  async function log(id: string, activity_type: "CALL" | "WHATSAPP" | "SMS" | "EMAIL") {
    try {
      await logLeadActivityFn({ data: { id, activity_type, body: activity_type } });
      if (detail?.lead.id === id) await refreshDetail(id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not record the activity");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted">Enquiries stay here until installation is confirmed and converted. They are not customers.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can?.export ? (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                try {
                  const file = await exportLeadsFn();
                  const blob = new Blob([file.csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "leads.csv";
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setNote(err instanceof Error ? err.message : "Could not export");
                }
              }}
            >
              Export
            </Button>
          ) : null}
          {can?.create ? (
            <Button
              onClick={() => {
                setEditing(null);
                setForm(EMPTY);
                setDirty(false);
                setLocMsg("");
                setOpenForm(true);
              }}
            >
              + Add Lead
            </Button>
          ) : null}
        </div>
      </div>

      {note ? <p className="text-sm text-muted">{note}</p> : null}

      {report ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-7">
          {[
            ["New", report.fresh],
            ["Qualified", report.qualified],
            ["Follow-ups due", report.followups],
            ["Installation", report.installationPending],
            ["Converted", report.converted],
            ["Lost", report.lost],
            ["Conversion", `${report.conversionRate}%`],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border border-border bg-surface px-3 py-3">
              <div className="text-xs text-muted">{label}</div>
              <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search name, phone, area, lead number" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-[12rem]" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>{leadStatusLabel(s)}</option>
          ))}
        </Select>
        <Select className="max-w-[12rem]" value={coverage} onChange={(e) => setCoverage(e.target.value)}>
          <option value="">All coverage</option>
          {COVERAGE_STATUSES.map((s) => (
            <option key={s} value={s}>{leadStatusLabel(s)}</option>
          ))}
        </Select>
        <Select className="max-w-[12rem]" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="created">Newest</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
          <option value="follow_up">Follow-up</option>
        </Select>
        <Button variant="secondary" disabled={busy} onClick={() => void load(1)}>Search</Button>
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
        <table className="w-full min-w-[880px] text-left text-sm">
          <thead className="border-b border-border text-xs tracking-wide text-muted uppercase">
            <tr>
              {["Lead", "Phone", "Area", "Package", "Source", "Status", "Coverage", "Installation", "Assigned", "Created", "Follow-up"].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(desk?.rows || []).map((row) => (
              <tr key={row.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <button type="button" className="text-left" onClick={() => void openLead(row.id)}>
                    <div className="font-medium">{row.name}</div>
                    <div className="font-mono text-xs text-muted">{row.lead_number}</div>
                  </button>
                </td>
                <td className="px-3 py-2">{row.phone}</td>
                <td className="px-3 py-2">{row.area || row.town || "—"}</td>
                <td className="px-3 py-2">{row.package_name || "—"}</td>
                <td className="px-3 py-2">{row.lead_source}</td>
                <td className="px-3 py-2"><Badge tone={toneFor(row.status)}>{leadStatusLabel(row.status)}</Badge></td>
                <td className="px-3 py-2">{leadStatusLabel(row.coverage_status)}</td>
                <td className="px-3 py-2">{leadStatusLabel(row.installation_status)}</td>
                <td className="px-3 py-2">{row.assignee_name || "—"}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.created_at.slice(0, 10)}</td>
                <td className="px-3 py-2 whitespace-nowrap">{row.next_follow_up_at ? row.next_follow_up_at.slice(0, 16).replace("T", " ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {desk && desk.rows.length === 0 ? (
          <div className="px-4 py-8">
            <p className="font-medium">No leads yet</p>
            <p className="mt-1 max-w-md text-sm text-muted">Capture enquiries and convert qualified leads into customers after installation.</p>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 md:hidden">
        {(desk?.rows || []).map((row) => (
          <button key={row.id} type="button" className="w-full rounded-xl border border-border bg-surface p-3 text-left" onClick={() => void openLead(row.id)}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-medium">{row.name}</div>
                <div className="text-xs text-muted">{row.lead_number} · {row.phone}</div>
              </div>
              <Badge tone={toneFor(row.status)}>{leadStatusLabel(row.status)}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">{row.area || "No area"} · {row.package_name || "No package"} · {row.lead_source}</p>
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted">{desk?.total ?? 0} leads</span>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={page <= 1 || busy} onClick={() => void load(page - 1)}>Previous</Button>
          <span className="inline-flex h-9 items-center">{page} / {pages}</span>
          <Button size="sm" variant="secondary" disabled={page >= pages || busy} onClick={() => void load(page + 1)}>Next</Button>
        </div>
      </div>

      {report ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Breakdown title="By source" rows={report.bySource} />
          <Breakdown title="By area" rows={report.byArea} />
          <Breakdown title="By package" rows={report.byPackage} />
          <Breakdown title="By salesperson" rows={report.byStaff} />
          <Breakdown title="Lost reasons" rows={report.lostReasons} />
          <div className="rounded-xl border border-border bg-surface p-4 text-sm">
            <h2 className="font-medium">Time to conversion</h2>
            <p className="mt-2 text-muted">Average {report.averageDays} days from lead to customer. Revenue is not estimated here.</p>
          </div>
        </div>
      ) : null}

      <Dialog
        open={openForm}
        onOpenChange={closeForm}
        title={editing ? "Edit lead" : "Add lead"}
        description="A lead is not created as a customer."
        className="sm:max-w-2xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => closeForm(false)}>Cancel</Button>
            <Button type="button" disabled={busy} onClick={() => void saveForm()}>{busy ? "Saving..." : "Save lead"}</Button>
          </div>
        }
      >
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void saveForm();
          }}
        >
          <Section title="Lead information">
            <Field label="Lead name"><Input value={form.name} onChange={(e) => patch({ name: e.target.value })} required /></Field>
            <Field label="Phone number"><Input value={form.phone} onChange={(e) => patch({ phone: e.target.value })} required /></Field>
            <Field label="Alternative phone"><Input value={form.alternative_phone || ""} onChange={(e) => patch({ alternative_phone: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email || ""} onChange={(e) => patch({ email: e.target.value })} /></Field>
            <Field label="National or company ID"><Input value={form.identifier || ""} onChange={(e) => patch({ identifier: e.target.value })} /></Field>
            <Field label="Lead source">
              <Select value={form.lead_source || ""} onChange={(e) => patch({ lead_source: e.target.value })}>
                {(desk?.sources || []).map((s) => <option key={s.id} value={s.name}>{s.name}</option>)}
                {form.lead_source && !(desk?.sources || []).some((s) => s.name === form.lead_source) ? <option value={form.lead_source}>{form.lead_source}</option> : null}
              </Select>
            </Field>
            <Field label="Lead type">
              <Select value={form.lead_type || "individual"} onChange={(e) => patch({ lead_type: e.target.value })}>
                <option value="individual">Individual</option>
                <option value="business">Business</option>
              </Select>
            </Field>
            <Field label="Interested package">
              <Select value={form.interested_package_id || ""} onChange={(e) => patch({ interested_package_id: e.target.value })}>
                <option value="">None yet</option>
                {(desk?.packages || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label="Preferred contact">
              <Select value={form.preferred_contact_method || "phone"} onChange={(e) => patch({ preferred_contact_method: e.target.value })}>
                <option value="phone">Phone</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="sms">SMS</option>
                <option value="email">Email</option>
              </Select>
            </Field>
            <Field label="Assigned to">
              <Select value={form.assigned_to || ""} onChange={(e) => patch({ assigned_to: e.target.value })}>
                <option value="">Unassigned</option>
                {(desk?.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes"><Textarea value={form.notes || ""} onChange={(e) => patch({ notes: e.target.value })} /></Field>
            </div>
          </Section>
          <Section title="Location">
            <Field label="Latitude"><Input inputMode="decimal" value={form.latitude ?? ""} onChange={(e) => patch({ latitude: e.target.value })} /></Field>
            <Field label="Longitude"><Input inputMode="decimal" value={form.longitude ?? ""} onChange={(e) => patch({ longitude: e.target.value })} /></Field>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button type="button" variant="secondary" onClick={locate}>Get current location</Button>
              <a className="inline-flex h-11 items-center rounded-md border border-border px-4 text-sm" href={mapHref} target="_blank" rel="noreferrer">Select on map</a>
              {hasPoint ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(`${lat}, ${lng}`);
                      setLocMsg("Coordinates copied");
                    } catch {
                      setLocMsg("Unable to copy coordinates");
                    }
                  }}
                >
                  Copy coordinates
                </Button>
              ) : null}
            </div>
            {locMsg ? <p className="text-sm text-muted md:col-span-2">{locMsg}</p> : null}
            {hasPoint ? (
              <iframe title="Lead location" className="h-48 w-full rounded-lg border border-border md:col-span-2" src={`https://www.openstreetmap.org/export/embed.html?bbox=${lng - 0.01}%2C${lat - 0.01}%2C${lng + 0.01}%2C${lat + 0.01}&layer=mapnik&marker=${lat}%2C${lng}`} />
            ) : null}
          </Section>
          <Section title="Address">
            <Field label="County"><Input value={form.county || ""} onChange={(e) => patch({ county: e.target.value })} /></Field>
            <Field label="Town"><Input value={form.town || ""} onChange={(e) => patch({ town: e.target.value })} /></Field>
            <Field label="Estate / area"><Input value={form.area || ""} onChange={(e) => patch({ area: e.target.value })} /></Field>
            <Field label="Building / plot"><Input value={form.building || ""} onChange={(e) => patch({ building: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Field label="Physical address"><Input value={form.physical_address || ""} onChange={(e) => patch({ physical_address: e.target.value })} /></Field>
            </div>
            <div className="md:col-span-2">
              <Field label="Location notes"><Textarea value={form.location_notes || ""} onChange={(e) => patch({ location_notes: e.target.value })} /></Field>
            </div>
          </Section>
        </form>
      </Dialog>

      <Dialog open={Boolean(detail)} onOpenChange={(next) => { if (!next) setDetail(null); }} title={detail ? `${detail.lead.name}` : "Lead"} description={detail?.lead.lead_number} placement="drawer" className="sm:max-w-xl">
        {detail ? (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone={toneFor(detail.lead.status)}>{leadStatusLabel(detail.lead.status)}</Badge>
              <Badge>{leadStatusLabel(detail.lead.coverage_status)}</Badge>
              <Badge>{leadStatusLabel(detail.lead.installation_status)}</Badge>
            </div>
            <Block title="Contact">
              <p>{detail.lead.phone}{detail.lead.alternative_phone ? ` · ${detail.lead.alternative_phone}` : ""}</p>
              <p className="text-muted">{detail.lead.email || "No email"} · prefers {detail.lead.preferred_contact_method}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {can?.update ? <Channel href={`tel:${detail.lead.phone}`} label="Call" onLog={() => void log(detail.lead.id, "CALL")} /> : null}
                {can?.update ? <Channel href={`https://wa.me/${detail.lead.phone.replace(/\D/g, "")}`} label="WhatsApp" onLog={() => void log(detail.lead.id, "WHATSAPP")} /> : null}
                {can?.update ? <Channel href={`sms:${detail.lead.phone}`} label="SMS" onLog={() => void log(detail.lead.id, "SMS")} /> : null}
                {can?.update && detail.lead.email ? <Channel href={`mailto:${detail.lead.email}`} label="Email" onLog={() => void log(detail.lead.id, "EMAIL")} /> : null}
              </div>
            </Block>
            <Block title="Location">
              <p>{[detail.lead.physical_address, detail.lead.building, detail.lead.area, detail.lead.town, detail.lead.county].filter(Boolean).join(", ") || "No address yet"}</p>
              {detail.lead.latitude != null && detail.lead.longitude != null ? (
                <p className="mt-1 font-mono text-xs">{detail.lead.latitude}, {detail.lead.longitude}</p>
              ) : <p className="mt-1 text-muted">No GPS yet</p>}
              <div className="mt-2 flex flex-wrap gap-3">
                {detail.lead.latitude != null && detail.lead.longitude != null ? (
                  <a className="text-accent hover:underline" href={`https://www.openstreetmap.org/?mlat=${detail.lead.latitude}&mlon=${detail.lead.longitude}#map=17/${detail.lead.latitude}/${detail.lead.longitude}`} target="_blank" rel="noreferrer">Open map</a>
                ) : null}
                {detail.lead.latitude != null && detail.lead.longitude != null ? (
                  <button
                    type="button"
                    className="text-accent hover:underline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`${detail.lead.latitude}, ${detail.lead.longitude}`);
                        setNote("Coordinates copied");
                      } catch {
                        setNote("Unable to copy coordinates");
                      }
                    }}
                  >
                    Copy coordinates
                  </button>
                ) : null}
                <button type="button" className="text-accent hover:underline" onClick={() => { setForm(rowToInput(detail.lead)); setEditing(detail.lead.id); setDirty(false); setOpenForm(true); }}>Edit</button>
              </div>
            </Block>
            <Block title="Sales">
              <p>{detail.lead.lead_source} · {detail.lead.package_name || "No package"} · {detail.lead.assignee_name || "Unassigned"}</p>
              {detail.lead.notes ? <p className="mt-1 text-muted">{detail.lead.notes}</p> : null}
            </Block>
            {can?.coverage ? (
              <Block title="Coverage">
                <div className="flex flex-wrap gap-2">
                  {COVERAGE_STATUSES.map((s) => (
                    <Button key={s} size="sm" variant={detail.lead.coverage_status === s ? "default" : "secondary"} disabled={busy} onClick={async () => {
                      await recordCoverageFn({ data: { id: detail.lead.id, coverage_status: s, coverage_notes: coverageNotes } });
                      await refreshDetail(detail.lead.id);
                    }}>{leadStatusLabel(s)}</Button>
                  ))}
                </div>
                <Field label="Coverage notes">
                  <Textarea value={coverageNotes} onChange={(e) => setCoverageNotes(e.target.value)} />
                </Field>
              </Block>
            ) : null}
            {can?.installation ? (
              <Block title="Installation">
                <div className="flex flex-wrap gap-2">
                  {INSTALL_STATUSES.map((s) => (
                    <Button key={s} size="sm" variant={detail.lead.installation_status === s ? "default" : "secondary"} disabled={busy} onClick={async () => {
                      await recordInstallationFn({
                        data: {
                          id: detail.lead.id,
                          installation_status: s,
                          scheduled_installation_at: installAt || null,
                          assigned_technician: installTech,
                          installation_notes: installNotes,
                        },
                      });
                      await refreshDetail(detail.lead.id);
                    }}>{leadStatusLabel(s)}</Button>
                  ))}
                </div>
                <div className="mt-3 grid gap-2">
                  <Field label="Scheduled installation">
                    <Input type="datetime-local" value={installAt} onChange={(e) => setInstallAt(e.target.value)} />
                  </Field>
                  <Field label="Technician">
                    <Select value={installTech} onChange={(e) => setInstallTech(e.target.value)}>
                      <option value="">Unassigned</option>
                      {(desk?.staff || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </Select>
                  </Field>
                  <Field label="Installation notes">
                    <Textarea value={installNotes} onChange={(e) => setInstallNotes(e.target.value)} />
                  </Field>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={async () => {
                    const status = detail.lead.installation_status === "not_scheduled" && installAt ? "scheduled" : detail.lead.installation_status;
                    await recordInstallationFn({
                      data: {
                        id: detail.lead.id,
                        installation_status: status,
                        scheduled_installation_at: installAt || null,
                        assigned_technician: installTech,
                        installation_notes: installNotes,
                      },
                    });
                    await refreshDetail(detail.lead.id);
                    setNote("Installation saved. A customer is not created until you convert.");
                  }}>Save installation</Button>
                </div>
                <p className="mt-2 text-muted">Completing installation does not create a customer. Confirm and convert after the job is done.</p>
              </Block>
            ) : null}
            {can?.update ? (
              <Block title="Status">
                <Select value={detail.lead.status} onChange={async (e) => {
                  const next = e.target.value;
                  const needsReason = next === "lost" || next === "not_interested" || next === "outside_coverage";
                  if (needsReason && !lostReason.trim()) {
                    setNote("Add a reason before marking the lead lost, not interested, or outside coverage.");
                    return;
                  }
                  await setLeadStatusFn({ data: { id: detail.lead.id, status: next, lost_reason: needsReason ? lostReason.trim() : lostReason } });
                  await refreshDetail(detail.lead.id);
                }}>
                  {LEAD_STATUSES.filter((s) => s !== "converted").map((s) => <option key={s} value={s}>{leadStatusLabel(s)}</option>)}
                </Select>
                <Field label="Reason">
                  <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="Required when the lead is lost" />
                </Field>
              </Block>
            ) : null}
            {can?.assign || can?.update ? (
              <Block title="Follow-up">
                <div className="grid gap-2">
                  <Input type="datetime-local" value={followAt} onChange={(e) => setFollowAt(e.target.value)} />
                  <Input placeholder="Note" value={followNote} onChange={(e) => setFollowNote(e.target.value)} />
                  <Button size="sm" variant="secondary" disabled={busy || !followAt} onClick={async () => {
                    await scheduleFollowUpFn({ data: { id: detail.lead.id, next_follow_up_at: followAt, note: followNote } });
                    setFollowNote("");
                    await refreshDetail(detail.lead.id);
                  }}>Schedule follow-up</Button>
                </div>
              </Block>
            ) : null}
            {can?.update ? (
              <Block title="Add note">
                <Textarea value={activityBody} onChange={(e) => setActivityBody(e.target.value)} />
                <Button className="mt-2" size="sm" variant="secondary" disabled={busy || !activityBody.trim()} onClick={async () => {
                  await logLeadActivityFn({ data: { id: detail.lead.id, activity_type: "NOTE", body: activityBody } });
                  setActivityBody("");
                  await refreshDetail(detail.lead.id);
                }}>Add note</Button>
              </Block>
            ) : null}
            <Block title="Activity">
              <ul className="space-y-2">
                {detail.activities.map((a) => (
                  <li key={a.id}>
                    <div className="text-xs text-muted">{a.created_at.slice(0, 16).replace("T", " ")} · {a.activity_type}</div>
                    <div>{a.body}</div>
                  </li>
                ))}
              </ul>
            </Block>
            {detail.lead.conversion_status === "converted" ? (
              <p className="rounded-lg border border-border p-3">Converted {detail.lead.converted_customer_label}. Customer and service links stay on this lead.</p>
            ) : can?.convert ? (
              <Button disabled={detail.lead.installation_status !== "completed"} onClick={() => setConvertOpen(true)}>
                Confirm & convert to customer
              </Button>
            ) : null}
            {detail.lead.installation_status !== "completed" && detail.lead.conversion_status !== "converted" ? (
              <p className="text-muted">Mark installation completed before converting.</p>
            ) : null}
            {can?.remove && detail.lead.conversion_status !== "converted" ? (
              <Button variant="ghost" disabled={busy} onClick={async () => {
                if (!(await askConfirm({ title: "Archive this lead?", description: "It will leave the active list. The record is kept.", confirmLabel: "Archive lead", variant: "danger" }))) return;
                await archiveLeadFn({ data: { id: detail.lead.id } });
                setDetail(null);
                await load(page);
              }}>Archive lead</Button>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog open={convertOpen && Boolean(detail)} onOpenChange={setConvertOpen} title="Confirm & convert to customer" description="This creates or reuses a customer and creates the selected service. The lead stays as history.">
        {detail ? (
          <div className="space-y-3 text-sm">
            <p><strong>{detail.lead.name}</strong> · {detail.lead.phone}</p>
            <p>Installation: {leadStatusLabel(detail.lead.installation_status)}{detail.lead.completed_installation_at ? ` · ${detail.lead.completed_installation_at.slice(0, 16).replace("T", " ")}` : detail.lead.scheduled_installation_at ? ` · scheduled ${detail.lead.scheduled_installation_at.slice(0, 16).replace("T", " ")}` : ""}</p>
            <p>Package: {detail.lead.package_name || "None — customer only"}</p>
            <p>Location: {[detail.lead.area, detail.lead.town].filter(Boolean).join(", ") || "—"}</p>
            {detail.matches.length ? (
              <div className="space-y-2">
                <p className="font-medium">Existing customer found</p>
                {detail.matches.map((m) => (
                  <label key={m.id} className="flex items-start gap-2 rounded-lg border border-border p-2">
                    <input type="radio" name="existing" checked={useCustomerId === m.id} onChange={() => setUseCustomerId(m.id)} />
                    <span>{m.name} · {m.phone} · {m.account_number || m.id}{m.blocking ? " · same phone" : ""}</span>
                  </label>
                ))}
                <button type="button" className="text-accent" onClick={() => setUseCustomerId("")}>Create new customer</button>
              </div>
            ) : <p>No matching customer. A new customer will be created.</p>}
            {!useCustomerId && detail.matches.length ? (
              <label className="flex items-center gap-2"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> I still want a new customer</label>
            ) : null}
            <Field label="How this service starts">
              <Select value={onboarding} onChange={(e) => setOnboarding(e.target.value === "continuing" ? "continuing" : "new")}>
                <option value="new">New installation</option>
                <option value="continuing">Continuing client — keep their expiry date</option>
              </Select>
            </Field>
            <Field label="Expiry date">
              <DateYmdInput value={expiry} onChange={setExpiry} aria-label="Expiry date" />
            </Field>
            <Field label="Activation">
              <Select value={activation} onChange={(e) => setActivation(e.target.value === "active" ? "active" : "after_payment")}>
                <option value="after_payment">Activate after full payment</option>
                <option value="active">Start as active</option>
              </Select>
            </Field>
            <p className="text-muted">This action will create or reuse a customer and create the selected service. The lead will remain available as historical CRM data.</p>
            <Button disabled={busy} onClick={async () => {
              if (!detail) return;
              if (!useCustomerId && detail.matches.some((m) => m.blocking)) {
                setNote("Choose the existing customer. A duplicate will not be created.");
                return;
              }
              setBusy(true);
              try {
                const result = await convertLeadFn({
                  data: {
                    id: detail.lead.id,
                    useCustomerId: useCustomerId || undefined,
                    acknowledgeDuplicates: ack,
                    expiryYmd: expiry,
                    onboardingType: onboarding,
                    activation,
                    sendNotification: false,
                    confirmed: true,
                  },
                });
                setConvertOpen(false);
                setNote(`Converted ${detail.lead.lead_number} to customer ${result.account_number || result.customer_id}.`);
                await refreshDetail(detail.lead.id);
              } catch (err) {
                setNote(err instanceof Error ? err.message : "Conversion failed. The lead was not converted.");
              } finally {
                setBusy(false);
              }
            }}>Confirm & convert</Button>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="grid gap-3 md:grid-cols-2">{children}</div>
    </section>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xs tracking-wide text-muted uppercase">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Breakdown({ title, rows }: { title: string; rows: { label: string; n: number }[] }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h2 className="text-sm font-medium">{title}</h2>
      {rows.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing yet.</p> : (
        <ul className="mt-2 space-y-1 text-sm">
          {rows.map((row) => (
            <li key={row.label} className="flex justify-between gap-3"><span>{row.label}</span><span className="tabular-nums">{row.n}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Channel({ href, label, onLog }: { href: string; label: string; onLog: () => void }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-md border border-border px-3" onClick={onLog}>
      {label}
    </a>
  );
}

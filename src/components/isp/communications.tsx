import { Link } from "@tanstack/react-router";
import { Check, ChevronDown, CircleCheck, TriangleAlert, Wrench } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { DateYmdInput } from "@/components/isp/date-ymd-input";
import {
  ACTIVITY_HELP,
  ACTIVITY_WINDOWS,
  audienceSummary,
  categoryLabel,
  COMM_CATEGORIES,
  COMM_CHANNELS,
  COMM_VARS,
  filterSignature,
  insertCommVar,
  isCurrentPreview,
  parseAudienceFilter,
  parseCommExtras,
  recipientStatusLabel,
  renderCommTemplate,
  smsSegments,
  toggleFilterValue,
  type AudienceFilter,
  type CommCategory,
  type CommChannel,
  type CommExtras,
  type CommVarKey,
} from "@/lib/isp/comms-format";
import { hasPermission } from "@/lib/isp/rbac";
import { formatDate, formatShortDateTime } from "@/lib/isp/display";
import {
  deleteCommTemplateFn,
  getCampaignFn,
  getCommsMetaFn,
  listCampaignsFn,
  previewAudienceFn,
  resendFailedFn,
  saveCommTemplateFn,
  sendCampaignFn,
  tickCampaignFn,
} from "@/lib/isp/server-comms";
import { cn } from "@/lib/utils";

type Meta = Awaited<ReturnType<typeof getCommsMetaFn>>;
type CampaignRow = Awaited<ReturnType<typeof listCampaignsFn>>["campaigns"][number];
type CampaignDetail = Awaited<ReturnType<typeof getCampaignFn>>;
type Preview = Awaited<ReturnType<typeof previewAudienceFn>>;
type Pane = "compose" | "templates" | "history" | "report";
type StatusKey = NonNullable<AudienceFilter["statuses"]>[number];
type AccessKey = NonNullable<AudienceFilter["access"]>[number];

const STATUSES: { id: StatusKey; label: string }[] = [
  { id: "active", label: "Active" },
  { id: "suspended", label: "Suspended" },
  { id: "expired", label: "Expired" },
  { id: "grace", label: "Grace period" },
];
const ACCESS: { id: AccessKey; label: string }[] = [
  { id: "pppoe", label: "PPPoE" },
  { id: "static", label: "Static IP" },
  { id: "hotspot", label: "Hotspot" },
];

const MESSAGE_GROUPS: { id: string; label: string; ids: CommCategory[] }[] = [
  {
    id: "service",
    label: "Service",
    ids: ["service_interruption", "planned_maintenance", "unplanned_outage", "service_restored"],
  },
  { id: "billing", label: "Billing", ids: ["payment_reminder"] },
  {
    id: "general",
    label: "Marketing & General",
    ids: ["general_announcement", "special_offer", "package_promotion", "custom_notice"],
  },
];

function messageIcon(id: CommCategory) {
  const className = "size-3.5 shrink-0";
  if (id === "unplanned_outage" || id === "service_interruption") return <TriangleAlert className={className} aria-hidden />;
  if (id === "planned_maintenance") return <Wrench className={className} aria-hidden />;
  if (id === "service_restored") return <CircleCheck className={className} aria-hidden />;
  return null;
}

type ChoiceOption = { id: string; label: string; icon?: ReactNode };
type ChoiceSection = { id: string; label?: string; options: ChoiceOption[] };

function ChoiceGroup({
  name,
  label,
  value,
  sections,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  sections: ChoiceSection[];
  onChange: (id: string) => void;
}) {
  const options = sections.flatMap((section) => section.options);
  const anySelected = options.some((option) => option.id === value);
  const firstId = options[0]?.id;

  function move(from: string, dir: 1 | -1) {
    const index = options.findIndex((option) => option.id === from);
    if (index < 0 || !options.length) return;
    const next = options[(index + dir + options.length) % options.length];
    if (!next) return;
    onChange(next.id);
    const nodeId = `${name}-${next.id || "none"}`;
    queueMicrotask(() => document.getElementById(nodeId)?.focus());
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(id, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(id, -1);
    }
  }

  return (
    <div role="radiogroup" aria-label={label} className="space-y-3">
      {sections.map((section) => (
        <div key={section.id}>
          {section.label ? <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">{section.label}</p> : null}
          <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-elevated/40 p-1">
            {section.options.map((option) => {
              const selected = value === option.id;
              return (
                <button
                  key={option.id || "none"}
                  id={`${name}-${option.id || "none"}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected || (!anySelected && option.id === firstId) ? 0 : -1}
                  onClick={() => onChange(option.id)}
                  onKeyDown={(event) => onKeyDown(event, option.id)}
                  className={cn(
                    "inline-flex h-9 max-w-full items-center gap-1.5 rounded-md px-3 text-left text-sm",
                    selected ? "bg-surface font-medium text-fg shadow-sm ring-1 ring-border" : "text-muted hover:bg-surface/80 hover:text-fg",
                  )}
                >
                  {option.icon}
                  <span className="truncate">{option.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function FilterChip({
  on,
  onClick,
  children,
  tone,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: string;
}) {
  const selected =
    tone === "ok"
      ? "border-ok/70 bg-ok/15 text-ok"
      : tone === "warn"
        ? "border-warn/70 bg-warn/15 text-warn"
        : tone === "danger"
          ? "border-danger/70 bg-danger/15 text-danger"
          : "border-border bg-elevated text-fg";
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 max-w-full items-center gap-1.5 rounded-full border px-3 text-sm",
        on ? selected : "border-border bg-transparent text-muted hover:bg-elevated hover:text-fg",
      )}
    >
      {on ? <Check className="size-3.5 shrink-0" aria-hidden /> : <span className="size-3.5 shrink-0" aria-hidden />}
      <span className="truncate">{children}</span>
    </button>
  );
}

function MoreFilters({
  open,
  count,
  onToggle,
  children,
}: {
  open: boolean;
  count: number;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="inline-flex h-9 items-center gap-1.5 rounded-md px-1 text-sm text-muted hover:text-fg"
      >
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden />
        More filters
        {!open && count > 0 ? <span className="text-fg">({count} selected)</span> : null}
      </button>
      {open ? <div className="mt-2">{children}</div> : null}
    </div>
  );
}

function messageSections(): ChoiceSection[] {
  const grouped = new Set(MESSAGE_GROUPS.flatMap((group) => group.ids));
  const extra = COMM_CATEGORIES.map((item) => item.id).filter((id) => !grouped.has(id));
  return MESSAGE_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    options: (group.id === "general" ? [...group.ids, ...extra] : group.ids).map((id) => ({
      id,
      label: COMM_CATEGORIES.find((item) => item.id === id)?.label ?? id,
      icon: messageIcon(id),
    })),
  }));
}

function formatWhen(iso: string | null | undefined) {
  return formatShortDateTime(iso);
}

function prettyDate(iso: string) {
  if (!iso) return "";
  const formatted = formatDate(iso);
  return formatted === "—" ? iso : formatted;
}

function campaignName(category: CommCategory, extras: CommExtras) {
  const label = categoryLabel(category);
  if (extras.maintenance_date) return `${label} — ${prettyDate(extras.maintenance_date) || extras.maintenance_date}`;
  if (extras.area) return `${label} — ${extras.area}`;
  return `${label} — ${formatDate(new Date().toISOString())}`;
}

function sampleVars(meta: Meta, extras: CommExtras, filter: AudienceFilter): Record<CommVarKey, string> {
  return {
    customer_name: "Customer",
    account_number: "ACC-0001",
    service_name: "Internet",
    package_name: meta.packages.find((p) => filter.package_ids?.includes(p.id))?.name || "package",
    service_expiry: "soon",
    maintenance_date: extras.maintenance_date ? prettyDate(extras.maintenance_date) || extras.maintenance_date : "",
    maintenance_start: extras.maintenance_start || "",
    maintenance_end: extras.maintenance_end || "",
    expected_duration: extras.expected_duration || "",
    expected_time: extras.expected_time || "",
    area: extras.area || filter.area || "your area",
    support_contact: meta.support,
    company_name: meta.company,
  };
}

export function Communications() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pane, setPane] = useState<Pane>("compose");
  const [category, setCategory] = useState<CommCategory>("planned_maintenance");
  const [channel, setChannel] = useState<CommChannel>("sms");
  const [templateId, setTemplateId] = useState("");
  const [body, setBody] = useState("");
  const [name, setName] = useState("");
  const [filter, setFilter] = useState<AudienceFilter>({});
  const [extras, setExtras] = useState<CommExtras>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewPage, setPreviewPage] = useState(1);
  const [showSkipped, setShowSkipped] = useState(false);
  const [review, setReview] = useState(false);
  const [confirmLarge, setConfirmLarge] = useState(false);
  const [confirmDuplicate, setConfirmDuplicate] = useState(false);
  const [duplicateNote, setDuplicateNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([]);
  const [report, setReport] = useState<CampaignDetail | null>(null);
  const [reportStatus, setReportStatus] = useState("");
  const [reportPage, setReportPage] = useState(1);
  const [restoreOf, setRestoreOf] = useState<string | undefined>(undefined);
  const [tplForm, setTplForm] = useState({ id: "", category: "planned_maintenance" as CommCategory, name: "", body: "" });
  const [serviceMore, setServiceMore] = useState(false);
  const [customerMore, setCustomerMore] = useState(false);
  const [previewPending, setPreviewPending] = useState(false);
  const previewRequest = useRef(0);

  const filterKey = filterSignature(filter);

  async function loadMeta() {
    try {
      const next = await getCommsMetaFn();
      setMeta(next);
      setForbidden(false);
      const first = next.templates.find((t) => t.category === category && t.enabled) ?? next.templates.find((t) => t.enabled);
      if (first && !body) {
        setTemplateId(first.id);
        setBody(first.body);
        setCategory(first.category as CommCategory);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not load communications";
      if (message.toLowerCase().includes("forbidden")) setForbidden(true);
      else setLoadError(message);
    }
  }

  async function loadHistory() {
    try {
      const res = await listCampaignsFn();
      setCampaigns(res.campaigns);
    } catch {
      /* view-only roles still reach compose; history is gated server-side */
    }
  }

  useEffect(() => {
    loadMeta().catch(console.error);
    loadHistory().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!meta) return;
    let alive = true;
    const requestId = ++previewRequest.current;
    setPreviewPending(true);
    const timer = setTimeout(() => {
      previewAudienceFn({ data: { filter, page: previewPage, skipped: showSkipped, channel } })
        .then((res) => {
          if (!alive || !isCurrentPreview(requestId, previewRequest.current)) return;
          setPreview(res);
        })
        .catch((err) => {
          if (!alive || !isCurrentPreview(requestId, previewRequest.current)) return;
          setNote(err instanceof Error ? err.message : "Could not preview recipients");
        })
        .finally(() => {
          if (alive && isCurrentPreview(requestId, previewRequest.current)) setPreviewPending(false);
        });
    }, 280);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [meta, filter, filterKey, previewPage, showSkipped, channel]);

  useEffect(() => {
    if (filter.package_ids?.length) setServiceMore(true);
  }, [filter.package_ids]);

  useEffect(() => {
    if (filter.tag_ids?.length) setCustomerMore(true);
  }, [filter.tag_ids]);

  useEffect(() => {
    if (pane !== "report" || report?.campaign.status !== "sending" || !report.campaign.id) return;
    const timer = setInterval(() => {
      tickCampaignFn({ data: { id: report.campaign.id } })
        .then(async (campaign) => {
          const next = await getCampaignFn({ data: { id: campaign.id, page: reportPage, status: reportStatus || undefined } });
          setReport(next);
        })
        .catch(console.error);
    }, 2000);
    return () => clearInterval(timer);
  }, [pane, report?.campaign.id, report?.campaign.status, reportPage, reportStatus]);

  const templates = useMemo(() => (meta?.templates ?? []).filter((t) => t.category === category && t.enabled), [meta, category]);
  const packageNames = useMemo(
    () => (meta?.packages ?? []).filter((p) => filter.package_ids?.includes(p.id)).map((p) => p.name),
    [meta, filter.package_ids],
  );
  const sample = meta ? renderCommTemplate(body, sampleVars(meta, extras, filter)) : body;
  const segments = smsSegments(sample);
  const valid = preview?.valid ?? 0;
  const skipped = preview?.skipped ?? 0;
  const total = preview?.total ?? 0;
  const parts = segments.parts || (body.trim() ? 1 : 0);
  const estimated = valid * parts;
  const canSend = Boolean(meta && hasPermission(meta.role, "communications.send"));
  const canTemplates = Boolean(meta && hasPermission(meta.role, "communications.templates.manage"));
  const tagNames = useMemo(
    () => (meta?.tags ?? []).filter((tag) => filter.tag_ids?.includes(tag.id)).map((tag) => tag.name),
    [meta, filter.tag_ids],
  );
  const summary = audienceSummary(filter, {
    packageNames,
    tagNames,
    typeLabel: filter.types?.length === 1 ? filter.types[0] : undefined,
  });
  const large = valid >= 50;

  function applyTemplate(id: string, nextCategory = category) {
    const tpl = (meta?.templates ?? []).find((t) => t.id === id);
    setTemplateId(id);
    if (tpl) {
      setBody(tpl.body);
      if (tpl.category !== nextCategory) setCategory(tpl.category as CommCategory);
    }
  }

  function pickCategory(next: CommCategory) {
    setCategory(next);
    setRestoreOf(undefined);
    const tpl = (meta?.templates ?? []).find((t) => t.category === next && t.enabled);
    if (tpl) {
      setTemplateId(tpl.id);
      setBody(tpl.body);
    } else {
      setTemplateId("");
    }
    setReview(false);
  }

  async function startRestore(id: string) {
    const res = await getCampaignFn({ data: { id } });
    const prev = parseCommExtras(res.campaign.extras_json);
    setFilter(parseAudienceFilter(res.campaign.filter_json));
    setExtras({ area: prev.area });
    pickCategory("service_restored");
    setRestoreOf(id);
    setPane("compose");
    setNote("Audience copied from the earlier outage campaign.");
  }

  async function openReport(id: string, page = 1, status = reportStatus) {
    setBusy(true);
    try {
      const res = await getCampaignFn({ data: { id, page, status: status || undefined } });
      setReport(res);
      setReportPage(page);
      setPane("report");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not load report");
    } finally {
      setBusy(false);
    }
  }

  async function send(forceDuplicate = confirmDuplicate) {
    if (!canSend || !body.trim() || !valid) return;
    if (large && !confirmLarge) return;
    setBusy(true);
    setNote(null);
    setDuplicateNote(null);
    try {
      const extrasToSend: CommExtras = {
        ...extras,
        maintenance_date: extras.maintenance_date ? prettyDate(extras.maintenance_date) : extras.maintenance_date,
        area: extras.area || filter.area,
      };
      const res = await sendCampaignFn({
        data: {
          category,
          name: name.trim() || campaignName(category, extrasToSend),
          body,
          template_id: templateId || undefined,
          filter,
          extras: extrasToSend,
          confirm_duplicate: forceDuplicate,
          restore_of: restoreOf,
          channel,
        },
      });
      if (res.duplicate) {
        setDuplicateNote(res.message);
        setConfirmDuplicate(false);
        setReview(true);
        return;
      }
      setReview(false);
      setConfirmDuplicate(false);
      setConfirmLarge(false);
      setRestoreOf(undefined);
      await loadHistory();
      await openReport(res.campaign.id);
      setNote(res.campaign.status === "sending" ? "Sending in batches…" : "Campaign sent.");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not send");
    } finally {
      setBusy(false);
    }
  }

  async function resend(id: string) {
    if (!canSend) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await resendFailedFn({ data: { id } });
      await loadHistory();
      await openReport(res.campaign.id);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not resend");
    } finally {
      setBusy(false);
    }
  }

  async function saveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!canTemplates) return;
    setBusy(true);
    setNote(null);
    try {
      await saveCommTemplateFn({
        data: {
          id: tplForm.id || undefined,
          category: tplForm.category,
          name: tplForm.name,
          body: tplForm.body,
        },
      });
      setTplForm({ id: "", category: tplForm.category, name: "", body: "" });
      await loadMeta();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Could not save template");
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="font-medium">Communications</h2>
        <p className="mt-2 text-sm text-muted">
          Viewing customers does not include permission to send bulk SMS. Ask an owner or customer-care admin to grant
          communications access.
        </p>
      </div>
    );
  }

  if (loadError) {
    return <p className="text-sm text-danger">{loadError}</p>;
  }

  if (!meta) {
    return <p className="text-sm text-muted">Loading communications…</p>;
  }

  const lastOutage = campaigns.find((c) => ["unplanned_outage", "planned_maintenance", "service_interruption"].includes(c.category));

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted">
          Choose what is happening, who is affected, then preview and send. Recipients are resolved on the server from
          live customer and service data.
        </p>
        <p className="mt-1 text-xs text-muted">
          SMS: <span className="font-medium text-fg">{meta.sender_id}</span>
          {meta.sandbox ? " · sandbox" : ` · ${meta.provider}`}
          {" · Email: "}
          <span className="font-medium text-fg">{meta.email_from}</span>
          {meta.email_sandbox ? " · sandbox" : ` · ${meta.email_provider}`}
          {" · "}
          <Link to="/app/settings" search={{ tab: "communications" }} className="text-accent hover:underline">
            Messaging settings
          </Link>
        </p>
      </div>

      <div role="tablist" aria-label="Communications" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {(
          [
            ["compose", "New message"],
            ["templates", "Message templates"],
            ["history", "Campaign history"],
            ["report", "Delivery reports"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pane === id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              pane === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => {
              setPane(id);
              setReview(false);
              if (id === "history") void loadHistory();
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {note ? <p className="text-sm text-accent">{note}</p> : null}

      {pane === "compose" ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-4">
            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium">Message type</h2>
              <ChoiceGroup
                name="message-type"
                label="Message type"
                value={category}
                sections={messageSections()}
                onChange={(id) => pickCategory(id as CommCategory)}
              />
              {lastOutage ? (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  <Button size="sm" variant="secondary" onClick={() => void startRestore(lastOutage.id)}>
                    Send restoration notice
                  </Button>
                  <p className="text-xs text-muted">
                    Quick action. Copies the audience and area from the last outage or maintenance campaign, then selects
                    Service Restored.
                  </p>
                </div>
              ) : null}
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium">Send as</h2>
              <ChoiceGroup
                name="send-as"
                label="Send as"
                value={channel}
                sections={[{ id: "channel", options: COMM_CHANNELS.map((item) => ({ id: item.id, label: item.label })) }]}
                onChange={(id) => {
                  setChannel(id as CommChannel);
                  setPreviewPage(1);
                }}
              />
              <p className="text-sm text-muted">
                {channel === "email"
                  ? "Customers without an email address are skipped. Each ISP uses its own from address."
                  : channel === "both"
                    ? "Send SMS and email to each customer who has that contact. Missing contacts are skipped for that channel only."
                    : "Customers without a valid mobile number are skipped."}
              </p>
            </section>

            <section className="space-y-4 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-medium">Who should receive this</h2>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFilter({});
                    setPreviewPage(1);
                  }}
                >
                  Clear filters
                </Button>
              </div>

              <div className="space-y-3">
                <h3 className="text-sm font-medium">Service</h3>
                <p className="text-xs text-muted">Choose any statuses or access types to include. Leave a group empty to include all.</p>
                <div>
                  <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">Service status</p>
                  <div className="flex flex-wrap gap-2">
                    {STATUSES.map((s) => (
                      <FilterChip
                        key={s.id}
                        tone={statusTone(s.id)}
                        on={Boolean(filter.statuses?.includes(s.id))}
                        onClick={() => {
                          setFilter((f) => ({ ...f, statuses: toggleFilterValue(f.statuses, s.id) }));
                          setPreviewPage(1);
                        }}
                      >
                        {s.label}
                      </FilterChip>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">Access type</p>
                  <div className="flex flex-wrap gap-2">
                    {ACCESS.map((s) => (
                      <FilterChip
                        key={s.id}
                        on={Boolean(filter.access?.includes(s.id))}
                        onClick={() => {
                          setFilter((f) => ({ ...f, access: toggleFilterValue(f.access, s.id) }));
                          setPreviewPage(1);
                        }}
                      >
                        {s.label}
                      </FilterChip>
                    ))}
                  </div>
                </div>
                <MoreFilters open={serviceMore} count={filter.package_ids?.length ?? 0} onToggle={() => setServiceMore((open) => !open)}>
                  {meta.packages.length ? (
                    <div>
                      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">Package</p>
                      <div className="flex flex-wrap gap-2">
                        {meta.packages.map((p) => (
                          <FilterChip
                            key={p.id}
                            on={Boolean(filter.package_ids?.includes(p.id))}
                            onClick={() => {
                              setFilter((f) => ({ ...f, package_ids: toggleFilterValue(f.package_ids, p.id) }));
                              setPreviewPage(1);
                            }}
                          >
                            {p.name}
                          </FilterChip>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No packages configured yet.</p>
                  )}
                </MoreFilters>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-medium">Customer</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Customer type">
                    <Select
                      value={filter.types?.[0] ?? ""}
                      onChange={(e) => {
                        setFilter((f) => ({ ...f, types: e.target.value ? [e.target.value] : undefined }));
                        setPreviewPage(1);
                      }}
                    >
                      <option value="">All types</option>
                      {(meta.types ?? []).map((t) => (
                        <option key={t.type} value={t.type}>
                          {t.type} ({t.n})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Area / location">
                    <Input
                      value={filter.area ?? ""}
                      onChange={(e) => {
                        setFilter((f) => ({ ...f, area: e.target.value }));
                        setPreviewPage(1);
                      }}
                      placeholder="Nanyuki"
                      list="comm-areas"
                    />
                  </Field>
                </div>
                {meta.areas.length ? (
                  <datalist id="comm-areas">
                    {meta.areas.map((a) => (
                      <option key={a.name} value={a.name}>
                        {a.name} ({a.n})
                      </option>
                    ))}
                  </datalist>
                ) : null}
                <MoreFilters open={customerMore} count={filter.tag_ids?.length ?? 0} onToggle={() => setCustomerMore((open) => !open)}>
                  {meta.tags.length ? (
                    <div>
                      <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">Tags</p>
                      <p className="mb-1.5 text-xs text-muted">A customer must have every selected tag.</p>
                      <div className="flex flex-wrap gap-2">
                        {meta.tags.map((t) => (
                          <FilterChip
                            key={t.id}
                            on={Boolean(filter.tag_ids?.includes(t.id))}
                            onClick={() => {
                              setFilter((f) => ({ ...f, tag_ids: toggleFilterValue(f.tag_ids, t.id) }));
                              setPreviewPage(1);
                            }}
                          >
                            {t.name}
                          </FilterChip>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted">No customer tags yet.</p>
                  )}
                </MoreFilters>
              </div>

              <div className="space-y-3 border-t border-border pt-4">
                <h3 className="text-sm font-medium">Customer activity</h3>
                <p className="text-xs text-muted">{ACTIVITY_HELP}</p>
                <div className="flex flex-wrap gap-2">
                  <FilterChip
                    on={Boolean(filter.overdue)}
                    onClick={() => {
                      setFilter((f) => ({ ...f, overdue: f.overdue ? undefined : true }));
                      setPreviewPage(1);
                    }}
                  >
                    Overdue balances
                  </FilterChip>
                  <FilterChip
                    on={filter.expiring_days === ACTIVITY_WINDOWS.expiringDays}
                    onClick={() => {
                      setFilter((f) => ({
                        ...f,
                        expiring_days: f.expiring_days === ACTIVITY_WINDOWS.expiringDays ? undefined : ACTIVITY_WINDOWS.expiringDays,
                      }));
                      setPreviewPage(1);
                    }}
                  >
                    Expiring in {ACTIVITY_WINDOWS.expiringDays} days
                  </FilterChip>
                  <FilterChip
                    on={filter.new_days === ACTIVITY_WINDOWS.newDays}
                    onClick={() => {
                      setFilter((f) => ({
                        ...f,
                        new_days: f.new_days === ACTIVITY_WINDOWS.newDays ? undefined : ACTIVITY_WINDOWS.newDays,
                      }));
                      setPreviewPage(1);
                    }}
                  >
                    New customers ({ACTIVITY_WINDOWS.newDays}d)
                  </FilterChip>
                  <FilterChip
                    on={filter.long_term_days === ACTIVITY_WINDOWS.longTermDays}
                    onClick={() => {
                      setFilter((f) => ({
                        ...f,
                        long_term_days:
                          f.long_term_days === ACTIVITY_WINDOWS.longTermDays ? undefined : ACTIVITY_WINDOWS.longTermDays,
                      }));
                      setPreviewPage(1);
                    }}
                  >
                    Long-term (1y+)
                  </FilterChip>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium">Message</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Template">
                  <Select
                    value={templateId}
                    onChange={(e) => applyTemplate(e.target.value)}
                    aria-label="Message template"
                  >
                    <option value="">Custom message</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Campaign name">
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={campaignName(category, extras)} />
                </Field>
              </div>
              {!templates.length ? <p className="text-sm text-muted">No message templates available for this type. Write a custom SMS or add a template.</p> : null}
              {(category === "planned_maintenance" || category === "unplanned_outage") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {category === "planned_maintenance" ? (
                    <>
                      <Field label="Maintenance date">
                        <DateYmdInput
                          value={extras.maintenance_date ?? ""}
                          onChange={(ymd) => setExtras((x) => ({ ...x, maintenance_date: ymd }))}
                          aria-label="Maintenance date"
                        />
                      </Field>
                      <Field label="Start time">
                        <Input type="time" value={extras.maintenance_start ?? ""} onChange={(e) => setExtras((x) => ({ ...x, maintenance_start: e.target.value }))} />
                      </Field>
                      <Field label="End time">
                        <Input type="time" value={extras.maintenance_end ?? ""} onChange={(e) => setExtras((x) => ({ ...x, maintenance_end: e.target.value }))} />
                      </Field>
                      <Field label="Expected duration">
                        <Input value={extras.expected_duration ?? ""} onChange={(e) => setExtras((x) => ({ ...x, expected_duration: e.target.value }))} placeholder="4 hours" />
                      </Field>
                    </>
                  ) : (
                    <Field label="Expected restoration">
                      <Input value={extras.expected_time ?? ""} onChange={(e) => setExtras((x) => ({ ...x, expected_time: e.target.value }))} placeholder="18:00" />
                    </Field>
                  )}
                  <Field label="Area affected">
                    <Input
                      value={extras.area ?? filter.area ?? ""}
                      onChange={(e) => {
                        setExtras((x) => ({ ...x, area: e.target.value }));
                        if (!filter.area) {
                          setFilter((f) => ({ ...f, area: e.target.value }));
                          setPreviewPage(1);
                        }
                      }}
                      placeholder="Nanyuki"
                    />
                  </Field>
                </div>
              )}
              <Field label={channel === "email" ? "Email body" : "Message body"}>
                <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={5} required />
              </Field>
              <div>
                <p className="mb-1.5 text-xs font-medium tracking-wide text-muted">Insert variable</p>
                <div className="flex flex-wrap gap-1">
                  {COMM_VARS.map((v) => (
                    <Button key={v.key} type="button" size="sm" variant="ghost" onClick={() => setBody((b) => insertCommVar(b, v.key))}>
                      {v.label}
                    </Button>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
            <section aria-busy={previewPending} className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <h2 className="font-medium">Audience</h2>
              <p className="text-sm font-medium">{summary}</p>
              {!preview ? (
                <p className="text-sm text-muted">Updating audience…</p>
              ) : total === 0 && !previewPending ? (
                <p className="text-sm text-muted">No customers match these filters.</p>
              ) : (
                <p className={cn("text-sm", previewPending && "opacity-60")}>
                  <span className="font-medium">{valid}</span>{" "}
                  {channel === "email" ? "with a valid email" : channel === "both" ? "with SMS or email" : "with a valid mobile"}
                  {skipped ? <span className="text-muted"> · {skipped} will be skipped</span> : null}
                  <span className="text-muted"> of {total} selected</span>
                </p>
              )}
              {previewPending && preview ? <p className="text-xs text-muted">Updating audience…</p> : null}
              {skipped ? (
                <Button type="button" size="sm" variant={showSkipped ? "default" : "secondary"} onClick={() => { setShowSkipped((v) => !v); setPreviewPage(1); }}>
                  {showSkipped ? "View recipients" : "Review skipped"}
                </Button>
              ) : (
                <p className="text-xs text-muted">View recipients below. Phone numbers without a valid mobile are listed as skipped — they are not sent silently.</p>
              )}
              <div className={cn("text-sm text-muted", previewPending && "opacity-60")}>
                {channel === "email" ? (
                  <div className="font-medium text-fg">{valid} email recipients</div>
                ) : (
                  <>
                    {segments.chars} characters · {parts} SMS {segments.encoding === "ucs2" ? "(unicode)" : "(GSM)"}
                    <div className="mt-1 font-medium text-fg">
                      {valid} recipients × {parts || 0} SMS = {estimated} SMS
                      {channel === "both" ? " · plus email where available" : ""}
                    </div>
                  </>
                )}
              </div>
              {!canSend ? <p className="text-sm text-warn">You can preview this audience but you cannot send bulk SMS.</p> : null}
              <Button
                type="button"
                disabled={!canSend || !body.trim() || !valid || busy || previewPending || !preview}
                onClick={() => {
                  setReview(true);
                  setDuplicateNote(null);
                }}
              >
                Review & send
              </Button>
            </section>

            <section className="space-y-2 rounded-xl border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-medium">{showSkipped ? "Skipped" : "Recipients"}</h2>
                {preview && preview.pool > (preview.pageSize ?? 20) ? (
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="ghost" disabled={previewPage <= 1 || previewPending} onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}>
                      Prev
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={previewPending || previewPage * (preview.pageSize ?? 20) >= preview.pool}
                      onClick={() => setPreviewPage((p) => p + 1)}
                    >
                      Next
                    </Button>
                  </div>
                ) : null}
              </div>
              {!preview || (previewPending && !preview.rows.length) ? (
                <p className="text-sm text-muted">Updating audience…</p>
              ) : !preview.rows.length ? (
                <p className="text-sm text-muted">No recipients to preview.</p>
              ) : (
                <ul className={cn("divide-y divide-border", previewPending && "opacity-60")}>
                  {preview.rows.map((r) => (
                    <li key={r.customer_id} className="py-2 text-sm">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">
                        {r.phone} · {r.package_name || r.service || "—"} · {r.status}
                        {r.location ? ` · ${r.location}` : ""}
                        {!r.phone_ok ? " · no valid mobile" : ""}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>

          {review ? (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4 lg:col-span-2">
              <h2 className="font-medium">Confirm send</h2>
              <p className="whitespace-pre-wrap rounded-md bg-elevated p-3 text-sm">{sample}</p>
              <p className={cn("text-sm", previewPending && "opacity-60")}>
                Audience: <span className="font-medium">{valid} customers</span>
                {skipped ? ` · ${skipped} skipped` : ""}
                {previewPending ? " · updating…" : ""}
              </p>
              <p className="text-sm text-muted">{summary}</p>
              <p className="text-sm">
                SMS: {estimated} · Sender: {meta.sender_id}
              </p>
              {duplicateNote ? (
                <label className="flex items-start gap-2 text-sm text-warn">
                  <input type="checkbox" className="mt-1 size-4" checked={confirmDuplicate} onChange={(e) => setConfirmDuplicate(e.target.checked)} />
                  {duplicateNote} Tick this box to send anyway.
                </label>
              ) : null}
              {large ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 size-4" checked={confirmLarge} onChange={(e) => setConfirmLarge(e.target.checked)} />
                  You are about to send this message to {valid} customers.
                </label>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy || previewPending || !preview || (large && !confirmLarge) || Boolean(duplicateNote && !confirmDuplicate)} onClick={() => void send(confirmDuplicate)}>
                  {busy ? "Sending…" : "Send message"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setReview(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {pane === "templates" ? (
        <div className="space-y-4">
          {canTemplates ? (
            <form onSubmit={saveTemplate} className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-2">
              <h2 className="font-medium md:col-span-2">{tplForm.id ? "Edit template" : "New template"}</h2>
              <Field label="Name">
                <Input required value={tplForm.name} onChange={(e) => setTplForm({ ...tplForm, name: e.target.value })} />
              </Field>
              <Field label="Category">
                <Select
                  value={tplForm.category}
                  onChange={(e) => setTplForm({ ...tplForm, category: e.target.value as CommCategory })}
                >
                  {COMM_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="md:col-span-2">
                <Field label="Body">
                  <Textarea required rows={4} value={tplForm.body} onChange={(e) => setTplForm({ ...tplForm, body: e.target.value })} />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button type="submit" disabled={busy}>
                  Save template
                </Button>
                {tplForm.id ? (
                  <Button type="button" variant="ghost" onClick={() => setTplForm({ id: "", category: "planned_maintenance", name: "", body: "" })}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          ) : (
            <p className="text-sm text-muted">You can use templates when composing. Editing them requires template permission.</p>
          )}
          {!meta.templates.length ? (
            <p className="text-sm text-muted">No message templates available.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {meta.templates.map((t) => (
                <li key={t.id} className="space-y-2 px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">{t.name}</div>
                      <div className="text-xs text-muted">{categoryLabel(t.category)}</div>
                    </div>
                    {canTemplates ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setTplForm({ id: t.id, category: t.category as CommCategory, name: t.name, body: t.body })}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            if (!canTemplates) return;
                            setBusy(true);
                            try {
                              await deleteCommTemplateFn({ data: { id: t.id } });
                              await loadMeta();
                            } catch (err) {
                              setNote(err instanceof Error ? err.message : "Could not delete");
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted">{t.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {pane === "history" ? (
        <div className="space-y-3">
          {!campaigns.length ? (
            <p className="text-sm text-muted">No campaigns have been sent yet.</p>
          ) : (
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
              {campaigns.map((c) => (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                  <div>
                    <div className="font-medium">{c.name || categoryLabel(c.category)}</div>
                    <div className="text-xs text-muted">
                      {categoryLabel(c.category)} · {formatWhen(c.created_at)} · {c.created_by_label || "staff"}
                      {c.restore_of ? " · restoration" : ""}
                    </div>
                    <div className="mt-1 text-sm">
                      {c.valid_count} recipients · {c.sms_count} SMS
                      {c.skipped_count ? ` · ${c.skipped_count} skipped` : ""} · Sent {c.sent_count} · Failed {c.failed_count}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={statusTone(c.status)}>{recipientStatusLabel(c.status)}</Badge>
                    <Button size="sm" variant="secondary" onClick={() => void openReport(c.id)}>
                      Report
                    </Button>
                    {c.failed_count > 0 && canSend ? (
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void resend(c.id)}>
                        Resend failed
                      </Button>
                    ) : null}
                    {["unplanned_outage", "planned_maintenance", "service_interruption"].includes(c.category) && canSend ? (
                      <Button size="sm" variant="ghost" onClick={() => void startRestore(c.id)}>
                        Restoration
                      </Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {pane === "report" ? (
        report ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{report.campaign.name || categoryLabel(report.campaign.category)}</h2>
                  <p className="text-sm text-muted">
                    {categoryLabel(report.campaign.category)} · {formatWhen(report.campaign.created_at)} · {report.campaign.created_by_label}
                    {report.campaign.sender_id ? ` · Sender ${report.campaign.sender_id}` : ""}
                  </p>
                </div>
                <Badge tone={statusTone(report.campaign.status)}>{recipientStatusLabel(report.campaign.status)}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap rounded-md bg-elevated p-3 text-sm">{report.campaign.body}</p>
              <p className="mt-3 text-sm">
                {report.campaign.valid_count} recipients · {report.campaign.sms_count} SMS · Sent {report.campaign.sent_count} · Failed{" "}
                {report.campaign.failed_count}
                {report.campaign.skipped_count ? ` · Skipped ${report.campaign.skipped_count}` : ""}
              </p>
              <p className="mt-1 text-xs text-muted">
                Sent means the provider accepted the message (or sandbox). Delivery receipts are not claimed here.
              </p>
              {report.campaign.status === "sending" ? (
                <p className="mt-2 text-sm text-accent">
                  Sending… {report.campaign.sent_count + report.campaign.failed_count} of {report.campaign.valid_count}
                </p>
              ) : null}
              {report.campaign.failed_count > 0 && canSend ? (
                <Button className="mt-3" size="sm" disabled={busy} onClick={() => void resend(report.campaign.id)}>
                  Resend failed
                </Button>
              ) : null}
            </div>
            <ChoiceGroup
              name="report-status"
              label="Delivery status"
              value={reportStatus}
              sections={[
                {
                  id: "status",
                  options: ["", "sent", "failed", "skipped", "queued"].map((id) => ({
                    id,
                    label: id ? recipientStatusLabel(id) : "All",
                  })),
                },
              ]}
              onChange={(id) => {
                setReportStatus(id);
                void openReport(report.campaign.id, 1, id);
              }}
            />
            {!report.recipients.rows.length ? (
              <p className="text-sm text-muted">No recipients in this view.</p>
            ) : (
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
                {report.recipients.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">
                        {r.phone} · {r.sms_parts} SMS
                        {r.detail ? ` · ${r.detail}` : ""}
                      </div>
                    </div>
                    <Badge tone={statusTone(r.status)}>{recipientStatusLabel(r.status)}</Badge>
                  </li>
                ))}
              </ul>
            )}
            {report.recipients.total > report.recipients.pageSize ? (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={reportPage <= 1}
                  onClick={() => void openReport(report.campaign.id, reportPage - 1)}
                >
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={reportPage * report.recipients.pageSize >= report.recipients.total}
                  onClick={() => void openReport(report.campaign.id, reportPage + 1)}
                >
                  Next
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted">Open a campaign from history to inspect its send report. Delivery is not marked as delivered unless the provider confirms it — this log shows sent, failed, pending, and skipped only.</p>
        )
      ) : null}
    </div>
  );
}

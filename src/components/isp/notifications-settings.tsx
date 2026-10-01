import { useEffect, useMemo, useRef, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input, Textarea } from "@/components/ui/input";
import { SaveButton, SettingsStatus, SettingsSubnav, type SettingsNote } from "@/components/isp/settings-ui";
import { NOTIFY_SAVE_FAIL, NOTIFY_SAVE_OK, safeSettingsError } from "@/lib/isp/settings-feedback";
import {
  eventLabel,
  NOTIFICATION_CATALOG,
  NOTIFY_PLACEHOLDERS,
  placeholderToken,
} from "@/lib/isp/notification-catalog";
import {
  listNotifications,
  runAutomatedBilling,
  updateNotificationTemplate,
  type NotificationLogRow,
  type NotificationTemplateRow,
} from "@/lib/isp/server";

type InnerTab = "log" | "templates" | "inbox";

export function NotificationsSettings() {
  const [logs, setLogs] = useState<NotificationLogRow[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateRow[]>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; subject: string; body: string; event_code: string; customer_name?: string | null }>>([]);
  const [tab, setTab] = useState<InnerTab>("log");
  const [cycle, setCycle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<NotificationTemplateRow | null>(null);
  const [templateBusy, setTemplateBusy] = useState(false);
  const [templateNote, setTemplateNote] = useState<SettingsNote>(null);
  const templateLock = useRef(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const grouped = useMemo(() => {
    const used = new Set<string>();
    const groups = NOTIFICATION_CATALOG.map((group) => ({
      category: group.category,
      templates: group.events.flatMap((event) => {
        const rows = templates.filter((t) => t.event_code === event.code);
        if (rows.length) used.add(event.code);
        return rows;
      }),
    })).filter((g) => g.templates.length);
    const leftover = templates.filter((t) => !used.has(t.event_code));
    if (leftover.length) groups.push({ category: "Other", templates: leftover });
    return groups;
  }, [templates]);

  function insertPlaceholder(key: string) {
    if (!edit) return;
    const token = placeholderToken(key);
    const el = bodyRef.current;
    if (!el) {
      setEdit({ ...edit, body: `${edit.body}${token}` });
      return;
    }
    const start = el.selectionStart ?? edit.body.length;
    const end = el.selectionEnd ?? start;
    const next = `${edit.body.slice(0, start)}${token}${edit.body.slice(end)}`;
    setEdit({ ...edit, body: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function load() {
    const res = await listNotifications();
    setLogs(res.logs);
    setTemplates(res.templates);
    setInbox(res.inbox);
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  async function runCycle() {
    setBusy(true);
    setCycle(null);
    try {
      const r = await runAutomatedBilling();
      setCycle(
        `Due ${r.due} · overdue ${r.overdue} · grace ${r.grace} · suspended ${r.suspended} · time ${r.time ?? 0} · bundle ${r.bundle ?? 0}`,
      );
      await load();
    } catch (e) {
      setCycle(e instanceof Error ? e.message : "Cycle failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">Notifications</h2>
          <p className="text-sm text-muted">
            Automated billing messages over SMS, WhatsApp, email, and in-app. Templates are per ISP. Delivery is
            logged and de-duplicated so retries never double-send.
          </p>
        </div>
        <Button onClick={() => void runCycle()} disabled={busy}>
          {busy ? "Running…" : "Run billing cycle"}
        </Button>
      </div>
      {cycle ? <p className="text-sm text-accent">{cycle}</p> : null}

      <SettingsSubnav
        label="Notifications"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "log", label: "Delivery log" },
          { id: "templates", label: "Templates" },
          { id: "inbox", label: "In-app inbox" },
        ]}
      />

      {tab === "log" ? (
        <ul className="space-y-3">
          {logs.length === 0 ? (
            <EmptyState title="No messages yet" description="Issue an invoice or run the billing cycle to see delivery here." />
          ) : null}
          {logs.map((n) => (
            <li key={n.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-medium">{n.subject}</div>
                  <div className="mt-1 text-xs text-muted">
                    {n.event_code} · {n.channel} · {n.customer_name ?? "tenant"} · {n.destination}
                  </div>
                </div>
                <Badge tone={statusTone(n.status)}>{n.status}</Badge>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      ) : tab === "templates" ? (
        <div className="space-y-6">
          <SettingsStatus note={templateNote} />
          <p className="text-xs text-subtle">
            Click a placeholder to insert it at the cursor. Dates render as the network date format (default dd/mm/yy).
            Paybill and support contact come from this network’s payment and company settings.
          </p>
          {grouped.map((group) => (
            <section key={group.category} className="space-y-3">
              <h3 className="text-sm font-medium">{group.category}</h3>
              {group.templates.map((t) => (
                <article key={t.id} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{eventLabel(t.event_code)}</div>
                      <div className="text-xs text-muted">
                        {t.event_code} · <span className="uppercase">{t.channel}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={t.enabled ? "ok" : "muted"}>{t.enabled ? "on" : "off"}</Badge>
                      <Button size="sm" variant="secondary" onClick={() => setEdit(t)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                  {edit?.id === t.id ? (
                    <form
                      className="mt-4 grid gap-3"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        if (templateLock.current) return;
                        templateLock.current = true;
                        setTemplateBusy(true);
                        setTemplateNote(null);
                        try {
                          await updateNotificationTemplate({
                            data: { id: t.id, subject: edit.subject, body: edit.body, enabled: edit.enabled },
                          });
                          setEdit(null);
                          await load();
                          setTemplateNote({ ok: true, text: NOTIFY_SAVE_OK });
                        } catch (err) {
                          setTemplateNote({ ok: false, text: safeSettingsError(err, NOTIFY_SAVE_FAIL) });
                        } finally {
                          templateLock.current = false;
                          setTemplateBusy(false);
                        }
                      }}
                    >
                      <div className="flex flex-wrap gap-1.5">
                        {NOTIFY_PLACEHOLDERS.map((p) => (
                          <button
                            key={p.key}
                            type="button"
                            className="h-8 rounded-full border border-border bg-bg px-2.5 text-xs text-muted hover:border-accent hover:text-fg"
                            onClick={() => insertPlaceholder(p.key)}
                          >
                            {`{{${p.key}}}`}
                          </button>
                        ))}
                      </div>
                      <Field label="Subject">
                        <Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
                      </Field>
                      <Field label="Body">
                        <Textarea
                          ref={bodyRef}
                          value={edit.body}
                          onChange={(e) => setEdit({ ...edit, body: e.target.value })}
                        />
                      </Field>
                      <label className="flex items-center gap-2 text-sm text-muted">
                        <input
                          type="checkbox"
                          checked={edit.enabled}
                          onChange={(e) => setEdit({ ...edit, enabled: e.target.checked })}
                        />
                        Enabled
                      </label>
                      <div className="flex gap-2">
                        <SaveButton busy={templateBusy} label="Save changes" />
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEdit(null)}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <p className="mt-2 text-sm text-muted">{t.body}</p>
                  )}
                </article>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <ul className="space-y-3">
          {inbox.length === 0 ? (
            <EmptyState title="No in-app messages yet" description="Messages sent to staff in this workspace will show up here." />
          ) : null}
          {inbox.map((n) => (
            <li key={n.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="font-medium">{n.subject}</div>
              <div className="mt-1 text-xs text-muted">{n.customer_name ?? "customer"} · {n.event_code}</div>
              <p className="mt-2 text-sm text-muted">{n.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

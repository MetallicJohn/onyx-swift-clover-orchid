import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import {
  listNotifications,
  runAutomatedBilling,
  updateNotificationTemplate,
  type NotificationLogRow,
  type NotificationTemplateRow,
} from "@/lib/isp/server";

export const Route = createFileRoute("/app/notifications")({ component: NotificationsPage });

function NotificationsPage() {
  const [logs, setLogs] = useState<NotificationLogRow[]>([]);
  const [templates, setTemplates] = useState<NotificationTemplateRow[]>([]);
  const [inbox, setInbox] = useState<Array<{ id: string; subject: string; body: string; event_code: string; customer_name?: string | null }>>([]);
  const [tab, setTab] = useState<"log" | "templates" | "inbox">("log");
  const [cycle, setCycle] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<NotificationTemplateRow | null>(null);

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
        `Due ${r.due} · overdue ${r.overdue} · grace ${r.grace} · suspended ${r.suspended} · notices ${r.notices}`,
      );
      await load();
    } catch (e) {
      setCycle(e instanceof Error ? e.message : "Cycle failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted">
            Automated billing messages over SMS, WhatsApp, email, and in-app. Templates are per tenant. Delivery is
            logged and de-duplicated so retries never double-send.
          </p>
        </div>
        <Button onClick={() => void runCycle()} disabled={busy}>
          {busy ? "Running…" : "Run billing cycle"}
        </Button>
      </div>
      {cycle ? <p className="text-sm text-accent">{cycle}</p> : null}

      <div className="flex gap-2">
        <Button size="sm" variant={tab === "log" ? "default" : "secondary"} onClick={() => setTab("log")}>
          Delivery log
        </Button>
        <Button size="sm" variant={tab === "templates" ? "default" : "secondary"} onClick={() => setTab("templates")}>
          Templates
        </Button>
        <Button size="sm" variant={tab === "inbox" ? "default" : "secondary"} onClick={() => setTab("inbox")}>
          In-app inbox
        </Button>
      </div>

      {tab === "log" ? (
        <ul className="space-y-3">
          {logs.length === 0 ? <p className="text-sm text-muted">No messages yet. Issue an invoice or run the cycle.</p> : null}
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
        <div className="space-y-3">
          <p className="text-xs text-subtle">
            Variables: {"{customer_name}"} {"{invoice_number}"} {"{amount}"} {"{due_date}"} {"{service_name}"}{" "}
            {"{payment_reference}"} {"{isp_name}"}
          </p>
          {templates.map((t) => (
            <article key={t.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{t.event_code}</div>
                  <div className="text-xs text-muted uppercase">{t.channel}</div>
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
                    await updateNotificationTemplate({
                      data: { id: t.id, subject: edit.subject, body: edit.body, enabled: edit.enabled },
                    });
                    setEdit(null);
                    await load();
                  }}
                >
                  <Field label="Subject">
                    <Input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
                  </Field>
                  <Field label="Body">
                    <Textarea value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
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
                    <Button type="submit" size="sm">
                      Save
                    </Button>
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
        </div>
      ) : (
        <ul className="space-y-3">
          {inbox.length === 0 ? <p className="text-sm text-muted">No in-app messages yet.</p> : null}
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

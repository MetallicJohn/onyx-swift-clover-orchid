import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { EmptyState, ErrorBanner, PortalCard } from "@/components/isp/portal-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { PORTAL_TICKET_CATEGORIES } from "@/lib/isp/customer-portal-dto";
import { formatDateTime } from "@/lib/isp/display";
import { portalOpenTicket, portalReplyTicket } from "@/lib/isp/server-portal";
import { usePortal } from "../portal";

export const Route = createFileRoute("/portal/tickets")({ component: PortalTickets });

function PortalTickets() {
  const { home, token, refresh } = usePortal();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("internet_down");
  const [message, setMessage] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Support tickets</h1>
        <p className="mt-1 text-sm text-muted">Open a ticket and follow replies from this network. Internal staff notes are not shown.</p>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <PortalCard title="New ticket">
        <form
          className="grid gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await portalOpenTicket({
                data: { token, title, category, message, service_id: serviceId || undefined },
              });
              setTitle("");
              setMessage("");
              await refresh();
            } catch (ex) {
              setError(ex instanceof Error ? ex.message : "Could not open ticket");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>
              {PORTAL_TICKET_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          {home.services.length ? (
            <Field label="Affected service (optional)">
              <Select value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                <option value="">Not sure</option>
                {home.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} · {s.reference}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          <Field label="Subject">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="Short summary" />
          </Field>
          <Field label="Message">
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} required placeholder="What is happening?" />
          </Field>
          <Button type="submit" disabled={busy}>
            Send ticket
          </Button>
        </form>
      </PortalCard>

      {!home.tickets.length ? (
        <EmptyState title="No tickets yet" body="When you raise a ticket, you can track it here." />
      ) : (
        <ul className="space-y-3">
          {home.tickets.map((t) => (
            <li key={t.id}>
              <PortalCard>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{t.title}</p>
                    <p className="text-xs text-muted">
                      {t.category_label} · {formatDateTime(t.created_at)}
                    </p>
                  </div>
                  <Badge tone={statusTone(t.status)}>{t.status_label}</Badge>
                </div>
                <ul className="mt-3 space-y-2 text-sm">
                  {t.comments.map((c) => (
                    <li key={c.id} className="rounded-md bg-elevated/60 px-3 py-2">
                      <p className="text-[11px] font-medium text-muted uppercase">{c.author === "you" ? "You" : "Support"}</p>
                      <p className="mt-0.5">{c.body}</p>
                    </li>
                  ))}
                </ul>
                {t.status !== "closed" && t.status !== "resolved" ? (
                  <form
                    className="mt-3 grid gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const body = (reply[t.id] || "").trim();
                      if (!body) return;
                      try {
                        await portalReplyTicket({ data: { token, ticket_id: t.id, message: body } });
                        setReply((m) => ({ ...m, [t.id]: "" }));
                        await refresh();
                      } catch (ex) {
                        setError(ex instanceof Error ? ex.message : "Could not reply");
                      }
                    }}
                  >
                    <Input
                      value={reply[t.id] || ""}
                      onChange={(e) => setReply((m) => ({ ...m, [t.id]: e.target.value }))}
                      placeholder="Reply"
                    />
                    <Button type="submit" size="sm" variant="secondary">
                      Reply
                    </Button>
                  </form>
                ) : null}
              </PortalCard>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

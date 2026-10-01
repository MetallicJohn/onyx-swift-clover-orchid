import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TicketLive } from "@/components/isp/ticket-live";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { commentOpenTicket } from "@/lib/isp/server-more";
import { listField } from "@/lib/isp/server-ops";
import { setTicketStatus } from "@/lib/isp/server";
import { technicianMoves } from "@/lib/isp/ticket-workflow";

export const Route = createFileRoute("/app/field")({ component: FieldPage });

function dueLabel(due: string | null) {
  if (!due) return "";
  const ms = Date.parse(due) - Date.now();
  if (!Number.isFinite(ms)) return "";
  const mins = Math.round(ms / 60_000);
  if (mins < 0) return "overdue";
  if (mins < 60) return `due in ${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `due in ${hours}h` : `due ${due.slice(0, 10)}`;
}

function FieldPage() {
  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof listField>>["tickets"]>([]);
  const [note, setNote] = useState("");

  async function load() {
    setTickets((await listField()).tickets);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <TicketLive
        onEvent={(summary) => {
          setNote(summary);
          load().catch(console.error);
        }}
      />
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Field</h1>
        <p className="text-sm text-muted">Your queue, soonest deadline first. Only the next allowed steps are shown.</p>
      </div>
      {note ? <p className="rounded-md border border-border bg-surface px-3 py-2 text-sm">{note}</p> : null}
      {tickets.length === 0 ? (
        <EmptyState title="No open jobs" description="Tickets assigned to you show up here, soonest deadline first." />
      ) : null}
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface">
        {tickets.map((t) => (
          <li key={t.id} className="grid gap-3 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{t.title}</span>
                <Badge tone={statusTone(t.priority)}>{t.priority}</Badge>
                <Badge tone={statusTone(t.status)}>{t.status.replaceAll("_", " ")}</Badge>
                {dueLabel(t.due_at) ? <span className="text-xs text-muted">{dueLabel(t.due_at)}</span> : null}
              </div>
              <div className="mt-1 text-sm text-muted">
                {t.customer_name ?? "Network"} · {t.phone ?? "—"}
              </div>
              {t.address ? <div className="text-xs text-subtle">{t.address}</div> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {technicianMoves(t.status).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await setTicketStatus({ data: { id: t.id, status: s } });
                    await load();
                  }}
                >
                  {s.replaceAll("_", " ")}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await commentOpenTicket({ data: { id: t.id, body: "On site check-in" } });
                }}
              >
                Check-in note
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

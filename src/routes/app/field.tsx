import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { commentOpenTicket } from "@/lib/isp/server-more";
import { listField } from "@/lib/isp/server-ops";
import { setTicketStatus } from "@/lib/isp/server";

export const Route = createFileRoute("/app/field")({ component: FieldPage });

function FieldPage() {
  const [tickets, setTickets] = useState<Awaited<ReturnType<typeof listField>>["tickets"]>([]);

  async function load() {
    setTickets((await listField()).tickets);
  }
  useEffect(() => {
    load().catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Field</h1>
        <p className="text-sm text-muted">Technician jobs assigned to you. Accept, travel, arrive, close.</p>
      </div>
      <div className="grid gap-3">
        {tickets.map((t) => (
          <article key={t.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium">{t.title}</div>
                <div className="mt-1 text-sm text-muted">
                  {t.customer_name ?? "Network"} · {t.phone ?? "—"}
                </div>
                <div className="text-xs text-subtle">{t.address}</div>
              </div>
              <div className="flex gap-2">
                <Badge tone={statusTone(t.priority)}>{t.priority}</Badge>
                <Badge tone={statusTone(t.status)}>{t.status}</Badge>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["accepted", "travelling", "on_site", "resolved"] as const).map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant="secondary"
                  onClick={async () => {
                    await setTicketStatus({ data: { id: t.id, status: s } });
                    await load();
                  }}
                >
                  {s.replace("_", " ")}
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
          </article>
        ))}
        {tickets.length === 0 ? <p className="text-sm text-muted">No open jobs.</p> : null}
      </div>
    </div>
  );
}

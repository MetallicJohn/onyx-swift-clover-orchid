import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getAuditLog, getReports } from "@/lib/isp/server-more";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/reports")({ component: ReportsPage });

function ReportsPage() {
  const [tab, setTab] = useState<"ops" | "audit">("ops");
  const [data, setData] = useState<Awaited<ReturnType<typeof getReports>> | null>(null);
  const [audit, setAudit] = useState<Awaited<ReturnType<typeof getAuditLog>>["rows"]>([]);

  useEffect(() => {
    getReports().then(setData).catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted">Collections, invoice aging, services, and the audit trail.</p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant={tab === "ops" ? "default" : "secondary"} onClick={() => setTab("ops")}>
          Operations
        </Button>
        <Button
          size="sm"
          variant={tab === "audit" ? "default" : "secondary"}
          onClick={async () => {
            setTab("audit");
            try {
              setAudit((await getAuditLog()).rows);
            } catch {
              setAudit([]);
            }
          }}
        >
          Audit
        </Button>
      </div>

      {tab === "ops" && data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Invoice aging</h2>
            <ul className="text-sm">
              {Object.entries(data.aging).map(([k, v]) => (
                <li key={k} className="flex justify-between py-1">
                  <span className="text-muted">{k}</span>
                  <span className="font-mono">
                    {v.count} · {kes(v.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Confirmed collections</h2>
            <ul className="text-sm">
              {data.daily.length === 0 ? <li className="text-muted">No payments yet.</li> : null}
              {data.daily.map((d) => (
                <li key={d.day} className="flex justify-between py-1">
                  <span className="text-muted">{d.day}</span>
                  <span className="font-mono">
                    {d.n} · {kes(d.amount)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Services</h2>
            <ul className="text-sm">
              {data.methods.map((m) => (
                <li key={m.access_method} className="flex justify-between py-1">
                  <span className="text-muted">{m.access_method}</span>
                  <span className="font-mono">
                    {m.active} active / {m.n}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border border-border bg-surface p-4">
            <h2 className="mb-3 font-medium">Tickets & routers</h2>
            <ul className="text-sm">
              {data.tickets.map((t) => (
                <li key={t.status} className="flex justify-between py-1">
                  <span className="text-muted">ticket {t.status}</span>
                  <span className="font-mono">{t.n}</span>
                </li>
              ))}
              {data.routers.map((r) => (
                <li key={r.wg_status} className="flex justify-between py-1">
                  <span className="text-muted">router {r.wg_status}</span>
                  <span className="font-mono">{r.n}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}

      {tab === "audit" ? (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border">
          {audit.length === 0 ? <li className="px-4 py-6 text-sm text-muted">No audit rows, or you cannot read audit.</li> : null}
          {audit.map((a) => (
            <li key={a.id} className="bg-surface px-4 py-3 text-sm">
              <div className="font-medium">{a.action}</div>
              <div className="text-xs text-muted">
                {a.entity_type} {a.entity_id} · {a.user_id.slice(-8)} · {a.created_at.slice(0, 19).replace("T", " ")}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { Kpi, PageHead, Panel, Spark } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { exportSaasReportsCsv, getSaasReports } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/reports")({ component: ReportsPage });

function today() {
  return new Date().toISOString().slice(0, 10);
}
function monthAgo() {
  return new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
}

function ReportsPage() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [data, setData] = useState<Awaited<ReturnType<typeof getSaasReports>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setBusy(true);
    setError(null);
    try {
      setData(await getSaasReports({ data: { from, to } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load report");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function download() {
    const file = await exportSaasReportsCsv({ data: { from, to } });
    const blob = new Blob([file.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHead
        eyebrow="Analytics"
        title="Platform reports"
        hint="Aggregated on the server. Export CSV or print this page."
        actions={
          <>
            <Button type="button" variant="secondary" onClick={() => void download()} disabled={!data}>
              Export CSV
            </Button>
            <Button type="button" variant="ghost" onClick={() => window.print()}>
              Print
            </Button>
          </>
        }
      />
      <form
        className="mb-6 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <Field label="From">
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To">
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button type="submit" disabled={busy}>
          {busy ? "Loading…" : "Apply"}
        </Button>
      </form>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data ? <div className="h-40 animate-pulse rounded-xl bg-surface" /> : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="New ISPs" value={data.tenants.new.length} />
            <Kpi label="SaaS collected" value={kes(data.financial.paid_kes)} />
            <Kpi label="New users" value={data.new_users} />
            <Kpi label="MRR (current)" value={kes(data.subscriptions.by_plan.reduce((s, p) => s + p.mrr, 0))} />
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <Panel>
              <h2 className="mb-3 text-base font-medium">Revenue by day</h2>
              <Spark points={data.financial.daily.map((d) => ({ x: d.day, y: d.amount }))} />
            </Panel>
            <Panel>
              <h2 className="mb-3 text-base font-medium">Subscribers by plan</h2>
              <ul className="space-y-2 text-sm">
                {data.subscriptions.by_plan.map((p) => (
                  <li key={p.plan} className="flex justify-between">
                    <span className="capitalize">{p.plan}</span>
                    <span className="font-mono">
                      {p.n} · {kes(p.mrr)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <h2 className="mb-3 text-base font-medium">Tenant status</h2>
              <ul className="space-y-2 text-sm">
                {data.tenants.by_status.map((s) => (
                  <li key={s.status} className="flex justify-between capitalize">
                    <span>{s.status}</span>
                    <span className="font-mono">{s.n}</span>
                  </li>
                ))}
              </ul>
            </Panel>
            <Panel>
              <h2 className="mb-3 text-base font-medium">Administrative actions</h2>
              <ul className="space-y-2 text-sm">
                {data.activity.map((a) => (
                  <li key={a.action} className="flex justify-between">
                    <span>{a.action}</span>
                    <span className="font-mono">{a.n}</span>
                  </li>
                ))}
                {data.activity.length === 0 ? <p className="text-muted">No events in range.</p> : null}
              </ul>
            </Panel>
          </div>
          <Panel className="mt-4">
            <h2 className="mb-3 text-base font-medium">New tenants</h2>
            <ul className="space-y-2 text-sm">
              {data.tenants.new.map((t) => (
                <li key={t.id} className="flex justify-between gap-3">
                  <span>
                    {t.name} · {t.plan}
                  </span>
                  <span className="text-muted">{nairobiTime(t.created_at)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}

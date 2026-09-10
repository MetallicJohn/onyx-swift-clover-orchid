import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HealthDot, Kpi, PageHead, Panel, Spark } from "@/components/platform/ui";
import { getPlatformOverview } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/")({ component: PlatformHome });

function PlatformHome() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getPlatformOverview>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlatformOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load dashboard"));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  const infraHint =
    data.infrastructure.health === "unknown"
      ? "No agent telemetry yet"
      : `${data.infrastructure.online} online · ${data.infrastructure.offline} offline`;

  return (
    <div>
      <PageHead
        eyebrow="SaaS Management"
        title="Platform overview"
        hint="Tenants, subscription revenue, and infrastructure health across every ISP on this instance."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Total ISPs" value={data.tenants.total} hint={`${data.tenants.new_month} new this month`} />
        <Kpi label="Active" value={data.tenants.active} tone="ok" />
        <Kpi label="Trial" value={data.tenants.trial} tone="warn" />
        <Kpi label="Suspended" value={data.tenants.suspended} tone={data.tenants.suspended ? "danger" : "muted"} />
        <Kpi label="Expiring trials" value={data.subscriptions.expiring_trials} hint="Next 7 days" />
      </div>

      <h2 className="mb-3 mt-8 text-sm font-medium tracking-tight">SaaS revenue</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Today" value={kes(data.revenue.today)} />
        <Kpi label="This month" value={kes(data.revenue.month)} />
        <Kpi label="MRR" value={kes(data.revenue.mrr)} />
        <Kpi label="ARR" value={kes(data.revenue.arr)} />
        <Kpi label="Outstanding invoices" value={kes(data.revenue.outstanding)} tone={data.revenue.outstanding ? "warn" : "ok"} />
        <Kpi label="Failed / overdue" value={data.revenue.failed} tone={data.revenue.failed ? "danger" : "muted"} />
        <Kpi label="Upcoming renewals" value={data.revenue.upcoming_renewals} hint="Next 14 days" />
        <Kpi label="Churn (month)" value={data.subscriptions.churn} />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium">Tenant growth</h2>
            <Link to="/platform/tenants" className="text-sm text-accent hover:underline">
              All ISPs
            </Link>
          </div>
          <Spark points={data.series.growth.map((d) => ({ x: d.day, y: d.n }))} />
        </Panel>
        <Panel>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-base font-medium">SaaS collections</h2>
            <Link to="/platform/revenue" className="text-sm text-accent hover:underline">
              Revenue
            </Link>
          </div>
          <Spark points={data.series.revenue.map((d) => ({ x: d.day, y: d.amount }))} />
        </Panel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-base font-medium">Infrastructure</h2>
          <div className="mb-4 flex items-center gap-2">
            <HealthDot health={data.infrastructure.health} />
            <span className="text-sm text-muted">{infraHint}</span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">Nodes</dt>
              <dd className="font-mono">{data.infrastructure.total}</dd>
            </div>
            <div>
              <dt className="text-muted">Online</dt>
              <dd className="font-mono">{data.infrastructure.online}</dd>
            </div>
            <div>
              <dt className="text-muted">CPU</dt>
              <dd>{data.infrastructure.cpu == null ? "Telemetry unavailable" : `${data.infrastructure.cpu}%`}</dd>
            </div>
            <div>
              <dt className="text-muted">RAM</dt>
              <dd>{data.infrastructure.ram == null ? "Telemetry unavailable" : `${data.infrastructure.ram}%`}</dd>
            </div>
            <div>
              <dt className="text-muted">Disk</dt>
              <dd>{data.infrastructure.disk == null ? "Telemetry unavailable" : `${data.infrastructure.disk}%`}</dd>
            </div>
            <div>
              <dt className="text-muted">Bandwidth</dt>
              <dd>Telemetry unavailable</dd>
            </div>
          </dl>
        </Panel>
        <Panel>
          <h2 className="mb-4 text-base font-medium">Tenants by plan</h2>
          <ul className="space-y-3">
            {data.subscriptions.by_plan.map((p) => {
              const max = Math.max(...data.subscriptions.by_plan.map((x) => x.n), 1);
              return (
                <li key={p.plan}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize">{p.plan}</span>
                    <span className="font-mono text-muted">{p.n}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(p.n / max) * 100}%` }} />
                  </div>
                </li>
              );
            })}
            {data.subscriptions.by_plan.length === 0 ? <p className="text-sm text-muted">No subscriptions yet.</p> : null}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { HealthDot, Kpi, PageHead, Panel, PctBar, Spark } from "@/components/platform/ui";
import { formatRelativeTime } from "@/lib/isp/display";
import { getPlatformOverview } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/")({ component: PlatformHome });

type Overview = Awaited<ReturnType<typeof getPlatformOverview>>;
type Infra = Overview["infrastructure"];

function serviceLine(services: Infra["services"]) {
  if (!services) return "Not available";
  const parts: string[] = [];
  if (services.healthy) parts.push(`${services.healthy} healthy`);
  if (services.warning) parts.push(`${services.warning} warning`);
  if (services.failed) parts.push(`${services.failed} failed`);
  return parts.length ? parts.join(" · ") : "Not available";
}

function vpsLine(infra: Infra) {
  if (infra.vps_count > 1) {
    const bits = [`${infra.online} online`];
    if (infra.warning) bits.push(`${infra.warning} warning`);
    if (infra.critical) bits.push(`${infra.critical} critical`);
    if (infra.offline) bits.push(`${infra.offline} offline`);
    return `${infra.vps_count} VPS monitored · ${bits.join(" · ")}`;
  }
  if (infra.vps_name) return infra.vps_name;
  return "Not available";
}

function InfrastructureCard({ infra }: { infra: Infra }) {
  const updated = formatRelativeTime(infra.last_checked_at) || "Not available";
  const heartbeat = infra.last_seen ? formatRelativeTime(infra.last_seen) : "";
  const missing = !infra.available && !infra.error;
  const failed = infra.error;

  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-base font-medium">Infrastructure</h2>
        <HealthDot health={failed || missing ? "unknown" : infra.health} />
      </div>
      {failed ? (
        <p className="text-sm text-muted">Infrastructure data unavailable</p>
      ) : missing ? (
        <p className="text-sm text-muted">Infrastructure data unavailable</p>
      ) : null}
      <dl className="grid gap-3 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted">VPS</dt>
          <dd className="text-right">{vpsLine(infra)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Last heartbeat</dt>
          <dd className="text-right font-mono text-xs">
            {heartbeat ? (
              <>
                {heartbeat}
                {infra.stale ? <span className="ml-2 text-warn">Stale</span> : null}
              </>
            ) : (
              "Not available"
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Last updated</dt>
          <dd className="text-right font-mono text-xs">{updated}</dd>
        </div>
      </dl>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <PctBar
          label="CPU"
          pct={infra.cpu}
          hint={
            infra.cpu_cores != null
              ? `${infra.cpu_cores} vCPU`
              : infra.cpu != null
                ? "vCPU count  Not available"
                : undefined
          }
        />
        <PctBar
          label="RAM"
          pct={infra.ram}
          hint={
            infra.ram_used != null && infra.ram_total != null
              ? undefined
              : infra.ram != null
                ? "Used / total  Not available"
                : undefined
          }
        />
        <PctBar
          label="Disk"
          pct={infra.disk}
          hint={
            infra.disk_used != null && infra.disk_total != null
              ? undefined
              : infra.disk != null
                ? "Used / total  Not available"
                : undefined
          }
        />
        <div>
          <div className="mb-1.5 text-xs text-muted">Services</div>
          <div className="text-sm">{serviceLine(infra.services)}</div>
        </div>
      </div>
    </Panel>
  );
}

function PlatformHome() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getPlatformOverview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load dashboard"));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

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
        <InfrastructureCard infra={data.infrastructure} />
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
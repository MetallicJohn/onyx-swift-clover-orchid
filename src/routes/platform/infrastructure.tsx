import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { HealthDot, PageHead, Panel, Telemetry } from "@/components/platform/ui";
import { getSaasInfrastructure } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/infrastructure")({ component: InfraPage });

function InfraPage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getSaasInfrastructure>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSaasInfrastructure()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  const rows = [
    ...data.nodes.map((n) => ({
      id: n.id,
      tenant_id: n.tenant_id,
      tenant_name: n.tenant_name,
      name: n.name,
      kind: "VPS / agent",
      health: n.health,
      cpu: n.cpu_pct,
      ram: n.ram_pct,
      disk: n.disk_pct,
      last_seen: n.last_seen,
      extra: n.postgres_ok == null ? "Telemetry unavailable" : `pg ${n.postgres_ok ? "ok" : "down"}`,
    })),
    ...data.routers.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      tenant_name: r.tenant_name,
      name: r.name,
      kind: "MikroTik agent",
      health: r.health,
      cpu: r.cpu_pct,
      ram: null as number | null,
      disk: null as number | null,
      last_seen: r.last_seen,
      extra: r.wg_status,
    })),
  ];

  return (
    <div>
      <PageHead
        eyebrow="Fleet"
        title="Infrastructure"
        hint="Metrics come from authenticated agent heartbeats. Missing RAM, disk, or bandwidth is shown as telemetry unavailable — never guessed."
      />
      <Panel className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-subtle">
            <tr className="border-b border-border">
              <th className="px-5 py-3 font-medium">Node</th>
              <th className="px-3 py-3 font-medium">ISP</th>
              <th className="px-3 py-3 font-medium">Health</th>
              <th className="px-3 py-3 font-medium">CPU</th>
              <th className="px-3 py-3 font-medium">RAM</th>
              <th className="px-3 py-3 font-medium">Disk</th>
              <th className="px-3 py-3 font-medium">Last heartbeat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted">{r.kind}</div>
                </td>
                <td className="px-3 py-3">
                  <Link to="/platform/tenants/$tenantId" params={{ tenantId: r.tenant_id }} className="hover:text-accent">
                    {r.tenant_name}
                  </Link>
                </td>
                <td className="px-3 py-3">
                  <HealthDot health={r.health} />
                </td>
                <td className="px-3 py-3">
                  <Telemetry value={r.cpu} unit="%" />
                </td>
                <td className="px-3 py-3">
                  <Telemetry value={r.ram} unit="%" />
                </td>
                <td className="px-3 py-3">
                  <Telemetry value={r.disk} unit="%" />
                </td>
                <td className="px-3 py-3 text-muted">{nairobiTime(r.last_seen)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-muted">
                  No routers or telemetry nodes yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

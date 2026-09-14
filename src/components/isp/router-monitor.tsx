import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { formatBytes, formatDateTime } from "@/lib/isp/display";
import { routerTelemetryFn } from "@/lib/isp/server-routers";
import { formatBps, formatDuration, TRAFFIC_FRESHNESS_LABEL, TRAFFIC_SOURCE_LABEL } from "@/lib/isp/traffic-format";

type Telemetry = Awaited<ReturnType<typeof routerTelemetryFn>>;

export function RouterMonitor({ routerId }: { routerId: string }) {
  const [data, setData] = useState<Telemetry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!routerId) {
      setData(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    async function tick() {
      try {
        const next = await routerTelemetryFn({ data: { router_id: routerId } });
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load router telemetry");
      }
      if (!cancelled) timer = window.setTimeout(tick, 15_000);
    }
    void tick();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [routerId]);

  if (!routerId) return null;

  return (
    <section className="grid gap-3 rounded-xl border border-border bg-surface p-4">
      <div>
        <h2 className="font-medium">Router monitoring</h2>
        <p className="text-sm text-muted">
          CPU, memory, and interface counters from stored collector samples. Missing values stay blank — they are never
          invented.
        </p>
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-muted">Reading stored metrics…</p> : null}
      {data ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={statusTone(data.freshness === "live" ? "online" : data.freshness === "stale" ? "grace" : "offline")}>
              {TRAFFIC_FRESHNESS_LABEL[data.freshness] || data.freshness}
            </Badge>
            <span className="text-xs text-subtle">
              {data.source ? TRAFFIC_SOURCE_LABEL[data.source] || data.source : "no collector sample"}
              {data.collected_at ? ` · ${formatDateTime(data.collected_at)}` : ""}
            </span>
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="CPU" value={data.cpu_pct == null ? "—" : `${data.cpu_pct}%`} />
            <Metric label="Memory" value={data.ram_pct == null ? "—" : `${data.ram_pct}%`} />
            <Metric label="Uptime" value={formatDuration(data.uptime_seconds)} />
            <Metric label="PPPoE sessions" value={data.ppp_active == null ? "—" : String(data.ppp_active)} />
          </dl>
          {data.last_error ? <p className="text-xs text-danger">Last collector error: {data.last_error}</p> : null}
          {data.snmp.status === "not_configured" && data.netflow.status === "not_configured" ? (
            <p className="text-xs text-subtle">SNMP and NetFlow are not configured. No placeholder values are shown.</p>
          ) : null}

          {data.interfaces.length ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="bg-elevated text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Interface</th>
                    <th className="px-3 py-2 font-medium">RX</th>
                    <th className="px-3 py-2 font-medium">TX</th>
                    <th className="px-3 py-2 font-medium">RX rate</th>
                    <th className="px-3 py-2 font-medium">TX rate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.interfaces.map((iface) => (
                    <tr key={iface.name}>
                      <td className="px-3 py-2">
                        <div>{iface.name}</div>
                        <div className="text-xs text-muted">
                          {iface.type || "—"}
                          {iface.running ? "" : " · down"}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{formatBytes(iface.rx_bytes)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatBytes(iface.tx_bytes)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatBps(iface.rx_bps)}</td>
                      <td className="px-3 py-2 font-mono text-xs">{formatBps(iface.tx_bps)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted">No interface samples stored for this router yet.</p>
          )}

          {data.customers.length ? (
            <div>
              <h3 className="mb-2 text-sm font-medium">Mapped sessions</h3>
              <ul className="grid gap-1 text-sm">
                {data.customers.slice(0, 40).map((c) => (
                  <li key={`${c.service_id}-${c.username}`} className="text-muted">
                    <span className="text-fg">{c.customer_name}</span>
                    {c.username ? ` · ${c.username}` : ""}
                    {c.framed_ip ? ` · ${c.framed_ip}` : ""}
                    {c.package_name ? ` · ${c.package_name}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-elevated px-3 py-2">
      <dt className="text-xs text-subtle">{label}</dt>
      <dd className="font-mono">{value}</dd>
    </div>
  );
}

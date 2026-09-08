import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { getDashboard } from "@/lib/isp/server";
import type { DashboardData } from "@/lib/isp/types";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/app/")({ component: Overview });

function Overview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) return <p className="text-danger">{error}</p>;
  if (!data) return <Skeleton />;

  const t = data.totals;
  const cards = [
    { label: "Customers", value: String(t.customers), sub: `${t.active} active` },
    { label: "Online services", value: String(t.online), sub: `${t.suspended} suspended` },
    { label: "Collected", value: kes(t.revenueMonth), sub: `${kes(t.paymentsToday)} today` },
    { label: "Outstanding", value: kes(t.outstanding), sub: `${t.openTickets} open tickets` },
    { label: "Routers", value: `${t.routersOnline}/${t.routersTotal}`, sub: `${t.noticesToday} notices today` },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{data.workspace.tenantName}</h1>
        <p className="mt-1 text-sm text-muted">
          Trial workspace · {data.workspace.currency} · East Africa/Nairobi
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-border bg-surface p-4">
            <div className="text-xs tracking-wide text-muted uppercase">{c.label}</div>
            <div className="mt-2 font-mono text-2xl tabular-nums">{c.value}</div>
            <div className="mt-1 text-xs text-subtle">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Recent payments</h2>
            <Link to="/app/billing" className="text-sm text-accent hover:underline">
              Billing
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {data.recentPayments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3">
                <div>
                  <div className="text-sm">{p.customer_name}</div>
                  <div className="font-mono text-xs text-muted">{p.reference}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm tabular-nums">{kes(p.amount_kes)}</div>
                  <Badge tone="ok">{p.provider}</Badge>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-surface p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-medium">Tickets</h2>
            <Link to="/app/tickets" className="text-sm text-accent hover:underline">
              All tickets
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {data.recentTickets.map((tk) => (
              <li key={tk.id} className="py-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="text-sm">{tk.title}</div>
                  <Badge tone={statusTone(tk.status)}>{tk.status.replace("_", " ")}</Badge>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {tk.customer_name ?? "Network"} · {tk.priority}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-xl border border-border bg-surface p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-medium">Router health</h2>
          <Link to="/app/routers" className="text-sm text-accent hover:underline">
            Inventory
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="pb-2 font-medium">Router</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">WireGuard</th>
                <th className="pb-2 font-medium">CPU</th>
                <th className="pb-2 font-medium">Uptime</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.routers.map((r) => (
                <tr key={r.id}>
                  <td className="py-3">
                    <div>{r.name}</div>
                    <div className="text-xs text-muted">{r.location}</div>
                  </td>
                  <td className="py-3 capitalize">{r.role}</td>
                  <td className="py-3">
                    <Badge tone={statusTone(r.wg_status)}>{r.wg_status}</Badge>
                  </td>
                  <td className="py-3 font-mono tabular-nums">{r.cpu_pct}%</td>
                  <td className="py-3 font-mono tabular-nums">{r.uptime_hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-24 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

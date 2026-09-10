import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { Kpi, PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { getSaasRevenue } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/revenue")({ component: RevenuePage });

function RevenuePage() {
  const [data, setData] = useState<Awaited<ReturnType<typeof getSaasRevenue>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getSaasRevenue()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!data) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;

  return (
    <div>
      <PageHead eyebrow="Finance" title="SaaS revenue" hint="Platform invoices and collections — not ISP customer payments." />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label="MRR" value={kes(data.mrr)} />
        <Kpi label="ARR" value={kes(data.arr)} />
        <Kpi label="Collected this month" value={kes(data.paid_month)} />
        <Kpi label="Outstanding" value={kes(data.outstanding)} tone={data.outstanding ? "warn" : "ok"} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-base font-medium">Invoices</h2>
          <ul className="space-y-2 text-sm">
            {data.invoices.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <div>
                  <Link to="/platform/tenants/$tenantId" params={{ tenantId: i.tenant_id }} className="hover:text-accent">
                    {i.tenant_name}
                  </Link>
                  <div className="text-xs text-muted">
                    {i.number} · {i.plan}
                  </div>
                </div>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{kes(i.amount_kes)}</span>
                  <StatusPill status={i.status} />
                </span>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="mb-4 text-base font-medium">Payments</h2>
          <ul className="space-y-2 text-sm">
            {data.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3">
                <div>
                  {p.tenant_name}
                  <div className="text-xs text-muted">
                    {p.provider} · {p.reference}
                  </div>
                </div>
                <span>
                  <span className="font-mono">{kes(p.amount_kes)}</span>
                  <div className="text-right text-xs text-muted">{nairobiTime(p.paid_at)}</div>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>
    </div>
  );
}

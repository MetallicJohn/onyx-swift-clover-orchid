import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { listSaasSubscriptions } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/subscriptions")({ component: SubsPage });

function SubsPage() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof listSaasSubscriptions>>["rows"]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listSaasSubscriptions()
      .then((r) => setRows(r.rows))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
  }, []);

  return (
    <div>
      <PageHead eyebrow="Billing" title="Subscriptions" hint="Live plan, status, and renewal for every ISP." />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Panel className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-subtle">
            <tr className="border-b border-border">
              <th className="px-5 py-3 font-medium">ISP</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Cycle</th>
              <th className="px-3 py-3 font-medium">MRR</th>
              <th className="px-3 py-3 font-medium">Renewal</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.tenant_id} className="border-b border-border last:border-0">
                <td className="px-5 py-3">
                  <Link to="/platform/tenants/$tenantId" params={{ tenantId: r.tenant_id }} className="hover:text-accent">
                    {r.tenant_name}
                  </Link>
                </td>
                <td className="px-3 py-3 capitalize">
                  {r.plan}
                  {r.pending_plan ? <div className="text-xs text-warn">Pending {r.pending_plan}</div> : null}
                </td>
                <td className="px-3 py-3">
                  <StatusPill status={r.status} />
                </td>
                <td className="px-3 py-3">{r.billing_cycle}</td>
                <td className="px-3 py-3 font-mono">{kes(r.monthly_kes)}</td>
                <td className="px-3 py-3 text-muted">{nairobiTime(r.period_end)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}

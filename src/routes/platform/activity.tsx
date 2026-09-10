import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { PageHead, Panel } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getSaasActivity } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/activity")({ component: ActivityPage });

function ActivityPage() {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getSaasActivity>>["rows"]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function load(next = 1) {
    const res = await getSaasActivity({ data: { q, page: next, pageSize: 40 } });
    setRows(res.rows);
    setTotal(res.total);
    setPage(res.page);
  }

  useEffect(() => {
    load(1).catch((e) => setError(e instanceof Error ? e.message : "Could not load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div>
      <PageHead eyebrow="Audit" title="Platform activity" hint="Tenant create/suspend, plan changes, support access, and security events." />
      <Input className="mb-4 max-w-md" placeholder="Filter action, email, or id" value={q} onChange={(e) => setQ(e.target.value)} />
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <Panel>
        <ul className="space-y-3 text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 border-b border-border pb-3 last:border-0 sm:flex-row sm:justify-between">
              <div>
                <div className="font-medium">{r.action}</div>
                <div className="text-xs text-muted">
                  {r.actor_email} · {r.entity_type} {r.entity_id}
                </div>
              </div>
              <div className="text-muted">{nairobiTime(r.created_at)}</div>
            </li>
          ))}
          {rows.length === 0 ? <p className="text-muted">No events.</p> : null}
        </ul>
      </Panel>
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => void load(page - 1)}>
          Previous
        </Button>
        <Button type="button" variant="secondary" disabled={page * 40 >= total} onClick={() => void load(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}

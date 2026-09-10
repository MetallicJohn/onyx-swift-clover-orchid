import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { HealthDot, PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { createSaasTenant, listSaasPlans, listSaasTenants } from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/tenants")({ component: TenantsPage });

type Row = Awaited<ReturnType<typeof listSaasTenants>>["tenants"][number];

function TenantsPage() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/platform/tenants") return <Outlet />;
  return <TenantsList />;
}

function TenantsList() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [plan, setPlan] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [plans, setPlans] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ isp_name: "", owner_name: "", owner_email: "", owner_password: "" });
  const [busy, setBusy] = useState(false);

  async function load(nextPage = page) {
    const res = await listSaasTenants({ data: { q, status, plan, page: nextPage, pageSize: 25 } });
    setRows(res.tenants);
    setTotal(res.total);
    setPage(res.page);
    setPageSize(res.pageSize);
  }

  useEffect(() => {
    listSaasPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    load(1).catch((e) => setError(e instanceof Error ? e.message : "Could not load ISPs"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, plan]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div>
      <PageHead
        eyebrow="Tenants"
        title="ISPs"
        hint="Every workspace on the platform. Customer records stay inside the ISP — this list is counts, plan, and health."
        actions={
          <Button type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Close" : "Create ISP"}
          </Button>
        }
      />

      {open ? (
        <form
          className="mb-6 grid gap-3 rounded-xl bg-surface p-5 shadow-card sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const created = await createSaasTenant({ data: form });
              setForm({ isp_name: "", owner_name: "", owner_email: "", owner_password: "" });
              setOpen(false);
              await load(1);
              await navigate({ to: "/platform/tenants/$tenantId", params: { tenantId: created.tenant_id } });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not create ISP");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="ISP name">
            <Input required value={form.isp_name} onChange={(e) => setForm({ ...form, isp_name: e.target.value })} />
          </Field>
          <Field label="Owner name">
            <Input required value={form.owner_name} onChange={(e) => setForm({ ...form, owner_name: e.target.value })} />
          </Field>
          <Field label="Owner email">
            <Input type="email" required value={form.owner_email} onChange={(e) => setForm({ ...form, owner_email: e.target.value })} />
          </Field>
          <Field label="Owner password">
            <Input type="password" required minLength={8} value={form.owner_password} onChange={(e) => setForm({ ...form, owner_password: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create ISP + owner login"}
            </Button>
          </div>
        </form>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Input placeholder="Search name, slug, or id" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
          <option value="">All plans</option>
          {plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>

      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <Panel className="overflow-x-auto p-0 md:p-0">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="text-xs uppercase tracking-wider text-subtle">
            <tr className="border-b border-border">
              <th className="px-5 py-3 font-medium">ISP</th>
              <th className="px-3 py-3 font-medium">Plan</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Customers</th>
              <th className="px-3 py-3 font-medium">Routers</th>
              <th className="px-3 py-3 font-medium">Health</th>
              <th className="px-3 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-border last:border-0 hover:bg-elevated/40">
                <td className="px-5 py-3">
                  <Link to="/platform/tenants/$tenantId" params={{ tenantId: t.id }} className="font-medium hover:text-accent">
                    {t.name}
                  </Link>
                  <div className="text-xs text-muted">
                    {t.slug} · {t.id}
                  </div>
                </td>
                <td className="px-3 py-3 capitalize">
                  {t.plan_name}
                  {t.trial ? <div className="text-xs text-muted">Trial</div> : null}
                </td>
                <td className="px-3 py-3">
                  <StatusPill status={t.status} />
                </td>
                <td className="px-3 py-3 font-mono">{t.customers}</td>
                <td className="px-3 py-3 font-mono">{t.routers}</td>
                <td className="px-3 py-3">
                  <HealthDot health={t.node_health} />
                </td>
                <td className="px-3 py-3 text-muted">{nairobiTime(t.created_at)}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-8 text-center text-muted">
                  No ISPs match.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </Panel>

      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>
          {total} total · page {page} of {pages}
        </span>
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={page <= 1} onClick={() => load(page - 1).catch(() => undefined)}>
            Previous
          </Button>
          <Button type="button" variant="secondary" disabled={page >= pages} onClick={() => load(page + 1).catch(() => undefined)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

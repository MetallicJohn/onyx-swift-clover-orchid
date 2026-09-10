import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { nairobiTime } from "@/components/platform/format";
import { HealthDot, Meter, PageHead, Panel, StatusPill, Telemetry } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { kes } from "@/lib/utils";
import {
  addSaasOperator,
  assignSaasPlan,
  cancelSaasSubscription,
  enrollSaasNode,
  extendSaasTrial,
  getSaasSettings,
  getSaasTenant,
  listSaasPlans,
  reactivateSaasTenant,
  resetSaasOperatorPassword,
  startSaasSupport,
  suspendSaasTenant,
  updateSaasTenant,
} from "@/lib/isp/server-platform";

export const Route = createFileRoute("/platform/tenants/$tenantId")({ component: TenantDetailPage });

function TenantDetailPage() {
  const { tenantId } = Route.useParams();
  const [data, setData] = useState<Awaited<ReturnType<typeof getSaasTenant>> | null>(null);
  const [plans, setPlans] = useState<Awaited<ReturnType<typeof listSaasPlans>>["plans"]>([]);
  const [supportOn, setSupportOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState("");
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [edit, setEdit] = useState({ name: "", support_email: "", support_phone: "", timezone: "Africa/Nairobi" });
  const [owner, setOwner] = useState({ name: "", email: "", password: "", role: "isp_owner" });
  const [reset, setReset] = useState({ email: "", password: "" });
  const [nodeName, setNodeName] = useState("edge-1");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  async function load() {
    const [d, p, s] = await Promise.all([
      getSaasTenant({ data: { tenant_id: tenantId } }),
      listSaasPlans(),
      getSaasSettings(),
    ]);
    setData(d);
    setPlans(p.plans);
    setSupportOn(s.support_access_enabled);
    setEdit({
      name: d.tenant.name,
      support_email: d.tenant.support_email,
      support_phone: d.tenant.support_phone,
      timezone: d.tenant.timezone,
    });
    setPlan(d.subscription.plan);
    setReset((r) => ({ ...r, email: d.operators[0]?.email || r.email }));
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load ISP"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function run(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await fn();
      await load();
      if (ok) setNote(ok);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) return <div className="h-40 animate-pulse rounded-xl bg-surface" />;
  if (!data) return <p className="text-sm text-danger">{error}</p>;

  const sub = data.subscription;
  const u = data.usage;

  return (
    <div className="space-y-6">
      <PageHead
        eyebrow="Tenant"
        title={data.tenant.name}
        hint={`${data.tenant.slug} · ${data.tenant.id}`}
        actions={
          <>
            <Link to="/platform/tenants" className="inline-flex h-11 items-center text-sm text-muted hover:text-fg">
              All ISPs
            </Link>
            {data.tenant.status === "suspended" ? (
              <Button type="button" disabled={busy} onClick={() => run(() => reactivateSaasTenant({ data: { tenant_id: tenantId } }), "Reactivated")}>
                Reactivate
              </Button>
            ) : (
              <Button
                type="button"
                variant="danger"
                disabled={busy || reason.trim().length < 3}
                onClick={() => run(() => suspendSaasTenant({ data: { tenant_id: tenantId, reason } }), "Suspended")}
              >
                Suspend
              </Button>
            )}
          </>
        }
      />

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {note ? <p className="text-sm text-ok">{note}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <h2 className="mb-4 text-base font-medium">Organization</h2>
          <form
            className="grid gap-3 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => updateSaasTenant({ data: { tenant_id: tenantId, ...edit } }), "Saved");
            }}
          >
            <Field label="Company name">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label="Timezone">
              <Input value={edit.timezone} onChange={(e) => setEdit({ ...edit, timezone: e.target.value })} />
            </Field>
            <Field label="Support email">
              <Input value={edit.support_email} onChange={(e) => setEdit({ ...edit, support_email: e.target.value })} />
            </Field>
            <Field label="Support phone">
              <Input value={edit.support_phone} onChange={(e) => setEdit({ ...edit, support_phone: e.target.value })} />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <StatusPill status={data.tenant.status} />
              <span className="text-sm text-muted">Created {nairobiTime(data.tenant.created_at)}</span>
              <Button type="submit" size="sm" disabled={busy}>
                Save
              </Button>
            </div>
          </form>
          {data.tenant.status !== "suspended" ? (
            <Field label="Suspend reason">
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required before suspend" />
            </Field>
          ) : (
            <p className="mt-3 text-sm text-danger">Suspended: {data.tenant.suspended_reason || "—"}</p>
          )}
        </Panel>

        <Panel>
          <h2 className="mb-4 text-base font-medium">Subscription</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Plan</dt>
              <dd className="capitalize">{sub.plan_name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Price</dt>
              <dd className="font-mono">{kes(sub.price_kes)} / {sub.billing_cycle}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Status</dt>
              <dd>
                <StatusPill status={sub.status} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Started</dt>
              <dd>{nairobiTime(sub.started_at)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Renewal</dt>
              <dd>{nairobiTime(sub.period_end)}</dd>
            </div>
          </dl>
          <div className="mt-4 grid gap-2">
            <Select value={plan} onChange={(e) => setPlan(e.target.value)}>
              {plans.filter((p) => p.status === "active").map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} · {kes(p.monthly_kes)}/mo
                </option>
              ))}
            </Select>
            <Select value={cycle} onChange={(e) => setCycle(e.target.value as "monthly" | "annual")}>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </Select>
            <Button
              type="button"
              disabled={busy}
              onClick={() => run(() => assignSaasPlan({ data: { tenant_id: tenantId, plan, cycle } }), "Plan assigned")}
            >
              Assign plan
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => extendSaasTrial({ data: { tenant_id: tenantId, days: 14 } }), "Trial extended 14 days")}
            >
              Extend trial 14 days
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => cancelSaasSubscription({ data: { tenant_id: tenantId } }), "Subscription cancelled (data kept)")}
            >
              Cancel subscription
            </Button>
          </div>
        </Panel>
      </div>

      <Panel>
        <h2 className="mb-4 text-base font-medium">Usage against plan</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Meter label="Customers" value={u.customers} max={u.customers_max} />
          <Meter label="Routers" value={u.routers} max={u.routers_max} />
          <Meter label="Services" value={u.services} max={u.services_max} />
          <Meter label="Staff" value={u.members} max={u.members_max} />
        </div>
        <p className="mt-4 text-sm text-muted">
          Active services {u.services_active} · open tickets {u.tickets_open} · RADIUS sessions {u.sessions}
        </p>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-base font-medium">Infrastructure</h2>
          <dl className="mb-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted">CPU</dt>
              <dd>
                <Telemetry value={data.infrastructure.cpu} unit="%" />
              </dd>
            </div>
            <div>
              <dt className="text-muted">RAM</dt>
              <dd>
                <Telemetry value={data.infrastructure.ram} unit="%" />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Disk</dt>
              <dd>
                <Telemetry value={data.infrastructure.disk} unit="%" />
              </dd>
            </div>
            <div>
              <dt className="text-muted">Agents</dt>
              <dd className="font-mono">
                {data.infrastructure.online}/{data.infrastructure.total} online
              </dd>
            </div>
          </dl>
          <ul className="space-y-2 text-sm">
            {data.routers.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 rounded-md bg-elevated/50 px-3 py-2">
                <div>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted">Last seen {nairobiTime(r.last_seen)}</div>
                </div>
                <HealthDot health={r.health} />
              </li>
            ))}
            {data.nodes.map((n) => (
              <li key={n.id} className="flex items-center justify-between gap-3 rounded-md bg-elevated/50 px-3 py-2">
                <div>
                  <div className="font-medium">{n.name}</div>
                  <div className="text-xs text-muted">
                    CPU <Telemetry value={n.cpu_pct} unit="%" /> · RAM <Telemetry value={n.ram_pct} unit="%" />
                  </div>
                </div>
                <HealthDot health={n.health} />
              </li>
            ))}
            {data.routers.length === 0 && data.nodes.length === 0 ? (
              <p className="text-sm text-muted">No routers or telemetry nodes.</p>
            ) : null}
          </ul>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const n = await enrollSaasNode({ data: { tenant_id: tenantId, name: nodeName } });
                setIssuedToken(n.token);
              }, "Node token issued once");
            }}
          >
            <Input value={nodeName} onChange={(e) => setNodeName(e.target.value)} placeholder="Node name" />
            <Button type="submit" variant="secondary" disabled={busy}>
              Issue node token
            </Button>
          </form>
          {issuedToken ? (
            <p className="mt-2 break-all text-xs text-warn">
              Copy now — this token is not shown again: <span className="font-mono text-fg">{issuedToken}</span>
            </p>
          ) : null}
        </Panel>

        <Panel>
          <h2 className="mb-4 text-base font-medium">Financial</h2>
          <p className="mb-3 text-sm text-muted">
            Outstanding {kes(data.financial.outstanding_kes)} · collected {kes(data.financial.revenue_kes)}
          </p>
          <ul className="space-y-2 text-sm">
            {data.financial.invoices.slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-3">
                <span>
                  {i.number} · {i.plan}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono">{kes(i.amount_kes)}</span>
                  <StatusPill status={i.status} />
                </span>
              </li>
            ))}
            {data.financial.invoices.length === 0 ? <p className="text-muted">No SaaS invoices.</p> : null}
          </ul>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="mb-4 text-base font-medium">Operators</h2>
          <ul className="mb-4 space-y-2 text-sm">
            {data.operators.map((o) => (
              <li key={o.user_id} className="flex justify-between gap-3">
                <span>
                  {o.name} · {o.email}
                </span>
                <span className="text-muted">{o.role.replaceAll("_", " ")}</span>
              </li>
            ))}
          </ul>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => addSaasOperator({ data: { tenant_id: tenantId, ...owner } }),
                "Operator created",
              );
            }}
          >
            <Input placeholder="Name" value={owner.name} onChange={(e) => setOwner({ ...owner, name: e.target.value })} required />
            <Input type="email" placeholder="Email" value={owner.email} onChange={(e) => setOwner({ ...owner, email: e.target.value })} required />
            <Input type="password" minLength={8} placeholder="Password" value={owner.password} onChange={(e) => setOwner({ ...owner, password: e.target.value })} required />
            <Select value={owner.role} onChange={(e) => setOwner({ ...owner, role: e.target.value })}>
              <option value="isp_owner">Owner</option>
              <option value="isp_admin">Admin</option>
              <option value="finance">Finance</option>
              <option value="network_engineer">Network</option>
            </Select>
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={busy}>
                Add operator
              </Button>
            </div>
          </form>
          <form
            className="mt-4 grid gap-2 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () => resetSaasOperatorPassword({ data: { ...reset, tenant_id: tenantId } }),
                "Password updated",
              );
            }}
          >
            <Input type="email" placeholder="Reset email" value={reset.email} onChange={(e) => setReset({ ...reset, email: e.target.value })} required />
            <Input type="password" minLength={8} placeholder="New password" value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} required />
            <div className="sm:col-span-2">
              <Button type="submit" variant="secondary" disabled={busy}>
                Reset password
              </Button>
            </div>
          </form>
        </Panel>

        <Panel>
          <h2 className="mb-4 text-base font-medium">Activity</h2>
          <ul className="space-y-2 text-sm">
            {data.activity.map((a) => (
              <li key={a.id} className="flex justify-between gap-3">
                <span>
                  {a.action} <span className="text-muted">· {a.actor_email}</span>
                </span>
                <span className="text-muted">{nairobiTime(a.created_at)}</span>
              </li>
            ))}
            {data.activity.length === 0 ? <p className="text-muted">No platform events for this ISP yet.</p> : null}
          </ul>
          <div className="mt-5 border-t border-border pt-4">
            <h3 className="mb-2 text-sm font-medium">Support access</h3>
            {supportOn ? (
              <form
                className="grid gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  const why = String(fd.get("why") || "");
                  void run(async () => {
                    await startSaasSupport({ data: { tenant_id: tenantId, reason: why } });
                    window.location.href = "/app";
                  });
                }}
              >
                <Textarea name="why" required minLength={8} placeholder="Why you need a time-limited support session" />
                <Button type="submit" variant="secondary" disabled={busy}>
                  Start support session
                </Button>
              </form>
            ) : (
              <p className="text-sm text-muted">
                Disabled. Enable it in{" "}
                <Link to="/platform/settings" className="text-accent hover:underline">
                  System Settings
                </Link>
                .
              </p>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { kesOrDash } from "@/components/platform/format";
import { PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { FEATURE_CATALOG, type PlanRecord } from "@/lib/isp/plans";
import { listSaasPlans, saveSaasPlan, setSaasPlanStatus } from "@/lib/isp/server-platform";
import { kes } from "@/lib/utils";

export const Route = createFileRoute("/platform/plans")({ component: PlansPage });

const empty = (): PlanRecord => ({
  code: "",
  name: "",
  description: "",
  monthly_kes: 0,
  annual_kes: 0,
  trial_days: 0,
  max_customers: 500,
  max_routers: 20,
  max_services: 0,
  max_admins: 0,
  max_storage_gb: 0,
  api_requests_per_day: 0,
  support_level: "email",
  entitlements: Object.fromEntries(FEATURE_CATALOG.map((f) => [f.id, false])),
  status: "active",
  sort_order: 100,
});

function PlansPage() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState<PlanRecord>(empty());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await listSaasPlans();
    setPlans(r.plans);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load plans"));
  }, []);

  return (
    <div>
      <PageHead
        eyebrow="Catalog"
        title="Subscription plans"
        hint="Limits and feature entitlements are stored in the database. The ISP console never hardcodes this list."
      />
      {error ? <p className="mb-3 text-sm text-danger">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        {plans.map((p) => (
          <Panel key={p.code}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium">{p.name}</h2>
                <p className="text-xs text-muted">{p.code}</p>
              </div>
              <StatusPill status={p.status} />
            </div>
            <p className="mb-4 text-sm text-muted">{p.description}</p>
            <p className="mb-3 font-mono text-sm">
              {kes(p.monthly_kes)}/mo · {kesOrDash(p.annual_kes)}/yr
            </p>
            <p className="text-xs text-muted">
              {p.max_customers} customers · {p.max_routers} routers · {p.support_level}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {FEATURE_CATALOG.filter((f) => p.entitlements[f.id]).map((f) => (
                <span key={f.id} className="rounded-full bg-elevated px-2 py-0.5 text-[11px] text-muted">
                  {f.label}
                </span>
              ))}
            </div>
            <div className="mt-4 flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setForm(p)}>
                Edit
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await setSaasPlanStatus({ data: { code: p.code, status: p.status === "archived" ? "active" : "archived" } });
                  await load();
                }}
              >
                {p.status === "archived" ? "Restore" : "Archive"}
              </Button>
            </div>
          </Panel>
        ))}
      </div>

      <Panel className="mt-6">
        <h2 className="mb-4 text-base font-medium">{form.code ? `Edit ${form.name}` : "New plan"}</h2>
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await saveSaasPlan({ data: form });
              setForm(empty());
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save plan");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Code">
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="auto from name" />
          </Field>
          <Field label="Description">
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Support level">
            <Select value={form.support_level} onChange={(e) => setForm({ ...form, support_level: e.target.value })}>
              <option value="community">Community</option>
              <option value="email">Email</option>
              <option value="priority">Priority</option>
              <option value="sla">SLA</option>
              <option value="dedicated">Dedicated</option>
            </Select>
          </Field>
          <Field label="Monthly KES">
            <Input type="number" value={form.monthly_kes} onChange={(e) => setForm({ ...form, monthly_kes: Number(e.target.value) })} />
          </Field>
          <Field label="Annual KES">
            <Input type="number" value={form.annual_kes} onChange={(e) => setForm({ ...form, annual_kes: Number(e.target.value) })} />
          </Field>
          <Field label="Trial days">
            <Input type="number" value={form.trial_days} onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })} />
          </Field>
          <Field label="Max customers (0 = unlimited)">
            <Input type="number" value={form.max_customers} onChange={(e) => setForm({ ...form, max_customers: Number(e.target.value) })} />
          </Field>
          <Field label="Max routers">
            <Input type="number" value={form.max_routers} onChange={(e) => setForm({ ...form, max_routers: Number(e.target.value) })} />
          </Field>
          <Field label="Max services">
            <Input type="number" value={form.max_services} onChange={(e) => setForm({ ...form, max_services: Number(e.target.value) })} />
          </Field>
          <Field label="Max staff">
            <Input type="number" value={form.max_admins} onChange={(e) => setForm({ ...form, max_admins: Number(e.target.value) })} />
          </Field>
          <Field label="Max storage GB">
            <Input type="number" value={form.max_storage_gb} onChange={(e) => setForm({ ...form, max_storage_gb: Number(e.target.value) })} />
          </Field>
          <Field label="API requests / day">
            <Input type="number" value={form.api_requests_per_day} onChange={(e) => setForm({ ...form, api_requests_per_day: Number(e.target.value) })} />
          </Field>
          <div className="sm:col-span-2">
            <div className="mb-2 text-xs font-medium tracking-wide text-muted">Feature entitlements</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURE_CATALOG.map((f) => (
                <label key={f.id} className="flex h-11 items-center gap-2 rounded-md border border-border px-3 text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(form.entitlements[f.id])}
                    onChange={(e) => setForm({ ...form, entitlements: { ...form.entitlements, [f.id]: e.target.checked } })}
                  />
                  {f.label}
                </label>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2 flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save plan"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setForm(empty())}>
              Clear
            </Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

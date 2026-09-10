import { createFileRoute } from "@tanstack/react-router";
import { Archive, ArchiveRestore, Plus } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { kesOrDash } from "@/components/platform/format";
import { PageHead, Panel, StatusPill } from "@/components/platform/ui";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { FEATURE_CATALOG, type PlanRecord } from "@/lib/isp/plans";
import { listSaasPlans, saveSaasPlan, setSaasPlanStatus } from "@/lib/isp/server-platform";
import { cn, kes } from "@/lib/utils";

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

function limitText(n: number) {
  return n <= 0 ? "Unlimited" : n.toLocaleString("en-KE");
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <div className="border-b border-border pb-2">
        <h3 className="text-sm font-medium tracking-tight">{title}</h3>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function PlansPage() {
  const [plans, setPlans] = useState<PlanRecord[]>([]);
  const [form, setForm] = useState<PlanRecord>(empty());
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  const editing = open && plans.some((p) => p.code === form.code);
  const creating = open && !editing;
  const enabledFeatures = FEATURE_CATALOG.filter((f) => form.entitlements[f.id]).length;

  async function load() {
    const r = await listSaasPlans();
    setPlans(r.plans);
  }

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Could not load plans"));
  }, []);

  function showEditor() {
    setOpen(true);
    setError(null);
    requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1023px)").matches) {
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function selectPlan(plan: PlanRecord) {
    setForm(plan);
    showEditor();
  }

  function newPlan() {
    setForm(empty());
    showEditor();
  }

  function closeEditor() {
    setForm(empty());
    setOpen(false);
  }

  async function toggleArchive(plan: PlanRecord) {
    setError(null);
    try {
      const status = plan.status === "archived" ? "active" : "archived";
      await setSaasPlanStatus({ data: { code: plan.code, status } });
      await load();
      setForm((current) => (current.code === plan.code ? { ...current, status } : current));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update plan status");
    }
  }

  const planCards =
    plans.length === 0 ? (
      <Panel className={open ? "" : "sm:col-span-2 xl:col-span-3"}>
        <p className="text-sm text-muted">No plans yet. Click New plan to create one.</p>
      </Panel>
    ) : (
      plans.map((plan) => {
        const selected = open && form.code === plan.code;
        return (
          <div
            key={plan.code}
            className={cn(
              "flex gap-1 rounded-lg transition-colors duration-150",
              selected ? "bg-accent/10" : "bg-surface hover:bg-elevated",
              plan.status === "archived" && !selected ? "opacity-60" : "",
            )}
          >
            <button
              type="button"
              onClick={() => selectPlan(plan)}
              className={cn(
                "min-h-11 min-w-0 flex-1 rounded-lg px-4 py-3 text-left",
                selected ? "ring-1 ring-accent/40" : "",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{plan.name}</span>
                <StatusPill status={plan.status} />
              </div>
              <p className="mt-1 font-mono text-sm tabular-nums">
                {plan.monthly_kes === 0 ? "Free" : `${kes(plan.monthly_kes)}/mo`}
              </p>
              <p className="mt-1 truncate text-xs text-muted">
                {limitText(plan.max_customers)} customers · {limitText(plan.max_routers)} routers
              </p>
              {!open ? <p className="mt-2 line-clamp-2 text-sm text-muted">{plan.description}</p> : null}
            </button>
            <button
              type="button"
              className="grid size-11 shrink-0 place-items-center text-muted hover:text-fg"
              aria-label={plan.status === "archived" ? `Restore ${plan.name}` : `Archive ${plan.name}`}
              onClick={() => toggleArchive(plan)}
            >
              {plan.status === "archived" ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
            </button>
          </div>
        );
      })
    );

  return (
    <div>
      <PageHead
        eyebrow="Catalog"
        title="Subscription plans"
        hint="Choose a plan to edit it, or create a new one. Limits and feature entitlements are stored in the database — the ISP console never hardcodes this list."
        actions={
          <Button type="button" variant={creating ? "secondary" : "default"} onClick={newPlan}>
            <Plus className="size-4" />
            New plan
          </Button>
        }
      />
      {error ? <p className="mb-4 text-sm text-danger">{error}</p> : null}

      <div
        className={cn(
          "grid items-start gap-2",
          open ? "gap-6 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]" : "sm:grid-cols-2 xl:grid-cols-3",
        )}
      >
        {open ? (
          <div className="flex flex-col gap-2 lg:sticky lg:top-20">
            <p className="px-1 text-xs font-medium uppercase tracking-wider text-subtle">Plans</p>
            {planCards}
          </div>
        ) : (
          planCards
        )}

        {open ? (
          <Panel>
            <div ref={editorRef} className="scroll-mt-20">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-subtle">
                    {editing ? "Editing" : "New plan"}
                  </p>
                  <h2 className="mt-1 text-lg font-medium tracking-tight">{editing ? form.name : "Create a plan"}</h2>
                  {editing ? (
                    <p className="mt-1 font-mono text-xs text-muted">
                      {form.code} · {kes(form.monthly_kes)}/mo · {kesOrDash(form.annual_kes)}/yr
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-muted">Set pricing, limits, and the modules this plan unlocks.</p>
                  )}
                </div>
                {editing ? <StatusPill status={form.status} /> : null}
              </div>

              <form
                className="grid gap-8"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setError(null);
                  try {
                    await saveSaasPlan({ data: form });
                    closeEditor();
                    await load();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "Could not save plan");
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Section title="Details">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Name">
                      <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field label="Code">
                      <Input
                        value={form.code}
                        onChange={(e) => setForm({ ...form, code: e.target.value })}
                        placeholder="auto from name"
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <Field label="Description">
                        <Textarea
                          value={form.description}
                          onChange={(e) => setForm({ ...form, description: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="Support level">
                      <Select
                        value={form.support_level}
                        onChange={(e) => setForm({ ...form, support_level: e.target.value })}
                      >
                        <option value="community">Community</option>
                        <option value="email">Email</option>
                        <option value="priority">Priority</option>
                        <option value="sla">SLA</option>
                        <option value="dedicated">Dedicated</option>
                      </Select>
                    </Field>
                  </div>
                </Section>

                <Section title="Pricing" hint="Monthly is used for MRR. Annual is billed when a subscription is assigned on that cycle.">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Monthly KES">
                      <Input
                        type="number"
                        value={form.monthly_kes}
                        onChange={(e) => setForm({ ...form, monthly_kes: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Annual KES">
                      <Input
                        type="number"
                        value={form.annual_kes}
                        onChange={(e) => setForm({ ...form, annual_kes: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Trial days">
                      <Input
                        type="number"
                        value={form.trial_days}
                        onChange={(e) => setForm({ ...form, trial_days: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </Section>

                <Section title="Limits" hint="Use 0 for unlimited.">
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <Field label="Max customers">
                      <Input
                        type="number"
                        value={form.max_customers}
                        onChange={(e) => setForm({ ...form, max_customers: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Max routers">
                      <Input
                        type="number"
                        value={form.max_routers}
                        onChange={(e) => setForm({ ...form, max_routers: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Max services">
                      <Input
                        type="number"
                        value={form.max_services}
                        onChange={(e) => setForm({ ...form, max_services: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Max staff">
                      <Input
                        type="number"
                        value={form.max_admins}
                        onChange={(e) => setForm({ ...form, max_admins: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="Max storage GB">
                      <Input
                        type="number"
                        value={form.max_storage_gb}
                        onChange={(e) => setForm({ ...form, max_storage_gb: Number(e.target.value) })}
                      />
                    </Field>
                    <Field label="API requests / day">
                      <Input
                        type="number"
                        value={form.api_requests_per_day}
                        onChange={(e) => setForm({ ...form, api_requests_per_day: Number(e.target.value) })}
                      />
                    </Field>
                  </div>
                </Section>

                <Section
                  title="Feature entitlements"
                  hint={`${enabledFeatures} of ${FEATURE_CATALOG.length} enabled. Server checks these — hiding a module in the ISP console is not enough.`}
                >
                  <div className="grid gap-2 sm:grid-cols-2">
                    {FEATURE_CATALOG.map((feature) => {
                      const on = Boolean(form.entitlements[feature.id]);
                      return (
                        <label
                          key={feature.id}
                          className={cn(
                            "flex min-h-11 items-center gap-3 rounded-md border px-3 text-sm transition-colors duration-150",
                            on ? "border-accent/40 bg-accent/10" : "border-border bg-bg",
                          )}
                        >
                          <input
                            type="checkbox"
                            className="size-4 accent-accent"
                            checked={on}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                entitlements: { ...form.entitlements, [feature.id]: e.target.checked },
                              })
                            }
                          />
                          {feature.label}
                        </label>
                      );
                    })}
                  </div>
                </Section>

                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  <Button type="submit" disabled={busy}>
                    {busy ? "Saving…" : editing ? "Save changes" : "Save plan"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={closeEditor}>
                    Cancel
                  </Button>
                </div>
              </form>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

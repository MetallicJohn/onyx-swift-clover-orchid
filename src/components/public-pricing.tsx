import { Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { buttonVariants } from "@/components/ui/button";
import { listPublicPlans } from "@/lib/isp/server-platform";
import { annualSavingsPct, isSalesContactPlan, type PublicPlan } from "@/lib/isp/plans";
import { cn, kes } from "@/lib/utils";

function cap(n: number, unit: string) {
  if (n <= 0) return `No limit on ${unit}`;
  return `${n.toLocaleString("en-KE")} ${unit}`;
}

function featuredCode(plans: PublicPlan[]) {
  const paid = plans.filter((p) => p.monthly_kes > 0);
  if (!paid.length) return plans[0]?.code ?? "";
  return paid[Math.floor((paid.length - 1) / 2)]?.code ?? "";
}

function priceLabel(plan: PublicPlan, cycle: "monthly" | "annual") {
  if (isSalesContactPlan(plan)) {
    return { headline: "Ask us", suffix: "", note: "Limits and onboarding are agreed separately" };
  }
  if (cycle === "annual" && plan.annual_kes > 0) {
    const save = annualSavingsPct(plan.monthly_kes, plan.annual_kes);
    return {
      headline: kes(plan.annual_kes),
      suffix: "/yr",
      note: `${kes(Math.round(plan.annual_kes / 12))}/mo billed yearly${save > 0 ? ` · ${save}% less than monthly` : ""}`,
    };
  }
  if (plan.monthly_kes <= 0) {
    return {
      headline: "Free",
      suffix: plan.trial_days > 0 ? `${plan.trial_days}-day trial` : "",
      note: "",
    };
  }
  return { headline: kes(plan.monthly_kes), suffix: "/mo", note: "" };
}

function planCta(plan: PublicPlan) {
  if (isSalesContactPlan(plan)) return { href: "/#contact", label: "Send a message", trial: false };
  if (plan.trial_days > 0 && plan.monthly_kes <= 0) return { href: "/login?mode=up", label: "Start trial", trial: true };
  return { href: "/login?mode=up", label: "Get started", trial: false };
}

export function PublicPricing() {
  const [plans, setPlans] = useState<PublicPlan[]>([]);
  const [cycle, setCycle] = useState<"monthly" | "annual">("monthly");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    listPublicPlans()
      .then((r) => setPlans(r.plans))
      .catch(() => setPlans([]))
      .finally(() => setLoaded(true));
  }, []);

  if (loaded && plans.length === 0) return null;

  const hasAnnual = plans.some((p) => p.annual_kes > 0);
  const featured = featuredCode(plans);
  const maxSave = plans.reduce((n, p) => Math.max(n, annualSavingsPct(p.monthly_kes, p.annual_kes)), 0);

  return (
    <section id="pricing" className="mx-auto max-w-6xl scroll-mt-24 px-4 py-16 md:py-24">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">Pricing</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">Pay for the size of the operation</h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted md:text-base">
            Each plan sets customer, router, and staff limits, and which modules you can use. The figures below
            come from the live catalogue — if a plan changes, this page changes with it.
          </p>
        </div>
        {hasAnnual ? (
          <div>
            <div className="flex h-11 rounded-md border border-border bg-surface p-1">
              {(["monthly", "annual"] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setCycle(id)}
                  className={cn(
                    "min-h-9 rounded-sm px-4 text-sm capitalize transition-colors duration-150",
                    cycle === id ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
                  )}
                >
                  {id === "monthly" ? "Monthly" : "Yearly"}
                </button>
              ))}
            </div>
            {maxSave > 0 ? (
              <p className="mt-2 text-right text-xs text-muted">
                Yearly billing is up to {maxSave}% less where a yearly price is listed
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-10 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {!loaded
          ? [0, 1, 2].map((i) => <div key={i} className="h-80 animate-pulse rounded-xl bg-surface" />)
          : plans.map((plan) => {
              const price = priceLabel(plan, cycle);
              const highlight = plan.code === featured;
              const cta = planCta(plan);
              const save = cycle === "annual" ? annualSavingsPct(plan.monthly_kes, plan.annual_kes) : 0;
              return (
                <article
                  key={plan.code}
                  className={cn(
                    "flex flex-col rounded-xl border bg-surface p-5 shadow-card md:p-6",
                    highlight ? "border-accent" : "border-border",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-lg font-medium tracking-tight">{plan.name}</h3>
                      <p className="mt-1 text-sm leading-relaxed text-muted">{plan.description}</p>
                    </div>
                    {highlight ? (
                      <span className="shrink-0 rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                        Common pick
                      </span>
                    ) : null}
                  </div>

                  <div className="mt-5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-3xl font-semibold tracking-tight">{price.headline}</span>
                      {price.suffix ? <span className="text-sm text-muted">{price.suffix}</span> : null}
                    </div>
                    {price.note ? <p className="mt-1 text-xs text-muted">{price.note}</p> : null}
                    {plan.trial_days > 0 && plan.monthly_kes > 0 ? (
                      <p className="mt-1 text-xs text-muted">{plan.trial_days}-day trial</p>
                    ) : null}
                    {save > 0 ? <p className="mt-1 text-xs text-accent">{save}% less than paying monthly</p> : null}
                  </div>

                  <ul className="mt-5 grid gap-2 text-sm">
                    <li className="text-muted">{cap(plan.max_customers, "customers")}</li>
                    <li className="text-muted">{cap(plan.max_routers, "routers")}</li>
                    <li className="text-muted">{cap(plan.max_admins, "staff")}</li>
                    <li className="capitalize text-muted">{plan.support_level} support</li>
                  </ul>

                  <ul className="mt-5 grid gap-2 border-t border-border pt-5 text-sm">
                    {plan.features.map((f) => (
                      <li key={f.id} className="flex items-start gap-2">
                        <Check className="mt-0.5 size-4 shrink-0 text-accent" />
                        <span>{f.label}</span>
                      </li>
                    ))}
                  </ul>

                  {cta.href.startsWith("/login") ? (
                    <a
                      href={cta.href}
                      className={cn(
                        buttonVariants({ variant: highlight ? "default" : "secondary", size: "md" }),
                        "mt-6",
                      )}
                    >
                      {cta.label}
                    </a>
                  ) : (
                    <a
                      href={cta.href}
                      className={cn(buttonVariants({ variant: "secondary", size: "md" }), "mt-6")}
                    >
                      {cta.label}
                    </a>
                  )}
                </article>
              );
            })}
      </div>
      <p className="mt-6 text-center text-xs text-subtle">
        Already have an account? <Link to="/login">Sign in</Link>
        {" · "}
        <a href="/#contact" className="hover:text-muted">
          Ask a question
        </a>
      </p>
    </section>
  );
}

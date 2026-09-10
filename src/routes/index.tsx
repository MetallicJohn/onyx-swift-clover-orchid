import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ArrowRight, Radio, Shield, Wallet } from "lucide-react";
import { SignedIn, SignedOut } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { PublicPricing } from "@/components/public-pricing";
import { APP_NAME } from "@/lib/brand";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { isPending } = useCurrentUserState();

  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <div className="flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
            <Activity className="size-4" />
          </span>
          <span className="font-semibold tracking-tight">{APP_NAME}</span>
        </div>
        <div className="flex h-11 items-center gap-3 text-sm">
          {isPending ? <span className="size-8 animate-pulse rounded-full bg-elevated" /> : null}
          <Link to="/login" className="text-muted hover:text-fg">
            ISP login
          </Link>
          <SignedIn>
            <Link to="/app" className="rounded-md bg-accent px-4 py-2 font-medium text-accent-fg">
              Open console
            </Link>
          </SignedIn>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-10 pb-16 md:pt-20">
        <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">ISP operations SaaS</p>
        <h1 className="mt-4 max-w-3xl text-4xl leading-tight font-semibold tracking-tight md:text-6xl">
          Run the network. Collect the money. Keep customers online.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-relaxed text-muted md:text-lg">
          Multi-tenant billing, RADIUS-ready services, MikroTik via WireGuard agent, M-Pesa, and technician
          workflows — built for East African ISPs.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <SignedOut>
            <Link
              to="/login"
              className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-fg"
            >
              Start your ISP <ArrowRight className="size-4" />
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              to="/app"
              className="inline-flex h-12 items-center gap-2 rounded-md bg-accent px-5 font-medium text-accent-fg"
            >
              Continue to console <ArrowRight className="size-4" />
            </Link>
            <Link
              to="/login"
              className="inline-flex h-12 items-center rounded-md border border-border px-5 font-medium"
            >
              ISP login
            </Link>
          </SignedIn>
          <Link to="/portal" className="inline-flex h-12 items-center rounded-md border border-border px-5 font-medium">
            Customer portal
          </Link>
        </div>

        <div className="mt-16 grid gap-4 md:grid-cols-3">
          {[
            {
              icon: Wallet,
              title: "Billing that restores access",
              body: "Invoices, grace, suspension, and M-Pesa payments that automatically restore PPPoE and hotspot service.",
            },
            {
              icon: Radio,
              title: "Routers stay private",
              body: "WireGuard agent model. No public Winbox or API ports. Inventory, health, and onboarding scripts.",
            },
            {
              icon: Shield,
              title: "Tenant isolation first",
              body: "Every customer, invoice, and router is scoped to an ISP. Platform never mixes operator data.",
            },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border border-border bg-surface p-5">
              <f.icon className="size-5 text-accent" />
              <h2 className="mt-4 text-lg font-medium">{f.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <PublicPricing />
    </main>
  );
}

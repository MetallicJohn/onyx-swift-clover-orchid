import { ArrowRight, Radio, Router, Wallet, Wifi } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SignedIn } from "@/lib/auth/gates";
import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const CAPABILITIES = [
  "Customers",
  "Billing",
  "Payments",
  "PPPoE",
  "Hotspot",
  "MikroTik",
  "RADIUS",
  "CPE",
  "SMS",
  "WhatsApp",
  "Resellers",
  "Tickets",
  "Reports",
];

export function LandingHero() {
  return (
    <section className="landing-hero-wash relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-12 pb-16 md:pt-20 md:pb-24 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <p className="text-xs font-medium tracking-[0.2em] text-accent uppercase">
            ISP management software
          </p>
          <h1 className="mt-4 max-w-xl text-4xl leading-[1.12] font-semibold tracking-tight md:text-6xl">
            Run your ISP from one place
          </h1>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-muted md:text-lg">
            Keep customers, billing, payments and network access connected — from signup through invoices, M-Pesa,
            and whether the line is online. Your routers stay yours.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a href="/login?mode=up" className={cn(buttonVariants({ size: "lg" }))}>
              Get started <ArrowRight className="size-4" />
            </a>
            <Link to="/login" className={cn(buttonVariants({ variant: "secondary", size: "lg" }))}>
              Log in
            </Link>
            <SignedIn>
              <Link to="/app" className={cn(buttonVariants({ variant: "ghost", size: "lg" }))}>
                Open console
              </Link>
            </SignedIn>
          </div>
          <ul className="mt-8 flex flex-wrap gap-2">
            {CAPABILITIES.map((item) => (
              <li
                key={item}
                className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted"
              >
                {item}
              </li>
            ))}
          </ul>
        </div>
        <HeroCanvas />
      </div>
    </section>
  );
}

function HeroCanvas() {
  return (
    <div className="relative mx-auto w-full max-w-lg lg:max-w-none">
      <div className="landing-product-frame relative overflow-hidden rounded-xl border border-border shadow-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="size-2 rounded-full bg-border" />
          <span className="ml-2 text-[11px] tracking-wide text-subtle">Operations console · sample</span>
        </div>
        <div className="grid grid-cols-[4.5rem_1fr] sm:grid-cols-[7.5rem_1fr]">
          <aside className="border-r border-border p-3">
            <div className="h-2 w-10 rounded-full bg-accent/80" />
            <div className="mt-4 grid gap-2">
              {["Overview", "Customers", "Billing", "RADIUS", "Routers"].map((label, i) => (
                <div
                  key={label}
                  className={cn(
                    "h-7 rounded-sm",
                    i === 0 ? "bg-accent/20" : "bg-elevated",
                  )}
                  title={label}
                />
              ))}
            </div>
          </aside>
          <div className="p-3 sm:p-4">
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "Collections", value: "Ledger" },
                { label: "Sessions", value: "RADIUS" },
                { label: "Access", value: "PPPoE" },
              ].map((card) => (
                <div key={card.label} className="rounded-md bg-surface p-2.5 shadow-card">
                  <p className="text-[10px] tracking-wide text-subtle uppercase">{card.label}</p>
                  <p className="mt-1 font-mono text-sm text-fg">{card.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-md bg-surface p-3 shadow-card">
              <p className="text-[10px] tracking-wide text-subtle uppercase">Today</p>
              <ul className="mt-2 grid gap-2 text-xs">
                <li className="flex items-center justify-between text-muted">
                  <span>M-Pesa allocation</span>
                  <span className="text-ok">Matched</span>
                </li>
                <li className="flex items-center justify-between text-muted">
                  <span>Service renewal</span>
                  <span className="text-fg">Restored</span>
                </li>
                <li className="flex items-center justify-between text-muted">
                  <span>MikroTik agent</span>
                  <span className="text-ok">Online</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
      <div className="landing-float pointer-events-none absolute -top-3 -right-2 hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-card sm:flex sm:items-center sm:gap-2">
        <Wallet className="size-4 text-accent" />
        <span className="text-xs text-muted">M-Pesa → invoice</span>
      </div>
      <div className="landing-float-slow pointer-events-none absolute right-6 -bottom-4 hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-card md:flex md:items-center md:gap-2">
        <Radio className="size-4 text-accent" />
        <span className="text-xs text-muted">PPPoE session</span>
      </div>
      <div className="landing-float pointer-events-none absolute top-1/3 -left-3 hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-card lg:flex lg:items-center lg:gap-2">
        <Router className="size-4 text-accent" />
        <span className="text-xs text-muted">MikroTik over WireGuard</span>
      </div>
      <div className="landing-float-slow pointer-events-none absolute bottom-10 left-8 hidden rounded-lg border border-border bg-surface px-3 py-2 shadow-card sm:flex sm:items-center sm:gap-2">
        <Wifi className="size-4 text-accent" />
        <span className="text-xs text-muted">Hotspot and PPPoE</span>
      </div>
    </div>
  );
}

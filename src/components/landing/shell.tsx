import { Link } from "@tanstack/react-router";
import { Activity, Menu, Monitor, Moon, Sun, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { useTheme } from "@/components/theme-provider";
import { buttonVariants } from "@/components/ui/button";
import { SignedIn } from "@/lib/auth/gates";
import { APP_NAME } from "@/lib/brand";
import {
  paintSiteAppearance,
  readSiteAppearance,
  resolveSiteAppearance,
  systemPrefersDark,
  writeSiteAppearance,
  type SiteAppearance,
} from "@/lib/isp/site-appearance";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#solutions", label: "Solutions" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/#contact", label: "Contact" },
];

function AppearanceToggle() {
  const [mode, setMode] = useState<SiteAppearance>("system");

  useEffect(() => {
    setMode(readSiteAppearance());
  }, []);

  useEffect(() => {
    if (mode !== "system") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => paintSiteAppearance("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [mode]);

  function choose(next: SiteAppearance) {
    writeSiteAppearance(next);
    paintSiteAppearance(next);
    setMode(next);
  }

  const resolved = resolveSiteAppearance(mode, systemPrefersDark());
  const options: { id: SiteAppearance; label: string; icon: typeof Sun }[] = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ];

  return (
    <div
      className="inline-flex h-11 items-center rounded-md border border-border bg-surface p-1"
      role="group"
      aria-label="Appearance"
    >
      {options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          title={opt.label}
          aria-pressed={mode === opt.id}
          onClick={() => choose(opt.id)}
          className={cn(
            "grid size-9 place-items-center rounded-sm text-muted transition-colors duration-150 hover:text-fg",
            mode === opt.id && "bg-elevated text-fg",
            opt.id === resolved && mode === "system" ? "" : "",
          )}
        >
          <opt.icon className="size-4" />
          <span className="sr-only">{opt.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PublicShell({
  children,
  current,
}: {
  children: ReactNode;
  current?: "home" | "about" | "privacy" | "terms" | "aup";
}) {
  const { apply } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apply(null);
    paintSiteAppearance();
  }, [apply]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-fg"
      >
        Skip to content
      </a>
      <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4">
          <Link to="/" className="flex min-h-11 items-center gap-2">
            <BrandMark name={APP_NAME} size={32} />
            <span className="text-sm font-semibold tracking-tight">{APP_NAME}</span>
          </Link>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="inline-flex h-11 items-center px-3 text-sm text-muted transition-colors duration-150 hover:text-fg"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 lg:flex">
            <AppearanceToggle />
            <a
              href="/login?next=/platform"
              className="inline-flex h-11 items-center px-2 text-xs text-subtle hover:text-muted"
            >
              Superadmin
            </a>
            <Link to="/login" className={cn(buttonVariants({ variant: "ghost", size: "md" }))}>
              ISP login
            </Link>
            <a href="/login?mode=up" className={cn(buttonVariants({ size: "md" }))}>
              Get started
            </a>
            <SignedIn>
              <Link to="/app" className={cn(buttonVariants({ variant: "secondary", size: "md" }))}>
                Open console
              </Link>
            </SignedIn>
          </div>
          <button
            type="button"
            className="grid size-11 place-items-center rounded-md border border-border lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
            <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
          </button>
        </div>
        {open ? (
          <div id="mobile-nav" className="border-t border-border bg-bg px-4 py-4 lg:hidden">
            <nav className="grid gap-1" aria-label="Mobile">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="flex h-11 items-center rounded-md px-3 text-sm hover:bg-elevated"
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-4 flex items-center justify-between gap-3">
              <AppearanceToggle />
              <a href="/login?next=/platform" className="text-xs text-subtle">
                Superadmin login
              </a>
            </div>
            <div className="mt-4 grid gap-2">
              <Link to="/login" className={cn(buttonVariants({ variant: "secondary", size: "md" }), "w-full")}>
                ISP login
              </Link>
              <a href="/login?mode=up" className={cn(buttonVariants({ size: "md" }), "w-full")}>
                Get started
              </a>
              <SignedIn>
                <Link to="/app" className={cn(buttonVariants({ variant: "ghost", size: "md" }), "w-full")}>
                  Open console
                </Link>
              </SignedIn>
            </div>
          </div>
        ) : null}
      </header>
      <main id="main">{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 lg:grid-cols-5">
          <div className="sm:col-span-2 lg:col-span-1">
            <div className="flex items-center gap-2">
              <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
                <Activity className="size-4" />
              </span>
              <span className="font-semibold tracking-tight">{APP_NAME}</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
              Operations software for ISPs: customers, invoices, M-Pesa, and access control beside the network you
              already run.
            </p>
          </div>
          <FooterCol
            title="Product"
            links={[
              { href: "/#features", label: "Features" },
              { href: "/#pricing", label: "Pricing" },
              { href: "/#solutions", label: "Solutions" },
              { href: "/#faq", label: "FAQ" },
            ]}
          />
          <FooterCol
            title="Operations"
            links={[
              { href: "/#features", label: "Customers" },
              { href: "/#payments", label: "Billing and M-Pesa" },
              { href: "/#architecture", label: "Network and RADIUS" },
              { href: "/#messaging", label: "SMS and WhatsApp" },
              { href: "/#features", label: "Reports" },
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              { href: "/about", label: "About", active: current === "about" },
              { href: "/#contact", label: "Contact" },
              { href: "/#contact", label: "Support" },
            ]}
          />
          <FooterCol
            title="Account"
            links={[
              { href: "/login", label: "ISP login" },
              { href: "/login?mode=up", label: "Get started" },
              { href: "/login?next=/platform", label: "Superadmin login" },
            ]}
          />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-3 border-t border-border px-4 py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>
            © {new Date().getFullYear()} {APP_NAME}
          </p>
          <div className="flex flex-wrap gap-4">
            <a href="/privacy" className={cn("hover:text-muted", current === "privacy" && "text-fg")}>
              Privacy Policy
            </a>
            <a href="/terms" className={cn("hover:text-muted", current === "terms" && "text-fg")}>
              Terms of Service
            </a>
            <a href="/acceptable-use" className={cn("hover:text-muted", current === "aup" && "text-fg")}>
              Acceptable Use
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string; active?: boolean }[];
}) {
  return (
    <div>
      <p className="text-xs font-medium tracking-[0.16em] text-subtle uppercase">{title}</p>
      <ul className="mt-3 grid gap-2 text-sm">
        {links.map((l) => (
          <li key={`${l.href}-${l.label}`}>
            <a href={l.href} className={cn("text-muted hover:text-fg", l.active && "text-fg")}>
              {l.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { CreditCard, FileText, LayoutDashboard, LogOut, Menu, Ticket, User, Wallet, Wifi } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type PortalNavSession = { token: string; slug: string; name: string; isp: string; logo?: string | null };

const PRIMARY = [
  { to: "/portal", label: "Dashboard", short: "Home", icon: LayoutDashboard },
  { to: "/portal/services", label: "My Services", short: "Services", icon: Wifi },
  { to: "/portal/pay", label: "Pay Now", short: "Pay", icon: CreditCard },
  { to: "/portal/invoices", label: "Invoices", short: "Invoices", icon: FileText },
] as const;

const MORE = [
  { to: "/portal/payments", label: "Payments", icon: Wallet },
  { to: "/portal/tickets", label: "Support Tickets", icon: Ticket },
  { to: "/portal/profile", label: "Profile / Security", icon: User },
] as const;

const DESKTOP = [...PRIMARY, ...MORE];

function pathActive(pathname: string, to: string) {
  if (to === "/portal") return pathname === "/portal" || pathname === "/portal/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function PortalShell({
  session,
  onSignOut,
  children,
}: {
  session: PortalNavSession;
  onSignOut: () => void;
  children?: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [more, setMore] = useState(false);
  const moreActive = MORE.some((item) => pathActive(pathname, item.to));

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b border-border bg-header/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <BrandMark name={session.isp} logo={session.logo ?? undefined} size={20} />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{session.isp}</p>
              <p className="truncate text-xs text-muted">{session.name}</p>
            </div>
          </div>
          <nav className="hidden items-center gap-0.5 overflow-x-auto lg:flex">
            {DESKTOP.map((item) => (
              <Link
                key={item.to}
                to={item.to as never}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted transition-colors duration-150 hover:bg-elevated hover:text-fg",
                  pathActive(pathname, item.to) && "bg-elevated text-fg",
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Button variant="ghost" size="sm" onClick={onSignOut} className="hidden md:inline-flex">
            <LogOut className="size-4" />
            Log out
          </Button>
        </div>
        <nav className="hidden border-t border-border md:block lg:hidden">
          <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 py-1">
            {DESKTOP.map((item) => (
              <Link
                key={item.to}
                to={item.to as never}
                className={cn(
                  "shrink-0 rounded-md px-2.5 py-1.5 text-sm text-muted",
                  pathActive(pathname, item.to) && "bg-elevated text-fg",
                )}
              >
                {item.label}
              </Link>
            ))}
          </div>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-4 pb-24 pt-5 md:pb-10">{children ?? <Outlet />}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-header/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="mx-auto grid max-w-3xl grid-cols-5">
          {PRIMARY.map((item) => {
            const active = pathActive(pathname, item.to);
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to as never}
                  className={cn(
                    "flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-muted",
                    active && "text-accent",
                  )}
                >
                  <Icon className="size-5" />
                  {item.short}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMore(true)}
              className={cn(
                "flex min-h-14 w-full flex-col items-center justify-center gap-0.5 text-xs text-muted",
                moreActive && "text-accent",
              )}
            >
              <Menu className="size-5" />
              More
            </button>
          </li>
        </ul>
      </nav>
      <Dialog open={more} onOpenChange={setMore} title="Account" description="Payments, support and security" placement="drawer">
        <ul className="space-y-1">
          {MORE.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to}>
                <Link
                  to={item.to as never}
                  onClick={() => setMore(false)}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-md px-3 text-sm hover:bg-elevated",
                    pathActive(pathname, item.to) && "bg-elevated",
                  )}
                >
                  <Icon className="size-4 text-muted" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => {
                setMore(false);
                onSignOut();
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-sm text-muted hover:bg-elevated hover:text-fg"
            >
              <LogOut className="size-4" />
              Log out
            </button>
          </li>
        </ul>
      </Dialog>
    </div>
  );
}

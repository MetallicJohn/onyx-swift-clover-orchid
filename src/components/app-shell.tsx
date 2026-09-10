import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Bell,
  Boxes,
  CreditCard,
  Handshake,
  LayoutDashboard,
  Menu,
  Radio,
  Router,
  Settings,
  Sparkles,
  Ticket,
  Upload,
  Users,
  Wifi,
  Wrench,
  X,
  Shield,
  Activity,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { UserButton } from "@/lib/auth/gates";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { APP_NAME } from "@/lib/brand";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/packages", label: "Packages", icon: Boxes },
  { to: "/app/services", label: "Services", icon: Wifi },
  { to: "/app/radius", label: "RADIUS", icon: Radio },
  { to: "/app/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/app/billing", label: "Billing", icon: CreditCard },
  { to: "/app/reports", label: "Reports", icon: BarChart3 },
  { to: "/app/statements", label: "Statements", icon: CreditCard },
  { to: "/app/notifications", label: "Notifications", icon: Bell },
  { to: "/app/routers", label: "Routers", icon: Router },
  { to: "/app/acs", label: "GenieACS", icon: Activity },
  { to: "/app/ai", label: "AI MikroTik", icon: Sparkles },
  { to: "/app/field", label: "Field", icon: Wrench },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/partners", label: "Partners", icon: Handshake },
  { to: "/app/import", label: "Import", icon: Upload },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const subscribeToNothing = () => () => {};

export function AppShell({
  tenantName,
  displayName,
  logo,
  role,
  tenants,
  activeTenantId,
  onSwitchTenant,
  platformAdmin,
}: {
  tenantName?: string;
  displayName?: string;
  logo?: string;
  role?: string;
  tenants?: { id: string; name: string }[];
  activeTenantId?: string;
  onSwitchTenant?: (id: string) => void;
  platformAdmin?: boolean;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const nav = platformAdmin ? [...NAV, { to: "/app/admin", label: "Superadmin", icon: Shield }] : NAV;
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    () => false,
  );
  const brand = displayName || tenantName || APP_NAME;

  const Nav = () => (
    <nav className="flex flex-col gap-0.5">
      {nav.map((item) => {
        const active = item.to === "/app" ? pathname === "/app" : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
              active ? "bg-accent/10 text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-accent")} strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar p-4 md:flex">
        <Link to="/app" className="mb-6 flex items-center gap-2 px-2">
          <BrandMark name={brand} logo={logo} size={32} />
          <div>
            <div className="max-w-36 truncate text-sm font-semibold tracking-tight">{brand}</div>
            <div className="max-w-36 truncate text-[11px] text-muted">{tenantName && tenantName !== brand ? tenantName : "ISP console"}</div>
          </div>
        </Link>
        {tenants && tenants.length > 1 && onSwitchTenant ? (
          <select
            className="mb-4 h-11 w-full rounded-md border border-border bg-bg px-2 text-sm"
            value={activeTenantId}
            onChange={(e) => onSwitchTenant(e.target.value)}
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        ) : null}
        <Nav />
        <div className="mt-auto border-t border-border pt-3 text-[11px] uppercase tracking-wider text-subtle">
          {role?.replace("_", " ")}
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-bg/70" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex h-full w-64 flex-col bg-sidebar p-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                <BrandMark name={brand} logo={logo} size={28} />
                <span className="truncate">{brand}</span>
              </span>
              <button className="grid size-11 place-items-center" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <Nav />
          </div>
        </div>
      ) : null}

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-header/90 px-4 backdrop-blur">
          <button className="grid size-11 place-items-center md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="hidden text-sm text-muted md:block">Operations</div>
          <div className="flex items-center gap-3">
            {gateSession ? (
              <Link to="/login" className="text-sm text-muted hover:text-fg">
                ISP login
              </Link>
            ) : null}
            <UserButton />
          </div>
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

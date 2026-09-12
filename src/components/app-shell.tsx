import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  BarChart3,
  Boxes,
  CreditCard,
  Handshake,
  Import,
  LayoutDashboard,
  Menu,
  Radio,
  Router,
  Settings,
  Sparkles,
  Ticket,
  Users,
  Wifi,
  Wrench,
  X,
  Shield,
  Activity,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { UserButton } from "@/lib/auth/gates";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { APP_NAME } from "@/lib/brand";
import { canAccessAppPath, ROLE_GUIDE } from "@/lib/isp/rbac";
import { endSaasSupport, getMyEntitlements } from "@/lib/isp/server-platform";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/packages", label: "Packages", icon: Boxes },
  { to: "/app/services", label: "Services", icon: Wifi },
  { to: "/app/radius", label: "RADIUS", icon: Radio },
  { to: "/app/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/app/billing", label: "Billing", icon: CreditCard },
  { to: "/app/reports", label: "Insights", icon: BarChart3 },
  { to: "/app/statements", label: "Statements", icon: CreditCard },
  { to: "/app/routers", label: "Routers", icon: Router },
  { to: "/app/acs", label: "GenieACS", icon: Activity },
  { to: "/app/ai", label: "AI MikroTik", icon: Sparkles },
  { to: "/app/field", label: "Field", icon: Wrench },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/partners", label: "Partners", icon: Handshake },
  { to: "/app/import", label: "Import", icon: Import },
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
  tenantStatus,
  supportMode,
  supportReason,
}: {
  tenantName?: string;
  displayName?: string;
  logo?: string;
  role?: string;
  tenants?: { id: string; name: string }[];
  activeTenantId?: string;
  onSwitchTenant?: (id: string) => void;
  platformAdmin?: boolean;
  tenantStatus?: string;
  supportMode?: boolean;
  supportReason?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    getMyEntitlements()
      .then((r) => setFeatures(r.features))
      .catch(() => setFeatures({}));
  }, []);
  const featureNav: Record<string, string> = {
    "/app/hotspot": "hotspot",
    "/app/radius": "radius",
    "/app/acs": "genieacs",
    "/app/ai": "ai_assistant",
    "/app/field": "technician",
    "/app/partners": "reseller",
    "/app/reports": "reports",
  };
  const visible = NAV.filter((item) => {
    const feat = featureNav[item.to];
    if (feat && Object.keys(features).length > 0 && !features[feat]) return false;
    return canAccessAppPath(role, item.to);
  });
  const nav = visible;
  const allowed = canAccessAppPath(role, pathname);
  const roleLabel = ROLE_GUIDE.find((row) => row.role === role)?.label || role?.replaceAll("_", " ");
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
        <div className="mt-auto space-y-2 border-t border-border pt-3">
          {platformAdmin ? (
            <Link
              to="/platform"
              className="flex h-11 items-center gap-2 rounded-md px-3 text-sm text-muted hover:bg-elevated/60 hover:text-fg"
            >
              <Shield className="size-4" />
              SaaS Management
            </Link>
          ) : null}
          <div className="px-3 text-[11px] uppercase tracking-wider text-subtle">{roleLabel}</div>
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
        {supportMode ? (
          <div className="flex flex-col gap-2 border-b border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn sm:flex-row sm:items-center sm:justify-between">
            <span>
              Support mode — you are {APP_NAME} staff in this ISP. {supportReason ? `Reason: ${supportReason}` : ""}
            </span>
            <button
              className="h-11 shrink-0 text-sm font-medium underline"
              disabled={leaving}
              onClick={async () => {
                setLeaving(true);
                try {
                  await endSaasSupport();
                  window.location.href = "/platform";
                } finally {
                  setLeaving(false);
                }
              }}
            >
              {leaving ? "Exiting…" : "Exit support"}
            </button>
          </div>
        ) : null}
        {tenantStatus === "suspended" && !supportMode ? (
          <div className="border-b border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            This ISP is suspended. Billing and network changes are locked until {APP_NAME} reactivates the workspace.
          </div>
        ) : null}
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
          {allowed ? (
            <Outlet />
          ) : (
            <div className="max-w-lg rounded-xl border border-border bg-surface p-6">
              <h1 className="text-lg font-medium">You don’t have access</h1>
              <p className="mt-2 text-sm text-muted">
                This page is limited to another role. Use the menu, or go back to Overview.
              </p>
              <Link
                to="/app"
                className="mt-4 inline-flex h-11 items-center text-sm font-medium text-accent hover:underline"
              >
                Back to overview
              </Link>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

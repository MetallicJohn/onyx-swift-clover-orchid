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
  Trash2,
  Users,
  Wifi,
  Wrench,
  X,
  Shield,
  Activity,
} from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { SidebarCollapseButton, SidebarNav, useSidebarCollapsed, type SidebarNavItem } from "@/components/sidebar-nav";
import { UserButton } from "@/lib/auth/gates";
import { hasGateSessionMarker } from "@/lib/auth/gate-session-marker";
import { APP_NAME } from "@/lib/brand";
import { canAccessAppPath, ROLE_GUIDE } from "@/lib/isp/rbac";
import { endSaasSupport, getMyEntitlements } from "@/lib/isp/server-platform";

const NAV: SidebarNavItem[] = [
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
  { to: "/app/acs", label: "Devices", icon: Activity },
  { to: "/app/ai", label: "AI MikroTik", icon: Sparkles },
  { to: "/app/field", label: "Field", icon: Wrench },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/partners", label: "Partners", icon: Handshake },
  { to: "/app/import", label: "Import", icon: Import },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

const RECYCLE_BIN: SidebarNavItem = { to: "/app/recycle-bin", label: "Recycle Bin", icon: Trash2 };

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
  accountEmail,
  accountStatus,
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
  accountEmail?: string;
  accountStatus?: string;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const { collapsed, toggle } = useSidebarCollapsed();
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
  const allowed = canAccessAppPath(role, pathname);
  const showRecycleBin = canAccessAppPath(role, RECYCLE_BIN.to);
  const roleLabel = ROLE_GUIDE.find((row) => row.role === role)?.label || role?.replaceAll("_", " ");
  const accountLabel = accountStatus
    ? accountStatus === "ACTIVE"
      ? "Active"
      : accountStatus.replaceAll("_", " ").toLowerCase()
    : "";
  const gateSession = useSyncExternalStore(
    subscribeToNothing,
    hasGateSessionMarker,
    () => false,
  );
  const brand = displayName || tenantName || APP_NAME;

  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : "false"}>
      <aside className="app-nav">
        <Link to="/app" className="app-nav-brand">
          <BrandMark name={brand} logo={logo} size={28} />
          <span className="app-nav-copy">
            <span className="app-nav-copy-title">{brand}</span>
            <span className="app-nav-copy-sub">{tenantName && tenantName !== brand ? tenantName : "ISP console"}</span>
          </span>
        </Link>
        {tenants && tenants.length > 1 && onSwitchTenant ? (
          <div className="app-nav-switcher">
            <select value={activeTenantId} onChange={(e) => onSwitchTenant(e.target.value)} aria-label="Switch ISP">
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="app-nav-scroll">
          <SidebarNav items={visible} pathname={pathname} root="/app" collapsed={collapsed} />
        </div>
        <div className="app-nav-foot">
          {showRecycleBin ? <SidebarNav items={[RECYCLE_BIN]} pathname={pathname} root="/app" collapsed={collapsed} /> : null}
          {platformAdmin ? (
            <Link
              to="/platform"
              preload={false}
              title={collapsed ? "SaaS Management" : undefined}
              className="app-nav-item"
            >
              <Shield className="size-4" />
              <span className="app-nav-label">SaaS Management</span>
            </Link>
          ) : null}
          {roleLabel ? <div className="app-nav-kicker">{roleLabel}</div> : null}
        </div>
        <SidebarCollapseButton collapsed={collapsed} onToggle={toggle} />
      </aside>

      {open ? (
        <div className="app-nav-overlay">
          <button className="app-nav-overlay-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="app-nav-drawer">
            <div className="app-nav-drawer-head">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                <BrandMark name={brand} logo={logo} size={28} />
                <span className="truncate">{brand}</span>
              </span>
              <button className="grid size-11 place-items-center" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <div className="app-nav-scroll">
              <SidebarNav items={visible} pathname={pathname} root="/app" onNavigate={() => setOpen(false)} />
            </div>
            {showRecycleBin ? (
              <div className="app-nav-foot">
                <SidebarNav items={[RECYCLE_BIN]} pathname={pathname} root="/app" onNavigate={() => setOpen(false)} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="app-shell-body">
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
        <header className="app-topbar">
          <button className="app-topbar-menu" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="app-topbar-title">Operations</div>
          <div className="flex min-w-0 items-center gap-3">
            {accountEmail ? (
              <span className="hidden min-w-0 truncate text-xs text-muted md:inline">
                {accountEmail}
                {roleLabel ? ` · ${roleLabel}` : ""}
                {accountLabel ? ` · ${accountLabel}` : ""}
              </span>
            ) : null}
            {gateSession ? (
              <Link to="/login" className="text-sm text-muted transition-colors duration-150 hover:text-fg">
                ISP login
              </Link>
            ) : null}
            <Link to="/app/profile" className="text-sm text-muted transition-colors duration-150 hover:text-fg">
              Profile
            </Link>
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

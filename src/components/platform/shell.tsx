import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  Building2,
  CreditCard,
  Globe,
  LayoutDashboard,
  Menu,
  Radio,
  Search,
  Server,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/isp/brand-mark";
import { SidebarCollapseButton, SidebarNav, useSidebarCollapsed, type SidebarNavItem } from "@/components/sidebar-nav";
import { UserButton } from "@/lib/auth/gates";
import { APP_NAME } from "@/lib/brand";
import { searchSaas } from "@/lib/isp/server-platform";

const NAV: SidebarNavItem[] = [
  { to: "/platform", label: "Dashboard", icon: LayoutDashboard },
  { to: "/platform/tenants", label: "Tenants", icon: Building2 },
  { to: "/platform/plans", label: "Subscription Plans", icon: CreditCard },
  { to: "/platform/subscriptions", label: "Subscriptions", icon: Radio },
  { to: "/platform/revenue", label: "Revenue", icon: BarChart3 },
  { to: "/platform/infrastructure", label: "Infrastructure", icon: Server },
  { to: "/platform/domains", label: "Domains", icon: Globe },
  { to: "/platform/reports", label: "Insights", icon: BarChart3 },
  { to: "/platform/activity", label: "Platform Activity", icon: Activity },
  { to: "/platform/users", label: "Users", icon: Users },
  { to: "/platform/settings/sms", label: "SMS Gateway", icon: Radio },
  { to: "/platform/settings", label: "System Settings", icon: Settings },
];

type Hit = {
  tenants: { id: string; name: string; slug: string; status: string }[];
  plans: { code: string; name: string; status: string }[];
  operators: { user_id: string; name: string; email: string; role: string; tenant_id: string; tenant_name: string }[];
  nodes: { id: string; name: string; tenant_id: string; tenant_name: string }[];
};

export function PlatformShell({ email, defaultPassword = false }: { email?: string; defaultPassword?: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const { collapsed, toggle } = useSidebarCollapsed();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit | null>(null);
  const [hideDefaultPassword, setHideDefaultPassword] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      if (q.trim().length < 2) {
        setHits(null);
        return;
      }
      searchSaas({ data: { q } })
        .then(setHits)
        .catch(() => setHits(null));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q]);

  return (
    <div className="app-shell" data-collapsed={collapsed ? "true" : "false"}>
      <aside className="app-nav">
        <Link to="/platform" className="app-nav-brand">
          <BrandMark name={APP_NAME} size={28} />
          <span className="app-nav-copy">
            <span className="app-nav-copy-title">{APP_NAME}</span>
            <span className="app-nav-copy-sub">SaaS Management</span>
          </span>
        </Link>
        <div className="app-nav-scroll">
          <SidebarNav items={NAV} pathname={pathname} root="/platform" collapsed={collapsed} />
        </div>
        <div className="app-nav-foot">
          <Link to="/app" preload={false} title={collapsed ? "ISP console" : undefined} className="app-nav-item">
            <Shield className="size-4" />
            <span className="app-nav-label">ISP console</span>
          </Link>
          <div className="app-nav-kicker">{email || "superadmin"}</div>
        </div>
        <SidebarCollapseButton collapsed={collapsed} onToggle={toggle} />
      </aside>

      {open ? (
        <div className="app-nav-overlay">
          <button className="app-nav-overlay-scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="app-nav-drawer">
            <div className="app-nav-drawer-head">
              <span className="font-semibold">{APP_NAME}</span>
              <button className="grid size-11 place-items-center" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav items={NAV} pathname={pathname} root="/platform" onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}

      <div className="app-shell-body">
        {defaultPassword && !hideDefaultPassword ? (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            <div>
              <p className="font-semibold">Security Warning</p>
              <p>You are using Default Password, Change Immediately</p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Link to="/app/profile/security" className="font-medium text-danger underline hover:no-underline">
                Change Password
              </Link>
              <button type="button" className="text-muted hover:text-fg" onClick={() => setHideDefaultPassword(true)}>
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        <header className="app-topbar">
          <button className="app-topbar-menu" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search ISPs, plans, operators, nodes"
              className="h-11 w-full rounded-md border border-border bg-bg pl-9 pr-3 text-sm"
            />
            {hits ? (
              <div className="absolute left-0 right-0 top-12 z-30 overflow-hidden rounded-xl border border-border bg-surface shadow-card">
                <SearchGroup
                  title="Tenants"
                  empty={hits.tenants.length === 0}
                  items={hits.tenants.map((t) => ({
                    key: t.id,
                    label: t.name,
                    hint: t.slug,
                    onClick: () => {
                      setQ("");
                      setHits(null);
                      void navigate({ to: "/platform/tenants/$tenantId", params: { tenantId: t.id } });
                    },
                  }))}
                />
                <SearchGroup
                  title="Plans"
                  empty={hits.plans.length === 0}
                  items={hits.plans.map((p) => ({
                    key: p.code,
                    label: p.name,
                    hint: p.code,
                    onClick: () => {
                      setQ("");
                      setHits(null);
                      void navigate({ to: "/platform/plans" });
                    },
                  }))}
                />
                <SearchGroup
                  title="Operators"
                  empty={hits.operators.length === 0}
                  items={hits.operators.map((o) => ({
                    key: o.user_id + o.tenant_id,
                    label: o.email,
                    hint: o.tenant_name,
                    onClick: () => {
                      setQ("");
                      setHits(null);
                      void navigate({ to: "/platform/tenants/$tenantId", params: { tenantId: o.tenant_id } });
                    },
                  }))}
                />
                <SearchGroup
                  title="Nodes"
                  empty={hits.nodes.length === 0}
                  items={hits.nodes.map((n) => ({
                    key: n.id,
                    label: n.name,
                    hint: n.tenant_name,
                    onClick: () => {
                      setQ("");
                      setHits(null);
                      void navigate({ to: "/platform/infrastructure" });
                    },
                  }))}
                />
              </div>
            ) : null}
          </div>
          <UserButton />
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function SearchGroup({
  title,
  empty,
  items,
}: {
  title: string;
  empty: boolean;
  items: { key: string; label: string; hint: string; onClick: () => void }[];
}) {
  if (empty && items.length === 0) return null;
  return (
    <div className="border-b border-border last:border-0">
      <div className="px-3 py-2 text-xs uppercase tracking-wider text-subtle">{title}</div>
      {items.length === 0 ? <div className="px-3 pb-2 text-xs text-muted">No matches</div> : null}
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm hover:bg-elevated"
          onClick={item.onClick}
        >
          <span className="truncate">{item.label}</span>
          <span className="ml-3 truncate text-xs text-muted">{item.hint}</span>
        </button>
      ))}
    </div>
  );
}

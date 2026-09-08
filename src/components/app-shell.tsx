import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  Bell,
  Boxes,
  CreditCard,
  Handshake,
  LayoutDashboard,
  Menu,
  Radio,
  Router,
  Settings,
  Ticket,
  Upload,
  Users,
  Wifi,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { UserButton } from "@/lib/auth/gates";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/app", label: "Overview", icon: LayoutDashboard },
  { to: "/app/customers", label: "Customers", icon: Users },
  { to: "/app/packages", label: "Packages", icon: Boxes },
  { to: "/app/services", label: "Services", icon: Wifi },
  { to: "/app/radius", label: "RADIUS", icon: Radio },
  { to: "/app/hotspot", label: "Hotspot", icon: Wifi },
  { to: "/app/billing", label: "Billing", icon: CreditCard },
  { to: "/app/notifications", label: "Notifications", icon: Bell },
  { to: "/app/routers", label: "Routers", icon: Router },
  { to: "/app/acs", label: "GenieACS", icon: Activity },
  { to: "/app/field", label: "Field", icon: Wrench },
  { to: "/app/tickets", label: "Tickets", icon: Ticket },
  { to: "/app/partners", label: "Partners", icon: Handshake },
  { to: "/app/import", label: "Import", icon: Upload },
  { to: "/app/settings", label: "Settings", icon: Settings },
];

export function AppShell({ tenantName, role }: { tenantName?: string; role?: string }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);

  const Nav = () => (
    <nav className="flex flex-col gap-0.5">
      {NAV.map((item) => {
        const active = item.to === "/app" ? pathname === "/app" : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            onClick={() => setOpen(false)}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-colors",
              active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated/60 hover:text-fg",
            )}
          >
            <Icon className="size-4 shrink-0" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-bg text-fg">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-surface p-4 md:flex">
        <Link to="/app" className="mb-6 flex items-center gap-2 px-2">
          <span className="grid size-8 place-items-center rounded-md bg-accent text-accent-fg">
            <Activity className="size-4" />
          </span>
          <div>
            <div className="text-sm font-semibold tracking-tight">Gridline</div>
            <div className="max-w-36 truncate text-[11px] text-muted">{tenantName ?? "ISP console"}</div>
          </div>
        </Link>
        <Nav />
        <div className="mt-auto border-t border-border pt-3 text-[11px] uppercase tracking-wider text-subtle">
          {role?.replace("_", " ")}
        </div>
      </aside>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button className="absolute inset-0 bg-bg/70" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="relative z-10 flex h-full w-64 flex-col bg-surface p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="font-semibold">Gridline</span>
              <button className="grid size-11 place-items-center" onClick={() => setOpen(false)} aria-label="Close">
                <X className="size-5" />
              </button>
            </div>
            <Nav />
          </div>
        </div>
      ) : null}

      <div className="md:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border bg-bg/90 px-4 backdrop-blur">
          <button className="grid size-11 place-items-center md:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu className="size-5" />
          </button>
          <div className="hidden text-sm text-muted md:block">Operations</div>
          <UserButton />
        </header>
        <main className="p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

import { Link, useRouterState } from "@tanstack/react-router";
import { CreditCard, LayoutDashboard, Menu, Router, Users } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const items = [
    { to: "/app" as const, label: "Home", icon: LayoutDashboard, exact: true },
    { to: "/app/customers" as const, label: "Customers", icon: Users, exact: false },
    { to: "/app/routers" as const, label: "Network", icon: Router, exact: false },
    { to: "/app/billing" as const, label: "Billing", icon: CreditCard, exact: false },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-border bg-surface md:hidden" aria-label="Mobile">
      {items.map((item) => {
        const active = item.exact ? pathname === item.to : pathname.startsWith(item.to);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            aria-current={active ? "page" : undefined}
            className={cn("flex h-16 flex-col items-center justify-center gap-0.5 text-[11px]", active ? "text-accent" : "text-muted")}
          >
            <Icon className="size-5" strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
      <button type="button" className="flex h-16 flex-col items-center justify-center gap-0.5 text-[11px] text-muted" onClick={onMore}>
        <Menu className="size-5" strokeWidth={1.75} />
        More
      </button>
    </nav>
  );
}

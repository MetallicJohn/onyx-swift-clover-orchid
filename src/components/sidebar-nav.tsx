import { Link } from "@tanstack/react-router";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SidebarNavItem = { to: string; label: string; icon: LucideIcon };

function navActive(pathname: string, to: string, root: string) {
  return to === root ? pathname === root : pathname.startsWith(to);
}

export function SidebarNav({
  items,
  pathname,
  root,
  onNavigate,
}: {
  items: SidebarNavItem[];
  pathname: string;
  root: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = navActive(pathname, item.to, root);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            preload={false}
            activeProps={{ className: undefined }}
            activeOptions={{ exact: item.to === root, includeSearch: false }}
            onClick={onNavigate}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm transition-[background-color,color] duration-150",
              active ? "bg-elevated text-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
          >
            <Icon className={cn("size-4 shrink-0", active && "text-accent")} strokeWidth={1.75} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

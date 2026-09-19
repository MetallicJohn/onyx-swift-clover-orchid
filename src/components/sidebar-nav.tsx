import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export type SidebarNavItem = { to: string; label: string; icon: LucideIcon };

const COLLAPSE_KEY = "isp-sidebar-collapsed";

export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* private mode */
    }
  }, []);
  function toggle() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }
  return { collapsed, toggle };
}

function navActive(pathname: string, to: string, root: string) {
  return to === root ? pathname === root : pathname.startsWith(to);
}

export function SidebarNav({
  items,
  pathname,
  root,
  onNavigate,
  collapsed = false,
}: {
  items: SidebarNavItem[];
  pathname: string;
  root: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  return (
    <nav className="app-nav-list">
      {items.map((item) => {
        const active = navActive(pathname, item.to, root);
        const Icon = item.icon;
        return (
          <Link
            key={item.to}
            to={item.to}
            preload={false}
            title={collapsed ? item.label : undefined}
            data-active={active ? "true" : undefined}
            activeProps={{ className: undefined }}
            activeOptions={{ exact: item.to === root, includeSearch: false }}
            onClick={onNavigate}
            className="app-nav-item"
          >
            <Icon className="size-4" strokeWidth={1.75} />
            <span className="app-nav-label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarCollapseButton({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      aria-label={collapsed ? "Expand menu" : "Collapse menu"}
      title={collapsed ? "Expand menu" : "Collapse menu"}
      className="app-nav-handle"
    >
      <span className="app-nav-handle-icons">
        <span className="app-nav-handle-icon" data-shown={collapsed ? "false" : "true"}>
          <PanelLeftClose className="size-4" strokeWidth={1.75} />
        </span>
        <span className="app-nav-handle-icon" data-shown={collapsed ? "true" : "false"}>
          <PanelLeftOpen className="size-4" strokeWidth={1.75} />
        </span>
      </span>
    </button>
  );
}

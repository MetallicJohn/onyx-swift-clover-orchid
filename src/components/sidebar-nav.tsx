import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

export type SidebarNavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  children?: { to: string; label: string }[];
};

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
  label,
}: {
  items: SidebarNavItem[];
  pathname: string;
  root: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  label?: string;
}) {
  if (!items.length) return null;
  return (
    <div className="mb-3">
      {label && !collapsed ? (
        <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-subtle uppercase">{label}</p>
      ) : null}
      <nav className="app-nav-list" aria-label={label || "Primary"}>
        {items.map((item) => {
          const active = navActive(pathname, item.to, root) && !(item.children || []).some((child) => navActive(pathname, child.to, root) && child.to !== item.to);
          const Icon = item.icon;
          return (
            <div key={item.to}>
              <Link
                to={item.to}
                preload={false}
                title={collapsed ? item.label : undefined}
                aria-current={active ? "page" : undefined}
                data-active={active ? "true" : undefined}
                activeProps={{ className: undefined }}
                activeOptions={{ exact: item.to === root, includeSearch: false }}
                onClick={onNavigate}
                className="app-nav-item"
              >
                <Icon className="size-4" strokeWidth={1.75} />
                <span className="app-nav-label">{item.label}</span>
              </Link>
              {!collapsed && item.children && item.children.length > 1 ? (
                <div className="ml-4 border-l border-border">
                  {item.children.map((child) => {
                    const childActive = navActive(pathname, child.to, root);
                    return (
                      <Link
                        key={child.to}
                        to={child.to}
                        preload={false}
                        aria-current={childActive ? "page" : undefined}
                        data-active={childActive ? "true" : undefined}
                        activeProps={{ className: undefined }}
                        activeOptions={{ exact: child.to === root, includeSearch: false }}
                        onClick={onNavigate}
                        className="app-nav-item pl-4"
                      >
                        <span className="app-nav-label">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>
    </div>
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

import { Link } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Filter, MoreHorizontal, Search, X } from "lucide-react";
import type { ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Select } from "@/components/ui/input";
import { formatDateTime } from "@/lib/isp/display";
import {
  activeRouterFilterCount,
  type RouterDeskCounters,
  type RouterDeskFilters,
  type RouterDeskRow,
  type RouterDeskStatus,
} from "@/lib/isp/router-desk-format";
import { cn } from "@/lib/utils";

export type RouterPerms = {
  canManage: boolean;
  canMonitor: boolean;
};

export type RouterActions = {
  onDetails: (r: RouterDeskRow) => void;
  onEdit: (r: RouterDeskRow) => void;
  onTest: (r: RouterDeskRow) => void;
  onSync: (r: RouterDeskRow) => void;
  onPools: (r: RouterDeskRow) => void;
  onMonitor: (r: RouterDeskRow) => void;
  onToggleEnabled: (r: RouterDeskRow) => void;
  onArchive: (r: RouterDeskRow) => void;
};

export function RouterSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="relative block min-w-0 flex-1">
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, identity, IP, site, or model"
        className="h-11 pl-9"
        aria-label="Search routers"
      />
    </label>
  );
}

export function RouterFilterBar({
  filters,
  locations,
  vendors,
  onChange,
  onClear,
}: {
  filters: RouterDeskFilters;
  locations: string[];
  vendors: string[];
  onChange: (patch: Partial<RouterDeskFilters>) => void;
  onClear: () => void;
}) {
  const n = activeRouterFilterCount(filters);
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="grid gap-1 text-xs text-muted">
        Status
        <Select
          className="h-9 w-40"
          value={filters.status}
          onChange={(e) => onChange({ status: e.target.value as RouterDeskStatus, page: 1 })}
        >
          <option value="all">All</option>
          <option value="online">Online</option>
          <option value="offline">Offline</option>
          <option value="awaiting">Awaiting bootstrap</option>
          <option value="disabled">Disabled</option>
          <option value="archived">Archived</option>
        </Select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Site
        <Select
          className="h-9 w-40"
          value={filters.location}
          onChange={(e) => onChange({ location: e.target.value, page: 1 })}
        >
          <option value="">All sites</option>
          {locations.map((loc) => (
            <option key={loc} value={loc}>
              {loc}
            </option>
          ))}
        </Select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Vendor / model
        <Select
          className="h-9 w-40"
          value={filters.vendor}
          onChange={(e) => onChange({ vendor: e.target.value, page: 1 })}
        >
          <option value="">All</option>
          {vendors.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.hasPools}
          onChange={(e) => onChange({ hasPools: e.target.checked, page: 1 })}
        />
        Has IP pools
      </label>
      <label className="flex h-9 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={filters.hasServices}
          onChange={(e) => onChange({ hasServices: e.target.checked, page: 1 })}
        />
        Has active services
      </label>
      {n ? (
        <Button type="button" size="sm" variant="ghost" onClick={onClear}>
          <X className="size-4" />
          Clear {n}
        </Button>
      ) : null}
    </div>
  );
}

export function RouterCounters({
  counters,
  status,
  onStatus,
}: {
  counters: RouterDeskCounters;
  status: RouterDeskStatus;
  onStatus: (s: RouterDeskStatus) => void;
}) {
  const items: { id: RouterDeskStatus; label: string; value: number }[] = [
    { id: "all", label: "Routers", value: counters.total },
    { id: "online", label: "Online", value: counters.online },
    { id: "awaiting", label: "Awaiting", value: counters.awaiting },
    { id: "disabled", label: "Disabled", value: counters.disabled },
  ];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onStatus(item.id)}
          className={cn(
            "rounded-xl border px-4 py-3 text-left",
            status === item.id ? "border-accent bg-accent/10" : "border-border bg-surface",
          )}
        >
          <div className="text-xs text-muted">{item.label}</div>
          <div className="text-xl font-semibold tracking-tight">{item.value}</div>
        </button>
      ))}
    </div>
  );
}

function StatusDot({ online, enabled }: { online: boolean; enabled: boolean }) {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        !enabled ? "bg-muted" : online ? "bg-ok" : "bg-warn",
      )}
      aria-hidden
    />
  );
}

export function RouterOverflowMenu({
  router: r,
  perms,
  actions,
}: {
  router: RouterDeskRow;
  perms: RouterPerms;
  actions: RouterActions;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "size-11")}
        aria-label={`Actions for ${r.name}`}
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{r.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => actions.onDetails(r)}>View details</DropdownMenuItem>
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onEdit(r)}>Edit router</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onTest(r)}>Test connection</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onSync(r)}>Synchronize</DropdownMenuItem> : null}
        <DropdownMenuItem onSelect={() => actions.onPools(r)}>View IP pools</DropdownMenuItem>
        {perms.canMonitor ? <DropdownMenuItem onSelect={() => actions.onMonitor(r)}>View monitoring</DropdownMenuItem> : null}
        {perms.canManage ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => actions.onToggleEnabled(r)}>
              {r.enabled ? "Disable router" : "Enable router"}
            </DropdownMenuItem>
            <DropdownMenuItem danger onSelect={() => actions.onArchive(r)}>
              Archive router
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RouterTable({
  rows,
  dateFormat,
  perms,
  actions,
  loading,
}: {
  rows: RouterDeskRow[];
  dateFormat: string;
  perms: RouterPerms;
  actions: RouterActions;
  loading: boolean;
}) {
  return (
    <div className="hidden overflow-x-auto rounded-xl border border-border md:block">
      <table className="w-full min-w-[52rem] text-left text-sm">
        <thead className="bg-surface text-xs text-muted">
          <tr>
            <th className="px-4 py-3 font-medium">Router</th>
            <th className="px-4 py-3 font-medium">Identity</th>
            <th className="px-4 py-3 font-medium">Management</th>
            <th className="px-4 py-3 font-medium">Model</th>
            <th className="px-4 py-3 font-medium">Status</th>
            <th className="px-4 py-3 font-medium">Last seen</th>
            <th className="px-4 py-3 font-medium">Site</th>
            <th className="px-4 py-3 font-medium">Pools</th>
            <th className="px-4 py-3 font-medium">Services</th>
            <th className="px-4 py-3 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {loading ? (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-sm text-muted">
                Loading routers…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={10} className="px-4 py-10 text-sm text-muted">
                No routers match. Add a MikroTik to generate a bootstrap script.
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="align-middle">
                <td className="px-4 py-3">
                  <Link to="/app/routers/$routerId" params={{ routerId: r.id }} className="inline-flex items-center gap-2 font-medium hover:underline">
                    <StatusDot online={Boolean(r.online)} enabled={r.enabled} />
                    {r.name}
                  </Link>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{r.identity || "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{r.management_ip || "—"}</td>
                <td className="px-4 py-3 text-xs">
                  {[r.vendor, r.model].filter(Boolean).join(" ") || "—"}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(r.enabled ? r.reachability : "disabled")}>
                    {r.enabled ? (r.reachability || "pending").replaceAll("_", " ") : "disabled"}
                  </Badge>
                </td>
                <td className="px-4 py-3 font-mono text-xs">{formatDateTime(r.last_seen, dateFormat)}</td>
                <td className="px-4 py-3 text-xs">{r.site_pop || r.location || "—"}</td>
                <td className="px-4 py-3 text-xs">{r.pool_count}</td>
                <td className="px-4 py-3 text-xs">{r.service_count}</td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1">
                    <Link
                      to="/app/routers/$routerId"
                      params={{ routerId: r.id }}
                      className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "inline-flex")}
                    >
                      Details
                    </Link>
                    <RouterOverflowMenu router={r} perms={perms} actions={actions} />
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function RouterCards({
  rows,
  dateFormat,
  perms,
  actions,
  loading,
}: {
  rows: RouterDeskRow[];
  dateFormat: string;
  perms: RouterPerms;
  actions: RouterActions;
  loading: boolean;
}) {
  if (loading) return <p className="text-sm text-muted md:hidden">Loading routers…</p>;
  if (!rows.length) {
    return <p className="text-sm text-muted md:hidden">No routers match.</p>;
  }
  return (
    <ul className="grid gap-3 md:hidden">
      {rows.map((r) => (
        <li key={r.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-2">
            <Link to="/app/routers/$routerId" params={{ routerId: r.id }} className="min-w-0">
              <div className="flex items-center gap-2 font-medium">
                <StatusDot online={Boolean(r.online)} enabled={r.enabled} />
                <span className="truncate">{r.name}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-muted">{r.identity}</div>
            </Link>
            <RouterOverflowMenu router={r} perms={perms} actions={actions} />
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div>
              <dt className="text-muted">Management</dt>
              <dd className="font-mono">{r.management_ip || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Site</dt>
              <dd>{r.site_pop || r.location || "—"}</dd>
            </div>
            <div>
              <dt className="text-muted">Status</dt>
              <dd>
                <Badge tone={statusTone(r.enabled ? r.reachability : "disabled")}>
                  {r.enabled ? (r.reachability || "pending").replaceAll("_", " ") : "disabled"}
                </Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted">Last seen</dt>
              <dd className="font-mono">{formatDateTime(r.last_seen, dateFormat)}</dd>
            </div>
            <div>
              <dt className="text-muted">Pools</dt>
              <dd>{r.pool_count}</dd>
            </div>
            <div>
              <dt className="text-muted">Services</dt>
              <dd>{r.service_count}</dd>
            </div>
          </dl>
          <Link
            to="/app/routers/$routerId"
            params={{ routerId: r.id }}
            className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "mt-3 inline-flex")}
          >
            Details
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function RouterPagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <span>
        {total} router{total === 1 ? "" : "s"} · page {page} of {pages}
      </span>
      <div className="flex gap-1">
        <Button type="button" size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft className="size-4" />
          Previous
        </Button>
        <Button type="button" size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

export function MobileFilterButton({ open, onClick, count }: { open: boolean; onClick: () => void; count: number }) {
  return (
    <Button type="button" variant="secondary" className="md:hidden" onClick={onClick}>
      <Filter className="size-4" />
      Filters{count ? ` (${count})` : ""}
      {open ? "" : ""}
    </Button>
  );
}

export function FilterSheet({
  open,
  children,
}: {
  open: boolean;
  children: ReactNode;
}) {
  if (!open) return <div className="hidden md:block">{children}</div>;
  return <div className="rounded-xl border border-border bg-surface p-3 md:border-0 md:bg-transparent md:p-0">{children}</div>;
}

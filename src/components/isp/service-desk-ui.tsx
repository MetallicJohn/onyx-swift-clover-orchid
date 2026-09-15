import { Link } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Filter,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { CounterButton } from "@/components/isp/customer-desk-ui";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select } from "@/components/ui/input";
import { TablePad, VirtualTableFrame } from "@/components/ui/virtual-scroller";
import { useTableVirtualizer } from "@/components/ui/use-virtual-scroller";
import { accessMethodLabel, formatDate, formatMac, remainingLabel } from "@/lib/isp/display";
import {
  activeServiceFilterCount,
  serviceDeskFilterChips,
  serviceRecordPath,
  serviceStatusLabel,
  sessionLabel,
  speedLabel,
  suspendReasonLabel,
  type ServiceDeskFilters,
  type ServiceDeskOption,
  type ServiceDeskRow,
  type ServiceDeskSort,
} from "@/lib/isp/service-desk-format";
import { cn, kes } from "@/lib/utils";

export { CounterButton };

export type ServicePerms = {
  canManage: boolean;
  canDelete: boolean;
  canExpiry: boolean;
  canGrant: boolean;
  canExtend: boolean;
  canRevoke: boolean;
  canReassign: boolean;
  canTraffic: boolean;
  canComms: boolean;
};

export type ServiceActions = {
  onPreview: (s: ServiceDeskRow) => void;
  onEdit: (s: ServiceDeskRow) => void;
  onPackage: (s: ServiceDeskRow) => void;
  onExpiry: (s: ServiceDeskRow) => void;
  onTraffic: (s: ServiceDeskRow) => void;
  onSuspend: (s: ServiceDeskRow) => void;
  onRestore: (s: ServiceDeskRow) => void;
  onGrant: (s: ServiceDeskRow) => void;
  onExtend: (s: ServiceDeskRow) => void;
  onRevoke: (s: ServiceDeskRow) => void;
  onDisconnect: (s: ServiceDeskRow) => void;
  onRotate: (s: ServiceDeskRow) => void;
  onReveal: (s: ServiceDeskRow) => void;
  onRetry: (s: ServiceDeskRow) => void;
  onReassign: (s: ServiceDeskRow) => void;
  onDelete: (s: ServiceDeskRow) => void;
};

function selectClass() {
  return "h-9 w-full md:w-40";
}

export function ServiceSearch({
  value,
  onChange,
  onClear,
  loading,
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
  loading?: boolean;
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search service ID, customer, account, phone, username, IP, router, package, or location"
        aria-label="Search services"
        className="h-11 w-full rounded-md border border-border bg-bg pl-10 pr-12 text-sm text-fg placeholder:text-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      />
      {loading ? (
        <span className="absolute right-12 top-1/2 -translate-y-1/2 text-xs text-subtle">Searching</span>
      ) : null}
      {value ? (
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear search"
          className="absolute right-1 top-1/2 inline-flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-fg"
        >
          <X className="size-4" strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center rounded-full border px-3 text-sm",
        on ? "border-accent bg-accent/15 text-fg" : "border-border bg-bg text-muted hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function ServiceFilterFields({
  filters,
  packages,
  locations,
  routers,
  pools,
  customers,
  onChange,
}: {
  filters: ServiceDeskFilters;
  packages: string[];
  locations: string[];
  routers: ServiceDeskOption[];
  pools: ServiceDeskOption[];
  customers: ServiceDeskOption[];
  onChange: (next: Partial<ServiceDeskFilters>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        aria-label="Service status"
        className={selectClass()}
        value={filters.status}
        onChange={(e) => onChange({ status: e.target.value as ServiceDeskFilters["status"], page: 1 })}
      >
        <option value="all">Any status</option>
        <option value="active">Active</option>
        <option value="pending">Pending</option>
        <option value="expired">Expired</option>
        <option value="grace">Grace Period</option>
        <option value="suspended">Suspended</option>
        <option value="terminated">Terminated</option>
      </Select>
      <Select
        aria-label="Access type"
        className={selectClass()}
        value={filters.access}
        onChange={(e) => onChange({ access: e.target.value as ServiceDeskFilters["access"], page: 1 })}
      >
        <option value="all">Any access</option>
        <option value="pppoe">PPPoE</option>
        <option value="static">Static IP</option>
        <option value="hotspot">Hotspot</option>
      </Select>
      <Select
        aria-label="Package"
        className={selectClass()}
        value={filters.packageName}
        onChange={(e) => onChange({ packageName: e.target.value, page: 1 })}
      >
        <option value="">Any package</option>
        {packages.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Customer"
        className={selectClass()}
        value={filters.customerId}
        onChange={(e) => onChange({ customerId: e.target.value, page: 1 })}
      >
        <option value="">Any customer</option>
        {customers.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Location"
        className={selectClass()}
        value={filters.location}
        onChange={(e) => onChange({ location: e.target.value, page: 1 })}
      >
        <option value="">Any location</option>
        {locations.map((loc) => (
          <option key={loc} value={loc}>
            {loc}
          </option>
        ))}
      </Select>
      {routers.length ? (
        <Select
          aria-label="Router"
          className={selectClass()}
          value={filters.routerId}
          onChange={(e) => onChange({ routerId: e.target.value, page: 1 })}
        >
          <option value="">Any router</option>
          {routers.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </Select>
      ) : null}
      {pools.length ? (
        <Select
          aria-label="IP pool"
          className={selectClass()}
          value={filters.poolId}
          onChange={(e) => onChange({ poolId: e.target.value, page: 1 })}
        >
          <option value="">Any IP pool</option>
          {pools.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      ) : null}
      <Select
        aria-label="Payment status"
        className={selectClass()}
        value={filters.billing}
        onChange={(e) => onChange({ billing: e.target.value as ServiceDeskFilters["billing"], overdue: e.target.value === "overdue", page: 1 })}
      >
        <option value="all">Any billing</option>
        <option value="clear">Paid up</option>
        <option value="due">Outstanding</option>
        <option value="overdue">Overdue</option>
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={filters.expiringSoon} onClick={() => onChange({ expiringSoon: !filters.expiringSoon, page: 1 })}>
          Expiring soon
        </Chip>
        <Chip on={filters.onGrace} onClick={() => onChange({ onGrace: !filters.onGrace, page: 1 })}>
          Grace Period
        </Chip>
        <Chip
          on={filters.overdue || filters.billing === "overdue"}
          onClick={() =>
            onChange({
              overdue: !(filters.overdue || filters.billing === "overdue"),
              billing: filters.overdue || filters.billing === "overdue" ? "all" : "overdue",
              page: 1,
            })
          }
        >
          Overdue
        </Chip>
      </div>
    </div>
  );
}

export function ServiceFilterBar({
  filters,
  packages,
  locations,
  routers,
  pools,
  customers,
  matching,
  onChange,
  onClear,
}: {
  filters: ServiceDeskFilters;
  packages: string[];
  locations: string[];
  routers: ServiceDeskOption[];
  pools: ServiceDeskOption[];
  customers: ServiceDeskOption[];
  matching: number;
  onChange: (next: Partial<ServiceDeskFilters>) => void;
  onClear: () => void;
}) {
  const count = activeServiceFilterCount(filters);
  const chips = serviceDeskFilterChips(filters, { customers, routers, pools }).filter((c) => c.id !== "q");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {matching} match{matching === 1 ? "" : "es"}
          {count ? ` · ${count} filter${count === 1 ? "" : "s"}` : ""}
        </p>
        {count ? (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear all filters
          </Button>
        ) : null}
      </div>
      {chips.length ? (
        <div className="flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <button
              key={chip.id}
              type="button"
              onClick={() => onChange(chip.patch)}
              className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-elevated px-2.5 text-xs text-fg hover:bg-surface"
            >
              {chip.label}
              <X className="size-3" strokeWidth={1.75} />
            </button>
          ))}
        </div>
      ) : null}
      <div className="hidden md:block">
        <ServiceFilterFields
          filters={filters}
          packages={packages}
          locations={locations}
          routers={routers}
          pools={pools}
          customers={customers}
          onChange={onChange}
        />
      </div>
    </div>
  );
}

export function MobileServiceFilters({
  open,
  onOpenChange,
  filters,
  packages,
  locations,
  routers,
  pools,
  customers,
  onChange,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: ServiceDeskFilters;
  packages: string[];
  locations: string[];
  routers: ServiceDeskOption[];
  pools: ServiceDeskOption[];
  customers: ServiceDeskOption[];
  onChange: (next: Partial<ServiceDeskFilters>) => void;
  onClear: () => void;
}) {
  const count = activeServiceFilterCount(filters);
  return (
    <>
      <Button variant="secondary" className="md:hidden" onClick={() => onOpenChange(true)}>
        <Filter className="size-4" strokeWidth={1.75} />
        Filters{count ? ` (${count})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange} title="Filters" description="Combine status, access, package, network, and billing.">
        <div className="space-y-4">
          <ServiceFilterFields
            filters={filters}
            packages={packages}
            locations={locations}
            routers={routers}
            pools={pools}
            customers={customers}
            onChange={onChange}
          />
          <div className="flex gap-2">
            <Button className="flex-1" onClick={() => onOpenChange(false)}>
              Show results
            </Button>
            <Button variant="ghost" onClick={onClear}>
              Clear
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ServiceActionsMenu({
  s,
  perms,
  actions,
}: {
  s: ServiceDeskRow;
  perms: ServicePerms;
  actions: ServiceActions;
}) {
  const activeGrace = Boolean(s.grace_active && s.grace_expires_at);
  const failedProvision = Boolean(s.provision_overall && /fail|retry|error/i.test(s.provision_overall));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${s.customer_name} ${s.id}`} className="size-11">
          <MoreHorizontal className="size-4" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{s.customer_name}</DropdownMenuLabel>
        <div className="px-3 pb-2 text-xs text-muted">
          {accessMethodLabel(s.access_method)} · {s.identity}
          {s.suspend_reason ? ` · ${suspendReasonLabel(s.suspend_reason)}` : ""}
        </div>
        <DropdownMenuItem onSelect={() => actions.onPreview(s)}>View service</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={serviceRecordPath(s.id)}>Open service record</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/customers/$customerId" params={{ customerId: s.customer_id }}>
            View customer
          </Link>
        </DropdownMenuItem>
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onEdit(s)}>Edit service</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onPackage(s)}>Change package</DropdownMenuItem> : null}
        {perms.canExpiry ? <DropdownMenuItem onSelect={() => actions.onExpiry(s)}>Change expiry date</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        {perms.canTraffic ? <DropdownMenuItem onSelect={() => actions.onTraffic(s)}>View realtime traffic</DropdownMenuItem> : null}
        {perms.canTraffic ? (
          <DropdownMenuItem asChild>
            <a href={serviceRecordPath(s.id)}>View usage</a>
          </DropdownMenuItem>
        ) : null}
        {perms.canManage && s.access_method === "pppoe" ? (
          <DropdownMenuItem onSelect={() => actions.onReveal(s)}>View credentials</DropdownMenuItem>
        ) : null}
        {perms.canManage && s.access_method === "pppoe" ? (
          <DropdownMenuItem onSelect={() => actions.onRotate(s)}>Reset credentials</DropdownMenuItem>
        ) : null}
        {perms.canManage && s.access_method === "pppoe" && (failedProvision || s.status === "pending") ? (
          <DropdownMenuItem onSelect={() => actions.onRetry(s)}>Retry provisioning</DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {perms.canManage && s.status !== "active" && s.status !== "terminated" ? (
          <DropdownMenuItem onSelect={() => actions.onRestore(s)}>Restore service</DropdownMenuItem>
        ) : null}
        {perms.canManage && (s.status === "active" || s.status === "grace") ? (
          <DropdownMenuItem onSelect={() => actions.onSuspend(s)}>Suspend service</DropdownMenuItem>
        ) : null}
        {perms.canGrant && !activeGrace && s.status !== "terminated" ? (
          <DropdownMenuItem onSelect={() => actions.onGrant(s)}>Grant Grace Period</DropdownMenuItem>
        ) : null}
        {perms.canExtend && activeGrace ? <DropdownMenuItem onSelect={() => actions.onExtend(s)}>Extend Grace Period</DropdownMenuItem> : null}
        {perms.canRevoke && activeGrace ? <DropdownMenuItem onSelect={() => actions.onRevoke(s)}>Revoke Grace Period</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onDisconnect(s)}>Disconnect session</DropdownMenuItem> : null}
        {perms.canReassign ? <DropdownMenuItem onSelect={() => actions.onReassign(s)}>Move / reassign</DropdownMenuItem> : null}
        {perms.canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => actions.onDelete(s)}>
              Archive / delete
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SortHead({
  label,
  id,
  sort,
  dir,
  onSort,
  className,
}: {
  label: string;
  id: ServiceDeskSort;
  sort: ServiceDeskSort;
  dir: "asc" | "desc";
  onSort: (id: ServiceDeskSort) => void;
  className?: string;
}) {
  const active = sort === id;
  return (
    <th className={cn("px-3 py-2 font-medium", className)}>
      <button
        type="button"
        onClick={() => onSort(id)}
        className={cn("inline-flex items-center gap-1 hover:text-fg", active ? "text-fg" : "text-muted")}
      >
        {label}
        {active ? <span className="text-[10px]">{dir === "asc" ? "↑" : "↓"}</span> : null}
      </button>
    </th>
  );
}

function StatusCell({ s }: { s: ServiceDeskRow }) {
  const reason = suspendReasonLabel(s.suspend_reason);
  return (
    <td className="px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <Badge tone={statusTone(s.display_status)}>{serviceStatusLabel(s.display_status)}</Badge>
      </div>
      {reason ? <div className="mt-0.5 text-xs text-subtle">{reason}</div> : null}
      {s.grace_active && s.grace_expires_at ? (
        <div className="text-xs text-warn">{remainingLabel(s.grace_expires_at)}</div>
      ) : null}
    </td>
  );
}

export function ServiceTable({
  rows,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  onPreview,
  perms,
  actions,
  sort,
  dir,
  onSort,
}: {
  rows: ServiceDeskRow[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onPreview: (s: ServiceDeskRow) => void;
  perms: ServicePerms;
  actions: ServiceActions;
  sort: ServiceDeskSort;
  dir: "asc" | "desc";
  onSort: (id: ServiceDeskSort) => void;
}) {
  const { parentRef, virtualizer, rows: vis, padTop, padBottom } = useTableVirtualizer(rows.length, 56);
  return (
    <VirtualTableFrame parentRef={parentRef} className="hidden rounded-xl bg-surface shadow-card md:block">
      <table className="w-full min-w-[72rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
          <tr>
            <th className="px-3 py-2">
              {perms.canManage ? (
                <input type="checkbox" className="size-4" checked={allSelected} onChange={onToggleAll} aria-label="Select all on this page" />
              ) : null}
            </th>
            <SortHead label="Customer" id="customer" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Service" id="service" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Access" id="access" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Package" id="package" sort={sort} dir={dir} onSort={onSort} />
            <th className="px-3 py-2 font-medium">Identity</th>
            <SortHead label="Location" id="location" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Status" id="status" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Expiry" id="expiry" sort={sort} dir={dir} onSort={onSort} />
            <SortHead label="Outstanding" id="outstanding" sort={sort} dir={dir} onSort={onSort} />
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <TablePad height={padTop} colSpan={11} />
          {vis.map((v) => {
            const s = rows[v.index];
            return (
              <tr
                key={s.id}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="cursor-pointer hover:bg-elevated/60"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("a,button,input,[role='menu']")) return;
                  onPreview(s);
                }}
              >
                <td className="px-3 py-2">
                  {perms.canManage ? (
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.has(s.id)}
                      onChange={() => onToggle(s.id)}
                      aria-label={`Select ${s.id}`}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="min-w-0">
                    <Link
                      to="/app/customers/$customerId"
                      params={{ customerId: s.customer_id }}
                      className="font-medium hover:text-accent hover:underline"
                      title={s.customer_name}
                    >
                      {s.customer_name}
                    </Link>
                    <div className="font-mono text-xs text-muted">{s.account_number || "No account"}</div>
                  </div>
                </td>
                <td className="px-3 py-2">
                  <a href={serviceRecordPath(s.id)} className="font-mono text-xs hover:text-accent hover:underline" title={s.id}>
                    {s.id}
                  </a>
                  <div className="text-xs text-muted">{s.router_name || "No router"}</div>
                </td>
                <td className="px-3 py-2 text-muted">
                  <div>{accessMethodLabel(s.access_method)}</div>
                  <div className="text-xs">{speedLabel(s.download_mbps, s.upload_mbps)}</div>
                </td>
                <td className="max-w-36 truncate px-3 py-2" title={s.package_name}>
                  {s.package_name}
                </td>
                <td className="px-3 py-2 font-mono text-xs" title={s.identity}>
                  <div className="truncate">{s.identity}</div>
                  <div className="text-muted">{sessionLabel(s.session_online, s.last_activity)}</div>
                </td>
                <td className="max-w-32 truncate px-3 py-2 text-muted" title={s.location || s.pool_name}>
                  {s.location || s.pool_name || "—"}
                </td>
                <StatusCell s={s} />
                <td className="whitespace-nowrap px-3 py-2">{formatDate(s.access_until || s.period_end)}</td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  <span className={s.overdue ? "text-danger" : undefined}>{kes(s.balance_kes)}</span>
                </td>
                <td className="px-2 py-1 text-right">
                  <ServiceActionsMenu s={s} perms={perms} actions={actions} />
                </td>
              </tr>
            );
          })}
          <TablePad height={padBottom} colSpan={11} />
        </tbody>
      </table>
    </VirtualTableFrame>
  );
}

export function ServiceCards({
  rows,
  selected,
  onToggle,
  onPreview,
  perms,
  actions,
}: {
  rows: ServiceDeskRow[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onPreview: (s: ServiceDeskRow) => void;
  perms: ServicePerms;
  actions: ServiceActions;
}) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((s) => (
        <article
          key={s.id}
          className="rounded-xl border border-border bg-surface p-3 shadow-card"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("a,button,input,[role='menu']")) return;
            onPreview(s);
          }}
        >
          <div className="flex items-start gap-3">
            {perms.canManage ? (
              <input
                type="checkbox"
                className="mt-2 size-4"
                checked={selected.has(s.id)}
                onChange={() => onToggle(s.id)}
                aria-label={`Select ${s.id}`}
              />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/app/customers/$customerId"
                  params={{ customerId: s.customer_id }}
                  className="pt-1 font-medium hover:text-accent hover:underline"
                >
                  {s.customer_name}
                </Link>
                <ServiceActionsMenu s={s} perms={perms} actions={actions} />
              </div>
              <p className="font-mono text-xs text-muted">
                <a href={serviceRecordPath(s.id)} className="hover:text-accent hover:underline">
                  {s.id}
                </a>
                {s.account_number ? ` · ${s.account_number}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={statusTone(s.display_status)}>{serviceStatusLabel(s.display_status)}</Badge>
                <Badge tone="muted">{accessMethodLabel(s.access_method)}</Badge>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
                <div>
                  <dt className="text-subtle">Package</dt>
                  <dd className="text-fg">{s.package_name}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Expiry</dt>
                  <dd>{formatDate(s.access_until || s.period_end)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Identity</dt>
                  <dd className="font-mono text-fg">{s.identity}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Session</dt>
                  <dd>{sessionLabel(s.session_online, s.last_activity)}</dd>
                </div>
              </dl>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ServicePagination({
  page,
  pages,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted">
        Page {page} of {pages} · {total} service{total === 1 ? "" : "s"}
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" strokeWidth={1.75} />
          Prev
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

export function ServiceSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading services">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

export function ServiceOverflowMenu({
  canRecycle,
  selectedCount,
  onExport,
}: {
  canRecycle: boolean;
  selectedCount: number;
  onExport: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">More</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onExport}>{selectedCount ? `Export selected (${selectedCount})` : "Export services"}</DropdownMenuItem>
        {canRecycle ? (
          <DropdownMenuItem asChild>
            <Link to="/app/recycle-bin">Recycle Bin</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ServicePreview({
  open,
  onOpenChange,
  loading,
  error,
  service,
  record,
  perms,
  onTraffic,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  service: ServiceDeskRow | null;
  record: {
    service: {
      id: string;
      customer_id: string;
      customer_name: string;
      account_number?: string;
      customer_phone?: string;
      package_name: string;
      access_method: string;
      status: string;
      username: string | null;
      static_ip: string | null;
      mac_address?: string;
      period_end?: string | null;
      access_until?: string | null;
      download_mbps?: number;
      upload_mbps?: number;
      suspend_reason?: string;
      notes?: string;
    };
    provision: { overall: string; radius_status: string; framed_ip: string; last_error: string; router_id: string | null } | null;
    session: { framed_ip: string; started_at: string; stopped_at: string | null; bytes_in: number; bytes_out: number } | null;
  } | null;
  perms: ServicePerms;
  onTraffic: () => void;
  onEdit: () => void;
}) {
  const s = record?.service;
  const method = s?.access_method || service?.access_method || "";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={s ? `${s.package_name} · ${accessMethodLabel(s.access_method)}` : service?.package_name || "Service"}
      description="Quick preview. Open the full record to manage this line."
      placement="drawer"
    >
      {loading ? <p className="text-sm text-muted">Loading service…</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {s ? (
        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <Link
              to="/app/customers/$customerId"
              params={{ customerId: s.customer_id }}
              className="font-medium hover:text-accent hover:underline"
            >
              {s.customer_name}
            </Link>
            <p className="font-mono text-xs text-muted">{s.account_number || "No account number"}</p>
            <p>{s.customer_phone || "No phone"}</p>
            <div className="flex flex-wrap gap-1 pt-1">
              <Badge tone={statusTone(service?.display_status || s.status)}>
                {serviceStatusLabel(service?.display_status || s.status)}
              </Badge>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-elevated p-3">
              <div className="text-xs text-subtle">Identity</div>
              <div className="font-mono text-xs">{s.username || s.static_ip || "—"}</div>
            </div>
            <div className="rounded-md bg-elevated p-3">
              <div className="text-xs text-subtle">Expiry</div>
              <div>{formatDate(s.access_until || s.period_end)}</div>
            </div>
            {method === "pppoe" ? (
              <>
                <div className="rounded-md bg-elevated p-3">
                  <div className="text-xs text-subtle">PPPoE</div>
                  <div className="font-mono text-xs">{s.username || "—"}</div>
                </div>
                <div className="rounded-md bg-elevated p-3">
                  <div className="text-xs text-subtle">RADIUS</div>
                  <div>{record?.provision?.radius_status || "Not provisioned"}</div>
                </div>
              </>
            ) : null}
            {method === "static" ? (
              <>
                <div className="rounded-md bg-elevated p-3">
                  <div className="text-xs text-subtle">Assigned IP</div>
                  <div className="font-mono text-xs">{s.static_ip || record?.provision?.framed_ip || "—"}</div>
                </div>
                <div className="rounded-md bg-elevated p-3">
                  <div className="text-xs text-subtle">MAC</div>
                  <div className="font-mono text-xs">{formatMac(s.mac_address)}</div>
                </div>
              </>
            ) : null}
            {method === "hotspot" ? (
              <div className="rounded-md bg-elevated p-3">
                <div className="text-xs text-subtle">Hotspot user</div>
                <div className="font-mono text-xs">{s.username || "—"}</div>
              </div>
            ) : null}
          </dl>
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted">Realtime session</h3>
            {record?.session ? (
              <p className="mt-2 text-sm">
                {record.session.stopped_at ? "Offline" : "Online"}
                {record.session.framed_ip ? ` · ${record.session.framed_ip}` : ""}
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No RADIUS session recorded. Traffic is not estimated.</p>
            )}
          </section>
          {record?.provision?.last_error ? (
            <p className="text-sm text-danger">Provisioning: {record.provision.last_error}</p>
          ) : null}
          {s.notes ? <p className="whitespace-pre-wrap text-sm">{s.notes}</p> : null}
          <div className="flex flex-wrap gap-2">
            <a href={serviceRecordPath(s.id)} className={buttonVariants()}>
              Open record
            </a>
            {perms.canTraffic ? (
              <Button variant="secondary" onClick={onTraffic}>
                Realtime traffic
              </Button>
            ) : null}
            {perms.canManage ? (
              <Button variant="secondary" onClick={onEdit}>
                Edit
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

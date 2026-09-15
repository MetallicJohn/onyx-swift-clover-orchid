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
import { TagList } from "@/components/isp/tag-picker";
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
import {
  accountStateLabel,
  activeDeskFilterCount,
  customerInitials,
  customerRecordPath,
  deskFilterChips,
  lineStatusLabel,
  type DeskCustomer,
  type DeskCustomerStatus,
  type DeskFilters,
  type DeskTag,
  type LineStatus,
} from "@/lib/isp/customer-desk-format";
import { accessMethodLabel, formatDate, formatShortDateTime } from "@/lib/isp/display";
import { cn, kes } from "@/lib/utils";

export type DeskPerms = {
  canManage: boolean;
  canDelete: boolean;
  canServices: boolean;
  canStatements: boolean;
  canTraffic: boolean;
  canComms: boolean;
};

export type DeskActions = {
  onPreview: (c: DeskCustomer) => void;
  onEdit: (c: DeskCustomer) => void;
  onTraffic: (c: DeskCustomer) => void;
  onTags: (c: DeskCustomer) => void;
  onMessage: (c: DeskCustomer) => void;
  onSuspend: (c: DeskCustomer) => void;
  onRestore: (c: DeskCustomer) => void;
  onDelete: (c: DeskCustomer) => void;
};

function accountLabel(state: string) {
  return accountStateLabel(state);
}

function lineLabel(status: LineStatus | string) {
  return lineStatusLabel(status);
}

function selectClass() {
  return "h-9 w-full md:w-40";
}

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-8 shrink-0 items-center justify-center rounded-md bg-elevated text-xs font-medium text-muted"
    >
      {customerInitials(name)}
    </span>
  );
}

export function DeskSearch({
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
        placeholder="Search name, account, phone, email, service ID, username, IP, or location"
        aria-label="Search customers"
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

export function DeskFilterFields({
  filters,
  packages,
  locations,
  tags,
  onChange,
}: {
  filters: DeskFilters;
  packages: string[];
  locations: string[];
  tags: DeskTag[];
  onChange: (next: Partial<DeskFilters>) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Select
        aria-label="Customer status"
        className={selectClass()}
        value={filters.customerStatus}
        onChange={(e) => onChange({ customerStatus: e.target.value as DeskCustomerStatus, page: 1 })}
      >
        <option value="all">Any customer status</option>
        <option value="active">Active</option>
        <option value="inactive">Inactive</option>
        <option value="suspended">Suspended</option>
      </Select>
      <Select
        aria-label="Service status"
        className={selectClass()}
        value={filters.serviceStatus}
        onChange={(e) => onChange({ serviceStatus: e.target.value as DeskFilters["serviceStatus"], page: 1 })}
      >
        <option value="all">Any service status</option>
        <option value="active">Active</option>
        <option value="expired">Expired</option>
        <option value="grace">Grace Period</option>
        <option value="suspended">Suspended</option>
        <option value="pending">Pending</option>
        <option value="terminated">Terminated</option>
      </Select>
      <Select
        aria-label="Access type"
        className={selectClass()}
        value={filters.access}
        onChange={(e) => onChange({ access: e.target.value as DeskFilters["access"], page: 1 })}
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
      <Select
        aria-label="Billing status"
        className={selectClass()}
        value={filters.billing}
        onChange={(e) => onChange({ billing: e.target.value as DeskFilters["billing"], overdue: e.target.value === "overdue", page: 1 })}
      >
        <option value="all">Any billing</option>
        <option value="clear">Paid up</option>
        <option value="due">Outstanding</option>
        <option value="overdue">Overdue</option>
      </Select>
      {tags.length > 1 ? (
        <Select
          aria-label="Tag match"
          className={selectClass()}
          value={filters.tagMode}
          onChange={(e) => onChange({ tagMode: e.target.value === "all" ? "all" : "any", page: 1 })}
        >
          <option value="any">Any selected tag</option>
          <option value="all">All selected tags</option>
        </Select>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Chip on={filters.expiringSoon} onClick={() => onChange({ expiringSoon: !filters.expiringSoon, page: 1 })}>
          Expiring soon
        </Chip>
        <Chip on={filters.onGrace} onClick={() => onChange({ onGrace: !filters.onGrace, page: 1 })}>
          Grace
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
      {tags.length ? (
        <div className="flex w-full flex-wrap gap-2">
          {tags.map((t) => {
            const on = filters.tagIds.includes(t.id);
            return (
              <Chip
                key={t.id}
                on={on}
                onClick={() =>
                  onChange({
                    tagIds: on ? filters.tagIds.filter((id) => id !== t.id) : [...filters.tagIds, t.id],
                    page: 1,
                  })
                }
              >
                {t.name}
                <span className="text-subtle"> {t.customer_count}</span>
              </Chip>
            );
          })}
        </div>
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

export function DeskFilterBar({
  filters,
  packages,
  locations,
  tags,
  matching,
  onChange,
  onClear,
}: {
  filters: DeskFilters;
  packages: string[];
  locations: string[];
  tags: DeskTag[];
  matching: number;
  onChange: (next: Partial<DeskFilters>) => void;
  onClear: () => void;
}) {
  const count = activeDeskFilterCount(filters);
  const chips = deskFilterChips(filters, tags).filter((c) => c.id !== "q");
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
        <DeskFilterFields filters={filters} packages={packages} locations={locations} tags={tags} onChange={onChange} />
      </div>
    </div>
  );
}

export function MobileFilterButton({
  open,
  onOpenChange,
  filters,
  packages,
  locations,
  tags,
  onChange,
  onClear,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: DeskFilters;
  packages: string[];
  locations: string[];
  tags: DeskTag[];
  onChange: (next: Partial<DeskFilters>) => void;
  onClear: () => void;
}) {
  const count = activeDeskFilterCount(filters);
  return (
    <>
      <Button variant="secondary" className="md:hidden" onClick={() => onOpenChange(true)}>
        <Filter className="size-4" strokeWidth={1.75} />
        Filters{count ? ` (${count})` : ""}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange} title="Filters" description="Combine status, access, package, location, and tags.">
        <div className="space-y-4">
          <DeskFilterFields filters={filters} packages={packages} locations={locations} tags={tags} onChange={onChange} />
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

function CustomerActions({
  c,
  perms,
  actions,
}: {
  c: DeskCustomer;
  perms: DeskPerms;
  actions: DeskActions;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${c.name}`} className="size-11">
          <MoreHorizontal className="size-4" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{c.account_number || c.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => actions.onPreview(c)}>Quick preview</DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link to="/app/customers/$customerId" params={{ customerId: c.id }}>
            View customer
          </Link>
        </DropdownMenuItem>
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onEdit(c)}>Edit customer</DropdownMenuItem> : null}
        <DropdownMenuSeparator />
        {perms.canServices ? (
          <DropdownMenuItem asChild>
            <a href={customerRecordPath(c.id, { tab: "services", action: "add-service" })}>Add service</a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href={customerRecordPath(c.id, { tab: "services" })}>View services</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={customerRecordPath(c.id, { tab: "billing" })}>View billing</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href={customerRecordPath(c.id, { tab: "billing" })}>View payments</a>
        </DropdownMenuItem>
        {perms.canStatements ? (
          <DropdownMenuItem asChild>
            <a href={`/app/statements?customer=${c.id}`}>View statement</a>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        {perms.canTraffic ? <DropdownMenuItem onSelect={() => actions.onTraffic(c)}>View realtime traffic</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onMessage(c)}>Send communication</DropdownMenuItem> : null}
        {perms.canManage ? <DropdownMenuItem onSelect={() => actions.onTags(c)}>Add or manage tags</DropdownMenuItem> : null}
        {perms.canServices && c.live_service_ids.length ? (
          <DropdownMenuItem onSelect={() => actions.onSuspend(c)}>Suspend services</DropdownMenuItem>
        ) : null}
        {perms.canServices && c.suspended_service_ids.length ? (
          <DropdownMenuItem onSelect={() => actions.onRestore(c)}>Restore services</DropdownMenuItem>
        ) : null}
        {perms.canDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem danger onSelect={() => actions.onDelete(c)}>
              Delete customer
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function DeskTable({
  rows,
  selected,
  allSelected,
  onToggle,
  onToggleAll,
  onPreview,
  perms,
  actions,
}: {
  rows: DeskCustomer[];
  selected: Set<string>;
  allSelected: boolean;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onPreview: (c: DeskCustomer) => void;
  perms: DeskPerms;
  actions: DeskActions;
}) {
  const { parentRef, virtualizer, rows: vis, padTop, padBottom } = useTableVirtualizer(rows.length, 56);
  return (
    <VirtualTableFrame parentRef={parentRef} className="hidden rounded-xl bg-surface shadow-card md:block">
      <table className="w-full min-w-[64rem] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-surface text-xs text-muted">
          <tr>
            <th className="px-3 py-2">
              {perms.canManage ? (
                <input type="checkbox" className="size-4" checked={allSelected} onChange={onToggleAll} aria-label="Select all on this page" />
              ) : null}
            </th>
            <th className="px-3 py-2 font-medium">Customer</th>
            <th className="px-3 py-2 font-medium">Account</th>
            <th className="px-3 py-2 font-medium">Phone</th>
            <th className="px-3 py-2 font-medium">Package</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Expiry</th>
            <th className="px-3 py-2 font-medium">Last activity</th>
            <th className="px-3 py-2 font-medium">Outstanding</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <TablePad height={padTop} colSpan={11} />
          {vis.map((v) => {
            const c = rows[v.index];
            return (
              <tr
                key={c.id}
                data-index={v.index}
                ref={virtualizer.measureElement}
                className="cursor-pointer hover:bg-elevated/60"
                onClick={(e) => {
                  const target = e.target as HTMLElement;
                  if (target.closest("a,button,input,[role='menu']")) return;
                  onPreview(c);
                }}
              >
                <td className="px-3 py-2">
                  {perms.canManage ? (
                    <input
                      type="checkbox"
                      className="size-4"
                      checked={selected.has(c.id)}
                      onChange={() => onToggle(c.id)}
                      aria-label={`Select ${c.name}`}
                    />
                  ) : null}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={c.name} />
                    <div className="min-w-0">
                      <Link
                        to="/app/customers/$customerId"
                        params={{ customerId: c.id }}
                        className="font-medium hover:text-accent hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {c.service_count} service{c.service_count === 1 ? "" : "s"}
                        {c.address ? ` · ${c.address}` : ""}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{c.account_number || "—"}</td>
                <td className="px-3 py-2">
                  <div>{c.phone || "No phone"}</div>
                  <div className="text-xs text-muted">{c.email || "No email"}</div>
                </td>
                <td className="px-3 py-2">{c.package_summary}</td>
                <td className="px-3 py-2 text-muted">{c.access_methods.map(accessMethodLabel).join(" · ") || "—"}</td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <Badge tone={statusTone(c.account_state)}>{accountLabel(c.account_state)}</Badge>
                    {c.line_status !== "none" ? <Badge tone={statusTone(c.line_status)}>{lineLabel(c.line_status)}</Badge> : null}
                  </div>
                  <div className="mt-0.5 text-xs text-subtle">{c.service_status_summary}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2">{formatDate(c.next_expiry)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-muted">{c.last_activity ? formatShortDateTime(c.last_activity) : "—"}</td>
                <td className="px-3 py-2 font-mono tabular-nums">
                  <span className={c.overdue ? "text-danger" : undefined}>{kes(c.balance_kes)}</span>
                </td>
                <td className="px-2 py-1 text-right">
                  <CustomerActions c={c} perms={perms} actions={actions} />
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

export function DeskCards({
  rows,
  selected,
  onToggle,
  onPreview,
  perms,
  actions,
}: {
  rows: DeskCustomer[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onPreview: (c: DeskCustomer) => void;
  perms: DeskPerms;
  actions: DeskActions;
}) {
  return (
    <div className="space-y-2 md:hidden">
      {rows.map((c) => (
        <article
          key={c.id}
          className="rounded-xl border border-border bg-surface p-3 shadow-card"
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target.closest("a,button,input,[role='menu']")) return;
            onPreview(c);
          }}
        >
          <div className="flex items-start gap-3">
            {perms.canManage ? (
              <input
                type="checkbox"
                className="mt-2 size-4"
                checked={selected.has(c.id)}
                onChange={() => onToggle(c.id)}
                aria-label={`Select ${c.name}`}
              />
            ) : null}
            <Avatar name={c.name} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <Link
                  to="/app/customers/$customerId"
                  params={{ customerId: c.id }}
                  className="pt-1 font-medium hover:text-accent hover:underline"
                >
                  {c.name}
                </Link>
                <CustomerActions c={c} perms={perms} actions={actions} />
              </div>
              <p className="text-xs text-muted">
                {c.account_number || "No account"} · {c.phone || "No phone"}
                {c.email ? ` · ${c.email}` : ""}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                <Badge tone={statusTone(c.account_state)}>{accountLabel(c.account_state)}</Badge>
                {c.line_status !== "none" ? <Badge tone={statusTone(c.line_status)}>{lineLabel(c.line_status)}</Badge> : null}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted">
                <div>
                  <dt className="text-subtle">Package</dt>
                  <dd className="text-fg">{c.package_summary}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Outstanding</dt>
                  <dd className={cn("font-mono tabular-nums text-fg", c.overdue && "text-danger")}>{kes(c.balance_kes)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Type</dt>
                  <dd>{c.access_methods.map(accessMethodLabel).join(" · ") || "—"}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Expiry</dt>
                  <dd>{formatDate(c.next_expiry)}</dd>
                </div>
                <div>
                  <dt className="text-subtle">Activity</dt>
                  <dd>{c.last_activity ? formatShortDateTime(c.last_activity) : "—"}</dd>
                </div>
              </dl>
              {c.tags.length ? (
                <div className="mt-2">
                  <TagList tags={c.tags} />
                </div>
              ) : null}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function DeskPagination({
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
        Page {page} of {pages} · {total} customer{total === 1 ? "" : "s"}
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

export function DeskSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading customers">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-14 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

export function CustomerPreview({
  open,
  onOpenChange,
  loading,
  error,
  customer,
  record,
  perms,
  onTraffic,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  customer: DeskCustomer | null;
  record: {
    customer: { name: string; account_number: string; phone: string; email: string; address: string; status: string; balance_kes: number };
    services: Array<{
      id: string;
      package_name: string;
      access_method: string;
      status: string;
      username: string | null;
      static_ip: string | null;
      period_end?: string | null;
      access_until?: string | null;
    }>;
    payments: Array<{ id: string; amount_kes: number; reference: string; status: string; paid_at: string }>;
  } | null;
  perms: DeskPerms;
  onTraffic: () => void;
  onEdit: () => void;
}) {
  const c = record?.customer;
  const services = record?.services ?? [];
  const live = services.filter((s) => s.status === "active" || s.status === "grace");
  const down = services.filter((s) => s.status !== "active" && s.status !== "grace");
  const next = live
    .map((s) => s.access_until || s.period_end)
    .filter((iso): iso is string => Boolean(iso))
    .sort()[0];
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={c?.name || customer?.name || "Customer"}
      description="Quick preview. Open the full record to manage the account."
      placement="drawer"
    >
      {loading ? <p className="text-sm text-muted">Loading customer…</p> : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {c ? (
        <div className="space-y-4">
          <div className="space-y-1 text-sm">
            <p className="font-mono text-xs text-muted">{c.account_number || "No account number"}</p>
            <p>
              {c.phone || "No phone"}
              {c.email ? ` · ${c.email}` : ""}
            </p>
            {c.address ? <p className="text-muted">{c.address}</p> : null}
            <div className="flex flex-wrap gap-1 pt-1">
              <Badge tone={statusTone(customer?.account_state || c.status)}>{accountLabel(customer?.account_state || c.status)}</Badge>
              {customer && customer.line_status !== "none" ? (
                <Badge tone={statusTone(customer.line_status)}>{lineLabel(customer.line_status)}</Badge>
              ) : null}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-md bg-elevated p-3">
              <div className="text-xs text-subtle">Outstanding</div>
              <div className="font-mono tabular-nums">{kes(c.balance_kes)}</div>
            </div>
            <div className="rounded-md bg-elevated p-3">
              <div className="text-xs text-subtle">Next expiry</div>
              <div>{formatDate(next)}</div>
            </div>
          </div>
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted">Services</h3>
            {services.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No services on this account.</p>
            ) : (
              <ul className="mt-2 divide-y divide-border rounded-md border border-border">
                {services.map((s) => (
                  <li key={s.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{s.package_name}</span>
                      <Badge tone={statusTone(s.status)}>{lineLabel(s.status)}</Badge>
                    </div>
                    <div className="text-xs text-muted">
                      {accessMethodLabel(s.access_method)} · {s.username || s.static_ip || "—"}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {down.length && live.length ? (
              <p className="mt-2 text-xs text-subtle">
                {down.length} suspended or expired · {live.length} live
              </p>
            ) : null}
          </section>
          <section>
            <h3 className="text-xs font-medium tracking-wide text-muted">Recent payments</h3>
            {record?.payments.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {record.payments.slice(0, 5).map((p) => (
                  <li key={p.id} className="flex justify-between gap-2">
                    <span className="text-muted">{formatDate(p.paid_at)}</span>
                    <span className="font-mono tabular-nums">{kes(p.amount_kes)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">No payments on this book.</p>
            )}
          </section>
          <div className="flex flex-wrap gap-2">
            {customer ? (
              <Link to="/app/customers/$customerId" params={{ customerId: customer.id }} className={buttonVariants()}>
                Open profile
              </Link>
            ) : null}
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
            {perms.canStatements && customer ? (
              <a href={`/app/statements?customer=${customer.id}`} className="inline-flex h-11 items-center text-sm text-accent hover:underline">
                Statement
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}

export function CounterButton({
  label,
  value,
  active,
  onClick,
}: {
  label: string;
  value: number;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "min-w-[6.5rem] rounded-lg border px-3 py-1.5 text-left",
        active ? "border-accent bg-accent/10" : "border-border bg-surface hover:bg-elevated",
      )}
    >
      <div className="text-xs text-muted">{label}</div>
      <div className="font-mono text-base tabular-nums">{value}</div>
    </button>
  );
}

export function DeskOverflowMenu({
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
        <DropdownMenuItem asChild>
          <Link to="/app/import">Import customers</Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>{selectedCount ? `Export selected (${selectedCount})` : "Export customers"}</DropdownMenuItem>
        {canRecycle ? (
          <DropdownMenuItem asChild>
            <Link to="/app/recycle-bin">Recycle Bin</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

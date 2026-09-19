import {
  ChevronLeft,
  ChevronRight,
  LayoutGrid,
  List,
  MoreHorizontal,
  Search,
  X,
} from "lucide-react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input, Select } from "@/components/ui/input";
import { accessMethodLabel } from "@/lib/isp/display";
import { tierLabel } from "@/lib/isp/business-credit-format";
import {
  HOTSPOT_DURATION_UNITS,
  capLabel,
  durationLabel,
  graceLabel,
  hoursFromInput,
  mbFromInput,
  PACKAGE_PAGE_SIZES,
  shownCap,
  shownValidity,
  speedLabel,
  type CapUnit,
  type HotspotDurationUnit,
  type PackageFieldErrors,
  type PackageFormState,
  type PackagesAccessFilter,
  type PackagesSort,
  type PackagesStatusFilter,
  type PackagesView,
  type ValidityUnit,
} from "@/lib/isp/packages-ui";
import type { AccessMethod, PackageRow } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

const compactControl = "h-9 text-sm";

function CompactField({
  label,
  error,
  hint,
  warn,
  className,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  warn?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={cn("grid min-w-0 gap-1", className)}>
      <span className="text-xs font-medium tracking-wide text-muted">{label}</span>
      {children}
      {error ? (
        <span className="text-xs text-danger" role="alert">
          {error}
        </span>
      ) : warn ? (
        <span className="text-xs text-warn">{warn}</span>
      ) : hint ? (
        <span className="text-xs text-muted">{hint}</span>
      ) : null}
    </label>
  );
}

function AffixInput({
  suffix,
  className,
  ...props
}: ComponentProps<typeof Input> & { suffix: string }) {
  return (
    <div className={cn("flex max-w-40", className)}>
      <Input className={cn(compactControl, "min-w-0 flex-1 rounded-r-none")} {...props} />
      <span className="inline-flex h-9 shrink-0 items-center rounded-r-md border border-l-0 border-border bg-elevated px-2 text-xs text-muted">
        {suffix}
      </span>
    </div>
  );
}

export function PackageFormDialog({
  open,
  editing,
  form,
  lockMethod,
  validityUnit,
  capUnit,
  busy,
  error,
  fieldErrors,
  onOpenChange,
  onChange,
  onValidityUnit,
  onCapUnit,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  form: PackageFormState;
  lockMethod: boolean;
  validityUnit: ValidityUnit;
  capUnit: CapUnit;
  busy: boolean;
  error: string | null;
  fieldErrors: PackageFieldErrors;
  onOpenChange: (open: boolean) => void;
  onChange: (next: PackageFormState) => void;
  onValidityUnit: (unit: ValidityUnit) => void;
  onCapUnit: (unit: CapUnit) => void;
  onSubmit: (e: FormEvent) => void;
}) {
  const credit = form.tier === "business" || form.tier === "enterprise";
  const hotspot = form.access_method === "hotspot";
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit package" : hotspot ? "Create hotspot package" : "Create package"}
      description={
        hotspot
          ? "Name, speed, price, and how long access lasts after the customer pays."
          : editing
            ? "Update this plan. Duration and grace stay as saved until you change them."
            : "Speed, price, and duration. Duration starts at 30 days and grace at 0."
      }
      className="sm:max-w-2xl"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="package-form" disabled={busy}>
            {busy ? "Saving…" : editing ? "Save changes" : "Create package"}
          </Button>
        </div>
      }
    >
      <form id="package-form" onSubmit={onSubmit} className="grid grid-cols-2 gap-x-3 gap-y-2.5 lg:grid-cols-3">
        <CompactField label="Package name" error={fieldErrors.name} className="col-span-2">
          <Input
            className={cn(compactControl, "max-w-md")}
            required
            autoFocus
            aria-invalid={Boolean(fieldErrors.name)}
            value={form.name}
            onChange={(e) => onChange({ ...form, name: e.target.value })}
          />
        </CompactField>
        <CompactField
          label="Access type"
          className="col-span-2 lg:col-span-1"
          hint={lockMethod ? `Locked to ${accessMethodLabel(form.access_method)} from the filter.` : undefined}
        >
          <Select
            className={cn(compactControl, "max-w-44")}
            value={form.access_method}
            disabled={lockMethod}
            onChange={(e) => {
              const method = e.target.value as AccessMethod;
              if (method === "hotspot") {
                onChange({
                  ...form,
                  access_method: method,
                  price_kes: form.access_method === "hotspot" ? form.price_kes : 50,
                  duration_value: 1,
                  duration_unit: "hours",
                  validity_hours: 1,
                  grace_days: 0,
                  billing_interval: "daily",
                  tier: "residential",
                  business_credit_enabled: false,
                });
                return;
              }
              onChange({ ...form, access_method: method });
            }}
          >
            <option value="pppoe">PPPoE</option>
            <option value="static">Static IP</option>
            <option value="hotspot">Hotspot</option>
          </Select>
        </CompactField>
        <CompactField label="Download" error={fieldErrors.download_mbps}>
          <AffixInput
            type="number"
            min={1}
            suffix="Mbps"
            aria-invalid={Boolean(fieldErrors.download_mbps)}
            value={form.download_mbps}
            onChange={(e) => onChange({ ...form, download_mbps: Number(e.target.value) })}
          />
        </CompactField>
        <CompactField label="Upload" error={fieldErrors.upload_mbps}>
          <AffixInput
            type="number"
            min={1}
            suffix="Mbps"
            aria-invalid={Boolean(fieldErrors.upload_mbps)}
            value={form.upload_mbps}
            onChange={(e) => onChange({ ...form, upload_mbps: Number(e.target.value) })}
          />
        </CompactField>
        <CompactField label="Data cap" hint="0 = unlimited">
          <div className="flex max-w-48 gap-2">
            <Input
              className={cn(compactControl, "min-w-0 flex-1")}
              type="number"
              min={0}
              step={capUnit === "gb" ? "0.5" : "1"}
              value={shownCap(form.bundle_mb, capUnit)}
              onChange={(e) => onChange({ ...form, bundle_mb: mbFromInput(Number(e.target.value), capUnit) })}
            />
            <Select
              className={cn(compactControl, "w-20 shrink-0")}
              aria-label="Data cap unit"
              value={capUnit}
              onChange={(e) => onCapUnit(e.target.value as CapUnit)}
            >
              <option value="mb">MB</option>
              <option value="gb">GB</option>
            </Select>
          </div>
        </CompactField>
        <CompactField label="Price" error={fieldErrors.price_kes}>
          <AffixInput
            type="number"
            min={0}
            suffix="KES"
            aria-invalid={Boolean(fieldErrors.price_kes)}
            value={form.price_kes}
            onChange={(e) => onChange({ ...form, price_kes: Number(e.target.value) })}
          />
        </CompactField>
        {hotspot ? (
          <CompactField label="Duration" error={fieldErrors.duration_value} hint="Access time after payment">
            <div className="flex max-w-56 gap-2">
              <Input
                className={cn(compactControl, "min-w-0 flex-1")}
                type="number"
                min={1}
                step="1"
                aria-invalid={Boolean(fieldErrors.duration_value)}
                value={form.duration_value}
                onChange={(e) => onChange({ ...form, duration_value: Number(e.target.value) })}
              />
              <Select
                className={cn(compactControl, "w-28 shrink-0")}
                aria-label="Duration unit"
                value={form.duration_unit}
                onChange={(e) => onChange({ ...form, duration_unit: e.target.value as HotspotDurationUnit })}
              >
                {HOTSPOT_DURATION_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </Select>
            </div>
          </CompactField>
        ) : (
          <>
            <CompactField label="Billing duration">
              <Select
                className={cn(compactControl, "max-w-44")}
                value={form.billing_interval}
                onChange={(e) => onChange({ ...form, billing_interval: e.target.value })}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </CompactField>
            <CompactField label="Duration" hint="0 uses the billing duration">
              <div className="flex max-w-48 gap-2">
                <Input
                  className={cn(compactControl, "min-w-0 flex-1")}
                  type="number"
                  min={0}
                  step={validityUnit === "days" ? "0.5" : "1"}
                  value={shownValidity(form.validity_hours, validityUnit)}
                  onChange={(e) =>
                    onChange({ ...form, validity_hours: hoursFromInput(Number(e.target.value), validityUnit) })
                  }
                />
                <Select
                  className={cn(compactControl, "w-20 shrink-0")}
                  aria-label="Duration unit"
                  value={validityUnit}
                  onChange={(e) => onValidityUnit(e.target.value as ValidityUnit)}
                >
                  <option value="hours">Hours</option>
                  <option value="days">Days</option>
                </Select>
              </div>
            </CompactField>
            <CompactField label="Grace period" error={fieldErrors.grace_days}>
              <AffixInput
                type="number"
                min={0}
                suffix="days"
                aria-invalid={Boolean(fieldErrors.grace_days)}
                value={form.grace_days}
                onChange={(e) => onChange({ ...form, grace_days: Number(e.target.value) })}
              />
            </CompactField>
          </>
        )}
        {editing || hotspot ? (
          <CompactField label="Status">
            <Select
              className={cn(compactControl, "max-w-44")}
              value={form.active ? "active" : "inactive"}
              onChange={(e) => onChange({ ...form, active: e.target.value === "active" })}
            >
              <option value="active">Active</option>
              <option value="inactive">Disabled</option>
            </Select>
          </CompactField>
        ) : null}
        {hotspot ? null : (
          <CompactField label="Customer tier">
            <Select
              className={cn(compactControl, "max-w-44")}
              value={form.tier}
              onChange={(e) => onChange({ ...form, tier: e.target.value })}
            >
              <option value="residential">Residential</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </Select>
          </CompactField>
        )}
        <CompactField label="Description" className="col-span-2 lg:col-span-3">
          <Input
            className={cn(compactControl, "max-w-xl")}
            value={form.description}
            onChange={(e) => onChange({ ...form, description: e.target.value })}
          />
        </CompactField>
        {!hotspot && credit ? (
          <>
            <p className="col-span-2 pt-1 text-xs font-medium tracking-wide text-muted lg:col-span-3">Business credit</p>
            <CompactField label="Business credit">
              <Select
                className={cn(compactControl, "max-w-56")}
                value={form.business_credit_enabled ? "on" : "off"}
                onChange={(e) => onChange({ ...form, business_credit_enabled: e.target.value === "on" })}
              >
                <option value="off">Off — expire like residential</option>
                <option value="on">On — stay online until the limit</option>
              </Select>
            </CompactField>
            <CompactField
              label="Maximum credit"
              warn={form.business_credit_enabled && form.max_credit_kes <= 0 ? "Set a maximum. Unlimited credit is never granted." : undefined}
            >
              <AffixInput
                type="number"
                min={0}
                suffix="KES"
                value={form.max_credit_kes}
                onChange={(e) => onChange({ ...form, max_credit_kes: Number(e.target.value) })}
              />
            </CompactField>
            <CompactField label="Warning threshold">
              <AffixInput
                type="number"
                min={0}
                suffix="KES"
                value={form.credit_warning_kes}
                onChange={(e) => onChange({ ...form, credit_warning_kes: Number(e.target.value) })}
              />
            </CompactField>
            <CompactField label="Disconnect at limit">
              <Select
                className={cn(compactControl, "max-w-56")}
                value={form.disconnect_when_credit_reached ? "yes" : "no"}
                onChange={(e) => onChange({ ...form, disconnect_when_credit_reached: e.target.value === "yes" })}
              >
                <option value="yes">Yes — suspend at the limit</option>
                <option value="no">No — stop new credit, keep access</option>
              </Select>
            </CompactField>
            <CompactField label="Continue after expiry">
              <Select
                className={cn(compactControl, "max-w-56")}
                value={form.allow_service_continuity_after_expiry ? "yes" : "no"}
                onChange={(e) => onChange({ ...form, allow_service_continuity_after_expiry: e.target.value === "yes" })}
              >
                <option value="yes">Yes — stay online below the limit</option>
                <option value="no">No — expire on the billed period</option>
              </Select>
            </CompactField>
            <CompactField label="Credit warning SMS">
              <Select
                className={cn(compactControl, "max-w-56")}
                value={form.send_credit_limit_warning ? "yes" : "no"}
                onChange={(e) => onChange({ ...form, send_credit_limit_warning: e.target.value === "yes" })}
              >
                <option value="yes">Send a warning before the limit</option>
                <option value="no">Do not warn</option>
              </Select>
            </CompactField>
            <CompactField label="Credit days limit" hint="0 = none">
              <AffixInput
                type="number"
                min={0}
                suffix="days"
                value={form.credit_days_limit}
                onChange={(e) => onChange({ ...form, credit_days_limit: Number(e.target.value) })}
              />
            </CompactField>
            <CompactField label="Credit terms notes" className="col-span-2">
              <Input
                className={cn(compactControl, "max-w-xl")}
                value={form.credit_terms_notes}
                onChange={(e) => onChange({ ...form, credit_terms_notes: e.target.value })}
              />
            </CompactField>
          </>
        ) : null}
        {error ? (
          <p className="col-span-2 text-sm text-danger lg:col-span-3" role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

export function PackageToolbar({
  query,
  access,
  status,
  sort,
  view,
  pageSize,
  canManage,
  onQuery,
  onAccess,
  onStatus,
  onSort,
  onView,
  onPageSize,
  onCreate,
}: {
  query: string;
  access: PackagesAccessFilter;
  status: PackagesStatusFilter;
  sort: PackagesSort;
  view: PackagesView;
  pageSize: number;
  canManage: boolean;
  onQuery: (value: string) => void;
  onAccess: (value: PackagesAccessFilter) => void;
  onStatus: (value: PackagesStatusFilter) => void;
  onSort: (value: PackagesSort) => void;
  onView: (value: PackagesView) => void;
  onPageSize: (value: number) => void;
  onCreate: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Packages</h1>
          <p className="text-sm text-muted">PPPoE, static IP, and hotspot plans.</p>
        </div>
        {canManage ? <Button onClick={onCreate}>Create package</Button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs min-w-48 flex-1 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" strokeWidth={1.75} />
          <Input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="Search by name"
            className="h-9 pl-9 pr-9"
            aria-label="Search packages by name"
          />
          {query ? (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-1 top-1/2 inline-flex size-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-elevated hover:text-fg"
            >
              <X className="size-4" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <Select
          aria-label="Filter by access type"
          className="h-9 w-36"
          value={access}
          onChange={(e) => onAccess(e.target.value as PackagesAccessFilter)}
        >
          <option value="all">All access</option>
          <option value="pppoe">PPPoE</option>
          <option value="static">Static IP</option>
          <option value="hotspot">Hotspot</option>
        </Select>
        <Select
          aria-label="Filter by status"
          className="h-9 w-36"
          value={status}
          onChange={(e) => onStatus(e.target.value as PackagesStatusFilter)}
        >
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Disabled</option>
        </Select>
        <Select
          aria-label="Sort packages"
          className="h-9 w-40"
          value={sort}
          onChange={(e) => onSort(e.target.value as PackagesSort)}
        >
          <option value="price">Sort: price</option>
          <option value="name">Sort: name</option>
          <option value="duration">Sort: duration</option>
          <option value="speed">Sort: speed</option>
        </Select>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-1" role="group" aria-label="Package view">
            <button
              type="button"
              aria-pressed={view === "card"}
              aria-label="Card view"
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-md",
                view === "card" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => onView("card")}
            >
              <LayoutGrid className="size-4" strokeWidth={1.75} />
            </button>
            <button
              type="button"
              aria-pressed={view === "list"}
              aria-label="List view"
              className={cn(
                "inline-flex size-9 items-center justify-center rounded-md",
                view === "list" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
              )}
              onClick={() => onView("list")}
            >
              <List className="size-4" strokeWidth={1.75} />
            </button>
          </div>
          <Select
            aria-label="Packages per page"
            className="h-9 w-28"
            value={String(pageSize)}
            onChange={(e) => onPageSize(Number(e.target.value))}
          >
            {PACKAGE_PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n} / page
              </option>
            ))}
          </Select>
        </div>
      </div>
    </div>
  );
}

function PackageActions({
  pkg,
  canManage,
  onEdit,
  onToggle,
}: {
  pkg: PackageRow;
  canManage: boolean;
  onEdit: (pkg: PackageRow) => void;
  onToggle: (pkg: PackageRow) => void;
}) {
  if (!canManage) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="icon" variant="ghost" aria-label={`Actions for ${pkg.name}`} className="size-11 shrink-0">
          <MoreHorizontal className="size-4" strokeWidth={1.75} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{pkg.name}</DropdownMenuLabel>
        <DropdownMenuItem onSelect={() => onEdit(pkg)}>Edit</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onToggle(pkg)}>{pkg.active ? "Disable" : "Enable"}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PackageMeta({ pkg }: { pkg: PackageRow }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      <Badge tone="accent">{accessMethodLabel(pkg.access_method)}</Badge>
      <Badge tone={statusTone(pkg.active ? "active" : "disabled")}>{pkg.active ? "active" : "disabled"}</Badge>
      {pkg.access_method === "hotspot" ? null : pkg.tier && pkg.tier !== "residential" ? (
        <Badge tone="ok">{tierLabel(pkg.tier)}</Badge>
      ) : null}
      {pkg.access_method === "hotspot" || !pkg.business_credit_enabled ? null : (
        <Badge tone={pkg.max_credit_kes && pkg.max_credit_kes > 0 ? "warn" : "danger"}>
          {pkg.max_credit_kes && pkg.max_credit_kes > 0 ? `Credit ${kes(pkg.max_credit_kes)}` : "Credit not set"}
        </Badge>
      )}
    </div>
  );
}

export function PackageCards({
  rows,
  canManage,
  onEdit,
  onToggle,
}: {
  rows: PackageRow[];
  canManage: boolean;
  onEdit: (pkg: PackageRow) => void;
  onToggle: (pkg: PackageRow) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((p) => (
        <article key={p.id} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium">{p.name}</div>
              <PackageMeta pkg={p} />
            </div>
            <div className="font-mono text-sm tabular-nums">{kes(p.price_kes)}</div>
          </div>
          <p className="mt-3 text-sm text-muted">
            {speedLabel(p.download_mbps, p.upload_mbps)} · {durationLabel(p.validity_hours, p.billing_interval, p)}
            {p.access_method === "hotspot" ? null : ` · ${graceLabel(p.grace_days)} grace`} · {capLabel(p.bundle_mb)}
          </p>
          {p.description ? <p className="mt-1 text-sm text-subtle">{p.description}</p> : null}
          {canManage ? (
            <div className="mt-3 flex justify-end">
              <PackageActions pkg={p} canManage={canManage} onEdit={onEdit} onToggle={onToggle} />
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function PackageTable({
  rows,
  canManage,
  onEdit,
  onToggle,
}: {
  rows: PackageRow[];
  canManage: boolean;
  onEdit: (pkg: PackageRow) => void;
  onToggle: (pkg: PackageRow) => void;
}) {
  return (
    <div className="min-w-0 overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full min-w-xl text-left text-sm md:min-w-4xl">
        <thead className="text-xs text-muted">
          <tr className="border-b border-border">
            <th className="px-3 py-2 font-medium">Package</th>
            <th className="px-3 py-2 font-medium">Speed</th>
            <th className="px-3 py-2 font-medium">Price</th>
            <th className="px-3 py-2 font-medium">Duration</th>
            <th className="hidden px-3 py-2 font-medium md:table-cell">Grace</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">Access</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="w-12 px-2 py-2" aria-label="Actions" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((p) => (
            <tr key={p.id} className="hover:bg-elevated/60">
              <td className="px-3 py-2">
                <div className="font-medium">{p.name}</div>
                {p.description ? <div className="max-w-64 truncate text-xs text-muted">{p.description}</div> : null}
              </td>
              <td className="px-3 py-2 tabular-nums">{speedLabel(p.download_mbps, p.upload_mbps)}</td>
              <td className="px-3 py-2 font-mono tabular-nums">{kes(p.price_kes)}</td>
              <td className="px-3 py-2">{durationLabel(p.validity_hours, p.billing_interval, p)}</td>
              <td className="hidden px-3 py-2 md:table-cell">
                {p.access_method === "hotspot" ? "—" : graceLabel(p.grace_days)}
              </td>
              <td className="hidden px-3 py-2 sm:table-cell">{accessMethodLabel(p.access_method)}</td>
              <td className="px-3 py-2">
                <Badge tone={statusTone(p.active ? "active" : "disabled")}>{p.active ? "active" : "disabled"}</Badge>
              </td>
              <td className="px-2 py-1 text-right">
                <PackageActions pkg={p} canManage={canManage} onEdit={onEdit} onToggle={onToggle} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PackagePagination({
  page,
  pages,
  from,
  to,
  total,
  onPage,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
      <p>
        {from}–{to} of {total}
        <span className="sr-only">
          Page {page} of {pages}
        </span>
      </p>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" strokeWidth={1.75} />
          Previous
        </Button>
        <span className="min-w-16 px-1 text-center tabular-nums" aria-live="polite">
          {page} / {pages}
        </span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          Next
          <ChevronRight className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

export function PackageEmpty({
  filtered,
  canManage,
  onCreate,
}: {
  filtered: boolean;
  canManage: boolean;
  onCreate: () => void;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface px-4 py-10 text-center">
      <p className="font-medium">{filtered ? "No packages match these filters." : "No packages yet."}</p>
      <p className="mt-1 text-sm text-muted">
        {filtered
          ? "Clear search or change access and status to see more plans."
          : canManage
            ? "Create a package to sell PPPoE, static IP, or hotspot access."
            : "Packages will appear here when they are published."}
      </p>
      {!filtered && canManage ? (
        <Button className="mt-4" onClick={onCreate}>
          Create package
        </Button>
      ) : null}
    </div>
  );
}

export function PackageSkeleton() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" aria-label="Loading packages">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="h-32 animate-pulse rounded-xl bg-surface" />
      ))}
    </div>
  );
}

export function ConfirmPackageStatusDialog({
  pkg,
  busy,
  onOpenChange,
  onConfirm,
}: {
  pkg: PackageRow | null;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const disabling = Boolean(pkg?.active);
  return (
    <Dialog
      open={Boolean(pkg)}
      onOpenChange={onOpenChange}
      title={disabling ? "Disable package" : "Enable package"}
      description={
        pkg
          ? disabling
            ? `${pkg.name} will be hidden from new services. Existing customers keep the plan until it is changed.`
            : `${pkg.name} will be available for new services.`
          : undefined
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant={disabling ? "danger" : "default"} disabled={busy} onClick={onConfirm}>
            {busy ? "Saving…" : disabling ? "Disable" : "Enable"}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted">{disabling ? "This does not disconnect customers on the plan." : "The plan can be assigned again."}</p>
    </Dialog>
  );
}

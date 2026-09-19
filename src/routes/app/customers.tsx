import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CounterButton,
  CustomerPreview,
  DeskCards,
  DeskFilterBar,
  DeskOverflowMenu,
  DeskPagination,
  DeskSearch,
  DeskSkeleton,
  DeskTable,
  MobileFilterButton,
  type DeskActions,
  type DeskPerms,
} from "@/components/isp/customer-desk-ui";
import { Communications } from "@/components/isp/communications";
import { OnboardWizard } from "@/components/isp/onboard-wizard";
import { TagPicker } from "@/components/isp/tag-picker";
import { TrafficDrawer } from "@/components/isp/traffic-drawer";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import {
  EMPTY_DESK_FILTERS,
  selectedCustomersCsv,
  uniqueSmsRecipients,
  type DeskCustomer,
  type DeskFilters,
} from "@/lib/isp/customer-desk-format";
import { hasPermission } from "@/lib/isp/rbac";
import { queryCustomersDeskFn } from "@/lib/isp/server-desk";
import { deleteCustomerFn, getCustomerFn } from "@/lib/isp/server-lifecycle";
import { createCustomer, exportCustomersCsv, setServiceStatus, updateCustomer } from "@/lib/isp/server";
import { broadcastCustomersFn, bulkCustomerTagsFn, setCustomerTagsFn } from "@/lib/isp/server-tags";
import { cn } from "@/lib/utils";

type PageTab = "customers" | "communications";

type Search = {
  tab?: PageTab;
  q?: string;
  customer?: DeskFilters["customerStatus"];
  service?: DeskFilters["serviceStatus"];
  access?: DeskFilters["access"];
  pkg?: string;
  location?: string;
  billing?: DeskFilters["billing"];
  expiring?: boolean;
  grace?: boolean;
  overdue?: boolean;
  tags?: string;
  tagMode?: DeskFilters["tagMode"];
  page?: number;
};

type DeskPayload = Awaited<ReturnType<typeof queryCustomersDeskFn>>;
type PreviewRecord = Awaited<ReturnType<typeof getCustomerFn>>;

const EMPTY_FORM = {
  name: "",
  phone: "",
  email: "",
  address: "",
  type: "individual",
  portal_password: "",
  tag_ids: [] as string[],
  account_number: "",
  notes: "",
};

function parseTags(raw?: string) {
  return (raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function searchToFilters(search: Search): DeskFilters {
  return {
    ...EMPTY_DESK_FILTERS,
    q: search.q || "",
    customerStatus: search.customer || "all",
    serviceStatus: search.service || "all",
    access: search.access || "all",
    packageName: search.pkg || "",
    location: search.location || "",
    billing: search.billing || "all",
    expiringSoon: Boolean(search.expiring),
    onGrace: Boolean(search.grace),
    overdue: Boolean(search.overdue) || search.billing === "overdue",
    tagIds: parseTags(search.tags),
    tagMode: search.tagMode === "all" ? "all" : "any",
    page: Math.max(1, search.page || 1),
  };
}

function filtersToSearch(tab: PageTab, filters: DeskFilters): Search {
  return {
    tab: tab === "communications" ? "communications" : undefined,
    q: filters.q || undefined,
    customer: filters.customerStatus === "all" ? undefined : filters.customerStatus,
    service: filters.serviceStatus === "all" ? undefined : filters.serviceStatus,
    access: filters.access === "all" ? undefined : filters.access,
    pkg: filters.packageName || undefined,
    location: filters.location || undefined,
    billing: filters.billing === "all" ? undefined : filters.billing,
    expiring: filters.expiringSoon || undefined,
    grace: filters.onGrace || undefined,
    overdue: filters.overdue || undefined,
    tags: filters.tagIds.length ? filters.tagIds.join(",") : undefined,
    tagMode: filters.tagIds.length && filters.tagMode === "all" ? "all" : undefined,
    page: filters.page > 1 ? filters.page : undefined,
  };
}

export const Route = createFileRoute("/app/customers")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    tab: search.tab === "communications" ? "communications" : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    customer:
      search.customer === "active" || search.customer === "inactive" || search.customer === "suspended"
        ? search.customer
        : undefined,
    service:
      search.service === "active" ||
      search.service === "expired" ||
      search.service === "grace" ||
      search.service === "suspended" ||
      search.service === "pending" ||
      search.service === "terminated"
        ? search.service
        : undefined,
    access: search.access === "pppoe" || search.access === "static" || search.access === "hotspot" ? search.access : undefined,
    pkg: typeof search.pkg === "string" ? search.pkg : undefined,
    location: typeof search.location === "string" ? search.location : undefined,
    billing: search.billing === "clear" || search.billing === "due" || search.billing === "overdue" ? search.billing : undefined,
    expiring: search.expiring === true || search.expiring === "true" ? true : undefined,
    grace: search.grace === true || search.grace === "true" ? true : undefined,
    overdue: search.overdue === true || search.overdue === "true" ? true : undefined,
    tags: typeof search.tags === "string" ? search.tags : undefined,
    tagMode: search.tagMode === "all" ? "all" : undefined,
    page: typeof search.page === "number" ? search.page : typeof search.page === "string" ? Number(search.page) || undefined : undefined,
  }),
  component: CustomersRoute,
});

function CustomersRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/app/customers") return <Outlet />;
  return <CustomersPage />;
}

function CustomersPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const filters = useMemo(() => searchToFilters(search), [search]);
  const tab: PageTab = search.tab === "communications" ? "communications" : "customers";

  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftQ, setDraftQ] = useState(filters.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [openForm, setOpenForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [onboardCustomer, setOnboardCustomer] = useState<DeskCustomer | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"tags-add" | "tags-remove" | "sms" | "notify" | null>(null);
  const [bulkTags, setBulkTags] = useState<string[]>([]);
  const [bulkSubject, setBulkSubject] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [trafficFor, setTrafficFor] = useState<DeskCustomer | null>(null);
  const [previewFor, setPreviewFor] = useState<DeskCustomer | null>(null);
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [deleteFor, setDeleteFor] = useState<DeskCustomer | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteServices, setDeleteServices] = useState(false);
  const [tagFor, setTagFor] = useState<DeskCustomer | null>(null);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [messageFor, setMessageFor] = useState<DeskCustomer | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  function patchSearch(next: Partial<DeskFilters>, nextTab: PageTab = tab) {
    const merged = { ...filters, ...next };
    void navigate({ search: filtersToSearch(nextTab, merged), replace: true });
  }

  async function loadDesk(nextFilters = filters) {
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await queryCustomersDeskFn({
        data: {
          q: nextFilters.q,
          customerStatus: nextFilters.customerStatus,
          serviceStatus: nextFilters.serviceStatus,
          access: nextFilters.access,
          packageName: nextFilters.packageName,
          location: nextFilters.location,
          billing: nextFilters.billing,
          expiringSoon: nextFilters.expiringSoon,
          onGrace: nextFilters.onGrace,
          overdue: nextFilters.overdue,
          tagIds: nextFilters.tagIds,
          tagMode: nextFilters.tagMode,
          page: nextFilters.page,
          pageSize: nextFilters.pageSize,
        },
      });
      if (id !== requestRef.current) return;
      setDesk(res);
      setSelected((prev) => {
        const ids = new Set(res.customers.map((c) => c.id));
        return new Set([...prev].filter((id) => ids.has(id)));
      });
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load customers");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setDraftQ(filters.q);
    void loadDesk(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search.q, search.customer, search.service, search.access, search.pkg, search.location, search.billing, search.expiring, search.grace, search.overdue, search.tags, search.tagMode, search.page]);

  useEffect(() => {
    if (!previewFor) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewErr(null);
    getCustomerFn({ data: { id: previewFor.id } })
      .then((rec) => {
        setPreview(rec);
        setPreviewLoading(false);
      })
      .catch((err) => {
        setPreview(null);
        setPreviewErr(err instanceof Error ? err.message : "Could not load customer");
        setPreviewLoading(false);
      });
  }, [previewFor]);

  const role = desk?.workspace.role || "";
  const canManage = hasPermission(role, "customers.manage");
  const canDelete = hasPermission(role, "customers.delete") || canManage;
  const canServices = hasPermission(role, "services.manage");
  const canStatements = hasPermission(role, "invoices.read");
  const canComms = hasPermission(role, "communications.view");
  const canTraffic = hasPermission(role, "traffic.view") || hasPermission(role, "services.read");
  const canRecycle = hasPermission(role, "recycle_bin.view");
  const activeTab: PageTab = tab === "communications" && canComms ? "communications" : "customers";

  const rows = desk?.customers ?? [];
  const selectedRows = rows.filter((c) => selected.has(c.id));
  const allSelected = rows.length > 0 && rows.every((c) => selected.has(c.id));
  const smsPlan = uniqueSmsRecipients(selectedRows);
  const perms: DeskPerms = { canManage, canDelete, canServices, canStatements, canTraffic, canComms };
  const actions: DeskActions = {
    onPreview: setPreviewFor,
    onEdit: startEdit,
    onTraffic: setTrafficFor,
    onTags: (c) => {
      setTagFor(c);
      setTagIds(c.tags.map((t) => t.id));
    },
    onMessage: setMessageFor,
    onSuspend: (c) => void changeLines(c, "suspended"),
    onRestore: (c) => void changeLines(c, "active"),
    onDelete: (c) => {
      setDeleteFor(c);
      setDeleteReason("");
      setDeleteServices(false);
    },
  };

  function startCreate() {
    setOnboardCustomer(null);
    setOnboardOpen(true);
  }

  function startAddService(c?: DeskCustomer) {
    setOnboardCustomer(c ?? (selectedRows.length === 1 ? selectedRows[0] : null));
    setOnboardOpen(true);
  }

  function startEdit(c: DeskCustomer) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email,
      address: c.address,
      type: c.type,
      portal_password: "",
      tag_ids: c.tags.map((t) => t.id),
      account_number: c.account_number || "",
      notes: c.notes || "",
    });
    setOpenForm(true);
    setPreviewFor(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (editingId) {
        await updateCustomer({
          data: {
            id: editingId,
            name: form.name,
            phone: form.phone,
            email: form.email,
            address: form.address,
            type: form.type,
            tag_ids: form.tag_ids,
            notes: form.notes,
          },
        });
      } else {
        await createCustomer({
          data: {
            name: form.name,
            phone: form.phone,
            email: form.email,
            address: form.address,
            type: form.type,
            portal_password: form.portal_password || undefined,
            tag_ids: form.tag_ids,
            notes: form.notes,
          },
        });
      }
      setOpenForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadDesk(filters);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not save customer");
    } finally {
      setBusy(false);
    }
  }

  async function changeLines(c: DeskCustomer, status: "active" | "suspended") {
    const ids = status === "suspended" ? c.live_service_ids : c.suspended_service_ids;
    if (!ids.length) return;
    const verb = status === "suspended" ? "Suspend" : "Restore";
    if (!window.confirm(`${verb} ${ids.length} service${ids.length === 1 ? "" : "s"} for ${c.name}?`)) return;
    setBusy(true);
    try {
      for (const id of ids) await setServiceStatus({ data: { id, status } });
      await loadDesk(filters);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Could not update services");
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    if (!selectedRows.length) return;
    setBusy(true);
    setBulkNote(null);
    try {
      if (bulk === "tags-add" || bulk === "tags-remove") {
        const res = await bulkCustomerTagsFn({
          data: { customer_ids: selectedRows.map((c) => c.id), tag_ids: bulkTags, op: bulk === "tags-add" ? "add" : "remove" },
        });
        setBulkNote(`${bulk === "tags-add" ? "Assigned" : "Removed"} on ${res.customers} customers.`);
      } else if (bulk === "sms" || bulk === "notify") {
        const ids = bulk === "sms" ? smsPlan.recipients.map((r) => r.id) : selectedRows.map((c) => c.id);
        if (bulk === "sms" && !ids.length) throw new Error("None of the selected customers have a valid mobile number.");
        if (bulk === "sms" && !window.confirm(`Queue SMS for ${ids.length} recipient${ids.length === 1 ? "" : "s"}? ${smsPlan.skipped.length} skipped.`)) {
          setBusy(false);
          return;
        }
        const res = await broadcastCustomersFn({
          data: {
            customer_ids: ids,
            channels: bulk === "sms" ? ["sms"] : ["in_app"],
            subject: bulkSubject,
            body: bulkBody,
          },
        });
        setBulkNote(bulk === "sms" ? `SMS queued for ${res.sms} · failed ${res.failed}` : `Notification sent to ${res.inbox} customers`);
      }
      setBulk(null);
      setBulkTags([]);
      setBulkBody("");
      setBulkSubject("");
      await loadDesk(filters);
    } catch (err) {
      setBulkNote(err instanceof Error ? err.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    const csv = selectedRows.length ? selectedCustomersCsv(selectedRows) : await exportCustomersCsv();
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedRows.length ? "ispsolutions-customers-selected.csv" : "ispsolutions-customers.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onSearchChange(value: string) {
    setDraftQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      patchSearch({ q: value, page: 1 });
    }, 300);
  }

  const counters = desk?.counters ?? { total: 0, active: 0, suspended: 0, overdue: 0 };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="text-sm text-muted">
            {activeTab === "communications"
              ? "Bulk SMS alerts and announcements to the right group of customers."
              : "Manage customers, services, billing and account activity."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeTab === "customers" ? (
            <>
              <DeskOverflowMenu canRecycle={canRecycle} selectedCount={selectedRows.length} onExport={() => void exportSelected()} />
              {canManage ? <Button onClick={startCreate}>Add customer</Button> : null}
            </>
          ) : canRecycle ? (
            <Link
              to="/app/recycle-bin"
              className="inline-flex h-11 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium hover:bg-surface"
            >
              Recycle Bin
            </Link>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Customer sections"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {(
          [
            ["customers", "Customers"],
            ...(canComms ? [["communications", "Communications"] as const] : []),
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              activeTab === id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => patchSearch({}, id)}
          >
            {label}
          </button>
        ))}
      </div>

      {activeTab === "communications" ? <Communications /> : null}

      {activeTab === "customers" ? (
        <>
          <div className="flex flex-wrap gap-2">
            <CounterButton
              label="Total"
              value={counters.total}
              active={filters.customerStatus === "all" && !filters.overdue}
              onClick={() => patchSearch({ ...EMPTY_DESK_FILTERS, q: filters.q, page: 1 })}
            />
            <CounterButton
              label="Active"
              value={counters.active}
              active={filters.customerStatus === "active"}
              onClick={() => patchSearch({ customerStatus: filters.customerStatus === "active" ? "all" : "active", page: 1 })}
            />
            <CounterButton
              label="Suspended"
              value={counters.suspended}
              active={filters.customerStatus === "suspended"}
              onClick={() => patchSearch({ customerStatus: filters.customerStatus === "suspended" ? "all" : "suspended", page: 1 })}
            />
            <CounterButton
              label="Overdue"
              value={counters.overdue}
              active={filters.overdue || filters.billing === "overdue"}
              onClick={() =>
                patchSearch({
                  overdue: !(filters.overdue || filters.billing === "overdue"),
                  billing: filters.overdue || filters.billing === "overdue" ? "all" : "overdue",
                  page: 1,
                })
              }
            />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="min-w-0 flex-1">
              <DeskSearch
                value={draftQ}
                onChange={onSearchChange}
                onClear={() => {
                  setDraftQ("");
                  patchSearch({ q: "", page: 1 });
                }}
                loading={loading && Boolean(draftQ)}
              />
            </div>
            <MobileFilterButton
              open={filterOpen}
              onOpenChange={setFilterOpen}
              filters={filters}
              packages={desk?.packages ?? []}
              locations={desk?.locations ?? []}
              tags={desk?.tags ?? []}
              onChange={(next) => patchSearch(next)}
              onClear={() => patchSearch({ ...EMPTY_DESK_FILTERS, q: filters.q, page: 1 })}
            />
          </div>

          <DeskFilterBar
            filters={filters}
            packages={desk?.packages ?? []}
            locations={desk?.locations ?? []}
            tags={desk?.tags ?? []}
            matching={desk?.total ?? 0}
            onChange={(next) => patchSearch(next)}
            onClear={() => patchSearch({ ...EMPTY_DESK_FILTERS, q: filters.q, page: 1 })}
          />

          {canManage && selectedRows.length ? (
            <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">
                  {selectedRows.length} selected on this page
                  {bulk === "sms" ? ` · ${smsPlan.recipients.length} valid mobile${smsPlan.recipients.length === 1 ? "" : "s"} · ${smsPlan.skipped.length} skipped` : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant={bulk === "tags-add" ? "default" : "secondary"} onClick={() => setBulk("tags-add")}>
                    Assign tags
                  </Button>
                  <Button size="sm" variant={bulk === "tags-remove" ? "default" : "secondary"} onClick={() => setBulk("tags-remove")}>
                    Remove tags
                  </Button>
                  <Button size="sm" variant={bulk === "sms" ? "default" : "secondary"} onClick={() => setBulk("sms")}>
                    Send SMS
                  </Button>
                  <Button size="sm" variant={bulk === "notify" ? "default" : "secondary"} onClick={() => setBulk("notify")}>
                    Send notification
                  </Button>
                  {canServices && selectedRows.length === 1 ? (
                    <Button size="sm" variant="secondary" onClick={() => startAddService(selectedRows[0])}>
                      Add service
                    </Button>
                  ) : null}
                  {canServices ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        const n = selectedRows.reduce((sum, c) => sum + c.live_service_ids.length, 0);
                        if (!n) return;
                        if (!window.confirm(`Suspend ${n} live service${n === 1 ? "" : "s"} on ${selectedRows.length} customers?`)) return;
                        void (async () => {
                          setBusy(true);
                          try {
                            for (const c of selectedRows) {
                              for (const id of c.live_service_ids) await setServiceStatus({ data: { id, status: "suspended" } });
                            }
                            await loadDesk(filters);
                          } finally {
                            setBusy(false);
                          }
                        })();
                      }}
                    >
                      Suspend
                    </Button>
                  ) : null}
                  <Button size="sm" variant="secondary" onClick={() => void exportSelected()}>
                    Export selected
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelected(new Set());
                      setBulk(null);
                    }}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              {bulk === "tags-add" || bulk === "tags-remove" ? (
                <div className="space-y-3">
                  <TagPicker tags={desk?.tags ?? []} selected={bulkTags} onChange={setBulkTags} />
                  <Button disabled={busy || !bulkTags.length} onClick={() => void runBulk()}>
                    {bulk === "tags-add" ? "Assign to selected" : "Remove from selected"}
                  </Button>
                </div>
              ) : null}
              {bulk === "sms" || bulk === "notify" ? (
                <div className="grid gap-3 md:max-w-xl">
                  {bulk === "sms" ? (
                    <p className="text-sm text-muted">
                      SMS will be queued for {smsPlan.recipients.length} of {selectedRows.length} selected.
                      {smsPlan.skipped.length ? ` ${smsPlan.skipped.length} skipped (missing, invalid, or duplicate numbers).` : ""}
                    </p>
                  ) : null}
                  {bulk === "notify" ? (
                    <Field label="Subject">
                      <Input value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} />
                    </Field>
                  ) : null}
                  <Field label={bulk === "sms" ? "SMS" : "Message"}>
                    <Textarea value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} required />
                  </Field>
                  <Button disabled={busy || !bulkBody.trim() || (bulk === "sms" && !smsPlan.recipients.length)} onClick={() => void runBulk()}>
                    {bulk === "sms" ? `Send SMS to ${smsPlan.recipients.length}` : `Notify ${selectedRows.length}`}
                  </Button>
                </div>
              ) : null}
              {bulkNote ? <p className="text-sm text-accent">{bulkNote}</p> : null}
            </div>
          ) : null}

          {canManage && openForm && editingId ? (
            <form onSubmit={submit} className="grid gap-3 rounded-xl bg-surface p-5 shadow-card md:grid-cols-2 md:p-6">
              <h2 className="font-medium md:col-span-2">Edit customer</h2>
              <Field label="Name">
                <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="Type">
                <Select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="individual">Individual</option>
                  <option value="business">Business</option>
                </Select>
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Address / location">
                <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </Field>
              <Field label="ID">
                <Input value={form.account_number || "—"} readOnly />
              </Field>
              {!editingId ? (
                <div className="md:col-span-2 grid gap-1.5">
                  <Field label="Portal password (optional)">
                    <Input
                      type="password"
                      minLength={8}
                      value={form.portal_password}
                      onChange={(e) => setForm({ ...form, portal_password: e.target.value })}
                      placeholder="Leave blank to use the phone number"
                    />
                  </Field>
                  <p className="text-xs text-muted">
                    First login uses the customer phone as username and password. They can change it later from the portal.
                  </p>
                </div>
              ) : null}
              <div className="md:col-span-2">
                <Field label="Tags">
                  <TagPicker tags={desk?.tags ?? []} selected={form.tag_ids} onChange={(tag_ids) => setForm({ ...form, tag_ids })} />
                </Field>
              </div>
              <div className="md:col-span-2">
                <Field label="Notes">
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                </Field>
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" disabled={busy}>
                  Save
                </Button>
                <Button type="button" variant="ghost" onClick={() => setOpenForm(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}

          {error ? (
            <div className="space-y-2">
              <p className="text-sm text-danger">{error}</p>
              <Button variant="secondary" onClick={() => void loadDesk(filters)}>
                Try again
              </Button>
            </div>
          ) : loading && !desk ? (
            <DeskSkeleton />
          ) : !counters.total ? (
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="font-medium">No customers yet</p>
              <p className="mt-1 text-sm text-muted">Add a customer, or import a CSV of existing accounts.</p>
              {canManage ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button onClick={startCreate}>Add customer</Button>
                  <Link to="/app/import" className="inline-flex h-11 items-center text-sm text-accent hover:underline">
                    Import customers
                  </Link>
                </div>
              ) : null}
            </div>
          ) : rows.length === 0 ? (
            <div className="rounded-xl border border-border bg-surface p-6">
              <p className="font-medium">{filters.q ? "No search results" : "No customers match these filters"}</p>
              <p className="mt-1 text-sm text-muted">Deleted and archived accounts stay in the Recycle Bin.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {filters.q ? (
                  <Button variant="secondary" onClick={() => { setDraftQ(""); patchSearch({ q: "", page: 1 }); }}>
                    Clear search
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={() => patchSearch({ ...EMPTY_DESK_FILTERS, page: 1 })}>
                  Clear filters
                </Button>
              </div>
            </div>
          ) : (
            <>
              <DeskTable
                rows={rows}
                selected={selected}
                allSelected={allSelected}
                onToggle={(id) => {
                  const next = new Set(selected);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setSelected(next);
                }}
                onToggleAll={() => {
                  if (allSelected) {
                    const next = new Set(selected);
                    for (const c of rows) next.delete(c.id);
                    setSelected(next);
                  } else {
                    const next = new Set(selected);
                    for (const c of rows) next.add(c.id);
                    setSelected(next);
                  }
                }}
                onPreview={setPreviewFor}
                perms={perms}
                actions={actions}
              />
              <DeskCards
                rows={rows}
                selected={selected}
                onToggle={(id) => {
                  const next = new Set(selected);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  setSelected(next);
                }}
                onPreview={setPreviewFor}
                perms={perms}
                actions={actions}
              />
              <DeskPagination
                page={desk?.page ?? 1}
                pages={desk?.pages ?? 1}
                total={desk?.total ?? 0}
                onPage={(page) => patchSearch({ page })}
              />
            </>
          )}
        </>
      ) : null}

      <OnboardWizard
        open={onboardOpen}
        onOpenChange={(next) => {
          setOnboardOpen(next);
          if (!next) setOnboardCustomer(null);
        }}
        mode={onboardCustomer ? "service" : "customer"}
        lockedCustomer={
          onboardCustomer
            ? {
                id: onboardCustomer.id,
                name: onboardCustomer.name,
                phone: onboardCustomer.phone,
                email: onboardCustomer.email,
                account_number: onboardCustomer.account_number,
                type: onboardCustomer.type,
                address: onboardCustomer.address,
              }
            : null
        }
        onCreated={(res) => {
          setOnboardOpen(false);
          setOnboardCustomer(null);
          if (res.service_id) {
            void navigate({ to: "/app/services/$serviceId", params: { serviceId: res.service_id } });
          } else {
            void navigate({ to: "/app/customers/$customerId", params: { customerId: res.customer_id } });
          }
        }}
      />

      <TrafficDrawer
        open={Boolean(trafficFor)}
        onOpenChange={(open) => {
          if (!open) setTrafficFor(null);
        }}
        customerId={trafficFor?.id || ""}
        customerName={trafficFor?.name}
      />

      <CustomerPreview
        open={Boolean(previewFor)}
        onOpenChange={(open) => {
          if (!open) setPreviewFor(null);
        }}
        loading={previewLoading}
        error={previewErr}
        customer={previewFor}
        record={preview}
        perms={perms}
        onTraffic={() => {
          if (previewFor) setTrafficFor(previewFor);
        }}
        onEdit={() => {
          if (previewFor) startEdit(previewFor);
        }}
      />

      <Dialog
        open={Boolean(deleteFor)}
        onOpenChange={(open) => {
          if (!open) setDeleteFor(null);
        }}
        title="Move customer to Recycle Bin"
        description="The customer leaves live search. Restore is available in the Recycle Bin. Invoices and payments stay."
      >
        {deleteFor ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void (async () => {
                setBusy(true);
                try {
                  await deleteCustomerFn({
                    data: {
                      id: deleteFor.id,
                      delete_services: deleteServices || deleteFor.service_count === 0,
                      confirm: true,
                      reason: deleteReason,
                    },
                  });
                  setDeleteFor(null);
                  await loadDesk(filters);
                } catch (err) {
                  window.alert(err instanceof Error ? err.message : "Could not delete customer");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {deleteFor.service_count ? (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={deleteServices}
                  onChange={(e) => setDeleteServices(e.target.checked)}
                />
                <span>
                  Also move {deleteFor.service_count} associated service{deleteFor.service_count === 1 ? "" : "s"} to the Recycle Bin.
                  Open the profile to reassign a line first.
                </span>
              </label>
            ) : (
              <p className="text-sm text-muted">This account has no live services.</p>
            )}
            <Field label="Reason">
              <Textarea required value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || !deleteReason.trim() || (deleteFor.service_count > 0 && !deleteServices)}>
                Move to Recycle Bin
              </Button>
              <Link
                to="/app/customers/$customerId"
                params={{ customerId: deleteFor.id }}
                className="inline-flex h-11 items-center text-sm text-accent hover:underline"
              >
                Open profile
              </Link>
              <Button type="button" variant="ghost" onClick={() => setDeleteFor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(tagFor)}
        onOpenChange={(open) => {
          if (!open) setTagFor(null);
        }}
        title="Customer tags"
      >
        {tagFor ? (
          <div className="space-y-3">
            <TagPicker tags={desk?.tags ?? []} selected={tagIds} onChange={setTagIds} />
            <Button
              disabled={busy}
              onClick={() => {
                void (async () => {
                  setBusy(true);
                  try {
                    await setCustomerTagsFn({ data: { customer_id: tagFor.id, tag_ids: tagIds } });
                    setTagFor(null);
                    await loadDesk(filters);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            >
              Save tags
            </Button>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(messageFor)}
        onOpenChange={(open) => {
          if (!open) setMessageFor(null);
        }}
        title="Send communication"
        description={
          messageFor
            ? uniqueSmsRecipients([messageFor]).recipients.length
              ? `SMS can be queued to ${messageFor.phone}.`
              : "This customer has no valid mobile number. In-app notification still works."
            : undefined
        }
      >
        {messageFor ? (
          <form
            className="grid gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              const body = bulkBody.trim();
              if (!body) return;
              const smsOk = uniqueSmsRecipients([messageFor]).recipients.length > 0;
              void (async () => {
                setBusy(true);
                try {
                  const res = await broadcastCustomersFn({
                    data: {
                      customer_ids: [messageFor.id],
                      channels: smsOk ? ["sms", "in_app"] : ["in_app"],
                      subject: bulkSubject,
                      body,
                    },
                  });
                  setBulkNote(smsOk ? `SMS queued ${res.sms} · inbox ${res.inbox}` : `Notification sent`);
                  setMessageFor(null);
                  setBulkBody("");
                  setBulkSubject("");
                } catch (err) {
                  window.alert(err instanceof Error ? err.message : "Could not send");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            <Field label="Subject">
              <Input value={bulkSubject} onChange={(e) => setBulkSubject(e.target.value)} />
            </Field>
            <Field label="Message">
              <Textarea required value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} />
            </Field>
            <Button type="submit" disabled={busy || !bulkBody.trim()}>
              Send
            </Button>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

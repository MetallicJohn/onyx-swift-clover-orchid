import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ExpiryEditor, type ExpiryForm } from "@/components/isp/service-expiry-editor";
import {
  CounterButton,
  MobileServiceFilters,
  ServiceCards,
  ServiceFilterBar,
  ServiceOverflowMenu,
  ServicePagination,
  ServicePreview,
  ServiceSearch,
  ServiceSkeleton,
  ServiceTable,
  type ServiceActions,
  type ServicePerms,
} from "@/components/isp/service-desk-ui";
import { TrafficDrawer } from "@/components/isp/traffic-drawer";
import { OnboardWizard } from "@/components/isp/onboard-wizard";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { uniqueSmsRecipients } from "@/lib/isp/customer-desk-format";
import { hasPermission } from "@/lib/isp/rbac";
import { extendGraceFn, grantGraceFn, revokeGraceFn } from "@/lib/isp/server-grace";
import { setServiceExpiryFn } from "@/lib/isp/server-expiry";
import { queryServicesDeskFn } from "@/lib/isp/server-desk";
import {
  disconnectService,
  retryPppoeProvisionFn,
  rotateServiceSecret,
  revealPppoePasswordFn,
  setServiceStatus,
} from "@/lib/isp/server";
import { deleteServiceFn, getServiceFn, reassignServiceFn, updateServiceFn } from "@/lib/isp/server-lifecycle";
import { broadcastCustomersFn } from "@/lib/isp/server-tags";
import {
  EMPTY_SERVICE_FILTERS,
  selectedServicesCsv,
  toServiceRow,
  type ServiceDeskFilters,
  type ServiceDeskRow,
  type ServiceDeskSort,
} from "@/lib/isp/service-desk-format";
import { openExpiryForm } from "@/lib/isp/service-expiry-format";
import type { GracePolicy } from "@/lib/isp/grace";
import type { ServiceStatus } from "@/lib/isp/types";

type Search = {
  q?: string;
  status?: ServiceDeskFilters["status"];
  access?: ServiceDeskFilters["access"];
  pkg?: string;
  customer?: string;
  location?: string;
  router?: string;
  pool?: string;
  billing?: ServiceDeskFilters["billing"];
  expiring?: boolean;
  grace?: boolean;
  overdue?: boolean;
  sort?: ServiceDeskSort;
  dir?: "asc" | "desc";
  page?: number;
};

type DeskPayload = Awaited<ReturnType<typeof queryServicesDeskFn>>;
type PreviewRecord = Awaited<ReturnType<typeof getServiceFn>>;
type Panel = { id: string; mode: "grant" | "extend" | "revoke" };

function searchToFilters(search: Search): ServiceDeskFilters {
  return {
    ...EMPTY_SERVICE_FILTERS,
    q: search.q || "",
    status: search.status || "all",
    access: search.access || "all",
    packageName: search.pkg || "",
    customerId: search.customer || "",
    location: search.location || "",
    routerId: search.router || "",
    poolId: search.pool || "",
    billing: search.billing || "all",
    expiringSoon: Boolean(search.expiring),
    onGrace: Boolean(search.grace),
    overdue: Boolean(search.overdue) || search.billing === "overdue",
    sort: search.sort || "created",
    dir: search.dir || "desc",
    page: Math.max(1, search.page || 1),
  };
}

function filtersToSearch(filters: ServiceDeskFilters): Search {
  return {
    q: filters.q || undefined,
    status: filters.status === "all" ? undefined : filters.status,
    access: filters.access === "all" ? undefined : filters.access,
    pkg: filters.packageName || undefined,
    customer: filters.customerId || undefined,
    location: filters.location || undefined,
    router: filters.routerId || undefined,
    pool: filters.poolId || undefined,
    billing: filters.billing === "all" ? undefined : filters.billing,
    expiring: filters.expiringSoon || undefined,
    grace: filters.onGrace || undefined,
    overdue: filters.overdue || undefined,
    sort: filters.sort === "created" ? undefined : filters.sort,
    dir: filters.sort !== "created" && filters.dir === "asc" ? "asc" : filters.dir === "asc" ? "asc" : undefined,
    page: filters.page > 1 ? filters.page : undefined,
  };
}

export const Route = createFileRoute("/app/services")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      search.status === "active" ||
      search.status === "pending" ||
      search.status === "expired" ||
      search.status === "grace" ||
      search.status === "suspended" ||
      search.status === "terminated"
        ? search.status
        : undefined,
    access: search.access === "pppoe" || search.access === "static" || search.access === "hotspot" ? search.access : undefined,
    pkg: typeof search.pkg === "string" ? search.pkg : undefined,
    customer: typeof search.customer === "string" ? search.customer : undefined,
    location: typeof search.location === "string" ? search.location : undefined,
    router: typeof search.router === "string" ? search.router : undefined,
    pool: typeof search.pool === "string" ? search.pool : undefined,
    billing: search.billing === "clear" || search.billing === "due" || search.billing === "overdue" ? search.billing : undefined,
    expiring: search.expiring === true || search.expiring === "true" ? true : undefined,
    grace: search.grace === true || search.grace === "true" ? true : undefined,
    overdue: search.overdue === true || search.overdue === "true" ? true : undefined,
    sort:
      search.sort === "customer" ||
      search.sort === "service" ||
      search.sort === "package" ||
      search.sort === "access" ||
      search.sort === "status" ||
      search.sort === "expiry" ||
      search.sort === "location" ||
      search.sort === "router" ||
      search.sort === "outstanding" ||
      search.sort === "last_activity"
        ? search.sort
        : undefined,
    dir: search.dir === "asc" || search.dir === "desc" ? search.dir : undefined,
    page: typeof search.page === "number" ? search.page : typeof search.page === "string" ? Number(search.page) || undefined : undefined,
  }),
  component: ServicesRoute,
});

function ServicesRoute() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/app/services") return <Outlet />;
  return <ServicesPage />;
}

function ServicesPage() {
  const navigate = Route.useNavigate();
  const search = Route.useSearch();
  const filters = useMemo(() => searchToFilters(search), [search]);

  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftQ, setDraftQ] = useState(filters.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [onboardOpen, setOnboardOpen] = useState(false);
  const [secretNote, setSecretNote] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [expiry, setExpiry] = useState<ExpiryForm | null>(null);
  const [days, setDays] = useState(3);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [traffic, setTraffic] = useState<ServiceDeskRow | null>(null);
  const [reassign, setReassign] = useState<{ id: string; to: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; label: string; reason: string } | null>(null);
  const [pkgFor, setPkgFor] = useState<ServiceDeskRow | null>(null);
  const [pkgId, setPkgId] = useState("");
  const [editFor, setEditFor] = useState<ServiceDeskRow | null>(null);
  const [edit, setEdit] = useState({ username: "", static_ip: "", mac_address: "", notes: "" });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<"sms" | "package" | "grace" | null>(null);
  const [bulkPkg, setBulkPkg] = useState("");
  const [bulkBody, setBulkBody] = useState("");
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [previewFor, setPreviewFor] = useState<ServiceDeskRow | null>(null);
  const [preview, setPreview] = useState<PreviewRecord | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  function patchSearch(next: Partial<ServiceDeskFilters>) {
    const merged = { ...filters, ...next };
    void navigate({ search: filtersToSearch(merged), replace: true });
  }

  async function loadDesk(nextFilters = filters) {
    const id = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await queryServicesDeskFn({
        data: {
          q: nextFilters.q,
          status: nextFilters.status,
          access: nextFilters.access,
          packageName: nextFilters.packageName,
          customerId: nextFilters.customerId,
          location: nextFilters.location,
          routerId: nextFilters.routerId,
          poolId: nextFilters.poolId,
          billing: nextFilters.billing,
          expiringSoon: nextFilters.expiringSoon,
          onGrace: nextFilters.onGrace,
          overdue: nextFilters.overdue,
          sort: nextFilters.sort,
          dir: nextFilters.dir,
          page: nextFilters.page,
          pageSize: nextFilters.pageSize,
        },
      });
      if (id !== requestRef.current) return;
      setDesk(res);
      setSelected((prev) => {
        const ids = new Set(res.services.map((s) => s.id));
        return new Set([...prev].filter((sid) => ids.has(sid)));
      });
    } catch (err) {
      if (id !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load services");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }

  useEffect(() => {
    setDraftQ(filters.q);
    void loadDesk(filters);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    search.q,
    search.status,
    search.access,
    search.pkg,
    search.customer,
    search.location,
    search.router,
    search.pool,
    search.billing,
    search.expiring,
    search.grace,
    search.overdue,
    search.sort,
    search.dir,
    search.page,
  ]);

  useEffect(() => {
    if (!previewFor) {
      setPreview(null);
      setPreviewErr(null);
      return;
    }
    setPreviewLoading(true);
    setPreviewErr(null);
    getServiceFn({ data: { id: previewFor.id } })
      .then((rec) => {
        setPreview(rec);
        setPreviewLoading(false);
      })
      .catch((err) => {
        setPreview(null);
        setPreviewErr(err instanceof Error ? err.message : "Could not load service");
        setPreviewLoading(false);
      });
  }, [previewFor]);

  const rows = desk?.services ?? [];
  const customers = desk?.customers ?? [];
  const packageOptions = desk?.packageOptions ?? [];
  const policy: GracePolicy | null = desk?.gracePolicy ?? null;
  const role = desk?.workspace.role || "";
  const canGrant = hasPermission(role, "services.grace.grant");
  const canExtend = hasPermission(role, "services.grace.extend");
  const canRevoke = hasPermission(role, "services.grace.revoke");
  const canManage = hasPermission(role, "services.manage");
  const canExpiry = hasPermission(role, "services.expiry.update");
  const canDelete = hasPermission(role, "services.delete") || canManage;
  const canReassign = hasPermission(role, "services.reassign") || canManage;
  const canTraffic = hasPermission(role, "traffic.view") || hasPermission(role, "services.read");
  const canRecycle = hasPermission(role, "recycle_bin.view");
  const canComms = hasPermission(role, "communications.send") || hasPermission(role, "customers.manage");
  const presets = policy?.staff_preset_days?.length ? policy.staff_preset_days : [1, 2, 3, 5, 7];
  const selectedRows = rows.filter((s) => selected.has(s.id));
  const allSelected = rows.length > 0 && rows.every((s) => selected.has(s.id));
  const uniqueCustomers = [...new Map(selectedRows.map((s) => [s.customer_id, { id: s.customer_id, phone: s.customer_phone }])).values()];
  const smsPlan = uniqueSmsRecipients(uniqueCustomers);
  const counters = desk?.counters ?? { total: 0, active: 0, pending: 0, expired: 0, suspended: 0, grace: 0 };
  const perms: ServicePerms = { canManage, canDelete, canExpiry, canGrant, canExtend, canRevoke, canReassign, canTraffic, canComms };

  function onSearchChange(value: string) {
    setDraftQ(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      patchSearch({ q: value, page: 1 });
    }, 300);
  }

  function onSort(id: ServiceDeskSort) {
    if (filters.sort === id) patchSearch({ dir: filters.dir === "asc" ? "desc" : "asc", page: 1 });
    else patchSearch({ sort: id, dir: id === "customer" || id === "package" ? "asc" : "desc", page: 1 });
  }

  const actions: ServiceActions = {
    onPreview: setPreviewFor,
    onEdit: (s) => {
      setEditFor(s);
      setEdit({ username: s.username || "", static_ip: s.static_ip || "", mac_address: s.mac_address, notes: s.notes });
      setPreviewFor(null);
    },
    onPackage: (s) => {
      setPkgFor(s);
      setPkgId(s.package_id);
    },
    onExpiry: (s) => {
      setActionError(null);
      setExpiry(openExpiryForm(toServiceRow(s)));
    },
    onTraffic: setTraffic,
    onSuspend: (s) => void setStatus(s.id, "suspended"),
    onRestore: (s) => void setStatus(s.id, "active"),
    onGrant: (s) => {
      setPanel({ id: s.id, mode: "grant" });
      setDays(presets[2] ?? 3);
      setActionError(null);
    },
    onExtend: (s) => {
      setPanel({ id: s.id, mode: "extend" });
      setDays(presets[0] ?? 1);
      setActionError(null);
    },
    onRevoke: (s) => {
      setPanel({ id: s.id, mode: "revoke" });
      setActionError(null);
    },
    onDisconnect: (s) => {
      void disconnectService({ data: { id: s.id } }).then(() => setSecretNote(`Disconnect queued for ${s.identity}`));
    },
    onRotate: (s) => {
      if (!window.confirm("Rotate the PPPoE password? The current password stops working immediately.")) return;
      void rotateServiceSecret({ data: { id: s.id, confirm: true } }).then((r) => {
        setSecretNote(`New PPPoE password for ${r.username}: ${r.password}`);
      });
    },
    onReveal: (s) => {
      void revealPppoePasswordFn({ data: { id: s.id } }).then((r) => {
        setSecretNote(`PPPoE password for ${r.username}: ${r.password}`);
      });
    },
    onRetry: (s) => {
      void retryPppoeProvisionFn({ data: { id: s.id } }).then(() => {
        setSecretNote(`Provisioning retried for ${s.identity}`);
        void loadDesk(filters);
      });
    },
    onReassign: (s) => setReassign({ id: s.id, to: customers.find((c) => c.id !== s.customer_id)?.id || "" }),
    onDelete: (s) => setDrop({ id: s.id, label: `${s.customer_name} · ${s.package_name}`, reason: "" }),
  };

  async function setStatus(id: string, status: ServiceStatus) {
    const verb = status === "suspended" ? "Suspend" : "Restore";
    if (!window.confirm(`${verb} this service?`)) return;
    await setServiceStatus({ data: { id, status } });
    await loadDesk(filters);
  }

  async function submitExpiry(e: React.FormEvent) {
    e.preventDefault();
    if (!expiry || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const out = await setServiceExpiryFn({ data: { id: expiry.service.id, date: expiry.date, reason: expiry.reason } });
      setExpiry(null);
      setSecretNote(
        `Expiry date updated for ${out.customer_name}. Status: ${out.status === "grace" ? "Grace Period" : out.status}. No billing or customer message was sent.`,
      );
      await loadDesk(filters);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update expiry date");
    } finally {
      setBusy(false);
    }
  }

  async function submitGrace(e: React.FormEvent) {
    e.preventDefault();
    if (!panel) return;
    setBusy(true);
    setActionError(null);
    try {
      const chosen = custom ? Number(custom) : days;
      if (panel.mode === "grant") {
        await grantGraceFn({ data: { service_id: panel.id, days: chosen, reason } });
      } else if (panel.mode === "extend") {
        await extendGraceFn({ data: { service_id: panel.id, days: chosen, reason } });
      } else {
        await revokeGraceFn({ data: { service_id: panel.id, reason } });
      }
      setPanel(null);
      setReason("");
      setCustom("");
      await loadDesk(filters);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not update grace period");
    } finally {
      setBusy(false);
    }
  }

  async function runBulk() {
    if (!selectedRows.length) return;
    setBusy(true);
    setBulkNote(null);
    try {
      if (bulk === "sms") {
        const ids = smsPlan.recipients.map((r) => r.id);
        if (!ids.length) throw new Error("None of the selected services have a valid customer mobile.");
        if (!window.confirm(`Queue SMS for ${ids.length} customer${ids.length === 1 ? "" : "s"}? ${smsPlan.skipped.length} skipped.`)) {
          setBusy(false);
          return;
        }
        const res = await broadcastCustomersFn({
          data: { customer_ids: ids, channels: ["sms"], subject: "", body: bulkBody },
        });
        setBulkNote(`SMS queued for ${res.sms} · failed ${res.failed}`);
      } else if (bulk === "package") {
        if (!bulkPkg) throw new Error("Choose a package");
        if (!window.confirm(`Change package on ${selectedRows.length} service${selectedRows.length === 1 ? "" : "s"}? Invoices are not created.`)) {
          setBusy(false);
          return;
        }
        for (const row of selectedRows) await updateServiceFn({ data: { id: row.id, package_id: bulkPkg } });
        setBulkNote(`Package updated on ${selectedRows.length} services.`);
      } else if (bulk === "grace") {
        const targets = selectedRows.filter((s) => s.status !== "terminated" && !s.grace_active);
        if (!targets.length) throw new Error("None of the selected services can receive Grace Period.");
        if (!window.confirm(`Grant Grace Period to ${targets.length} service${targets.length === 1 ? "" : "s"}?`)) {
          setBusy(false);
          return;
        }
        for (const row of targets) await grantGraceFn({ data: { service_id: row.id, days: presets[2] ?? 3, reason: "Bulk grant" } });
        setBulkNote(`Grace Period granted on ${targets.length} services.`);
      }
      setBulk(null);
      setBulkBody("");
      setBulkPkg("");
      await loadDesk(filters);
    } catch (err) {
      setBulkNote(err instanceof Error ? err.message : "Could not complete");
    } finally {
      setBusy(false);
    }
  }

  function exportSelected() {
    const csv = selectedServicesCsv(selectedRows.length ? selectedRows : rows);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedRows.length ? "ispsolutions-services-selected.csv" : "ispsolutions-services.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const panelService = panel ? rows.find((s) => s.id === panel.id) : null;
  const empty = !loading && !error && rows.length === 0;
  const noSearch = empty && Boolean(filters.q);
  const noFilter = empty && !filters.q && (filters.status !== "all" || filters.access !== "all" || filters.packageName || filters.customerId || filters.location || filters.routerId || filters.poolId || filters.billing !== "all" || filters.expiringSoon || filters.onGrace || filters.overdue);
  const noneYet = empty && !filters.q && !noFilter;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">Services</h1>
          <p className="text-sm text-muted">Manage internet connections, access credentials, packages, network assignments and service status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ServiceOverflowMenu canRecycle={canRecycle} selectedCount={selectedRows.length} onExport={exportSelected} />
          {canManage ? <Button onClick={() => setOnboardOpen(true)}>Add service</Button> : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <CounterButton
          label="Total"
          value={counters.total}
          active={filters.status === "all" && !filters.overdue && !filters.onGrace && !filters.expiringSoon}
          onClick={() => patchSearch({ ...EMPTY_SERVICE_FILTERS, q: filters.q, page: 1 })}
        />
        <CounterButton
          label="Active"
          value={counters.active}
          active={filters.status === "active"}
          onClick={() => patchSearch({ status: filters.status === "active" ? "all" : "active", page: 1 })}
        />
        <CounterButton
          label="Pending"
          value={counters.pending}
          active={filters.status === "pending"}
          onClick={() => patchSearch({ status: filters.status === "pending" ? "all" : "pending", page: 1 })}
        />
        <CounterButton
          label="Expired"
          value={counters.expired}
          active={filters.status === "expired"}
          onClick={() => patchSearch({ status: filters.status === "expired" ? "all" : "expired", page: 1 })}
        />
        <CounterButton
          label="Suspended"
          value={counters.suspended}
          active={filters.status === "suspended"}
          onClick={() => patchSearch({ status: filters.status === "suspended" ? "all" : "suspended", page: 1 })}
        />
        <CounterButton
          label="Grace Period"
          value={counters.grace}
          active={filters.status === "grace" || filters.onGrace}
          onClick={() => patchSearch({ status: filters.status === "grace" ? "all" : "grace", onGrace: false, page: 1 })}
        />
      </div>

      {secretNote ? <p className="text-sm text-accent">{secretNote}</p> : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="min-w-0 flex-1">
          <ServiceSearch
            value={draftQ}
            onChange={onSearchChange}
            onClear={() => {
              setDraftQ("");
              patchSearch({ q: "", page: 1 });
            }}
            loading={loading && Boolean(draftQ)}
          />
        </div>
        <MobileServiceFilters
          open={filterOpen}
          onOpenChange={setFilterOpen}
          filters={filters}
          packages={desk?.packages ?? []}
          locations={desk?.locations ?? []}
          routers={desk?.routers ?? []}
          pools={desk?.pools ?? []}
          customers={customers}
          onChange={(next) => patchSearch(next)}
          onClear={() => patchSearch({ ...EMPTY_SERVICE_FILTERS, q: filters.q, page: 1 })}
        />
      </div>

      <ServiceFilterBar
        filters={filters}
        packages={desk?.packages ?? []}
        locations={desk?.locations ?? []}
        routers={desk?.routers ?? []}
        pools={desk?.pools ?? []}
        customers={customers}
        matching={desk?.total ?? 0}
        onChange={(next) => patchSearch(next)}
        onClear={() => patchSearch({ ...EMPTY_SERVICE_FILTERS, q: filters.q, page: 1 })}
      />

      {canManage && selectedRows.length ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              {selectedRows.length} selected · {uniqueCustomers.length} customer{uniqueCustomers.length === 1 ? "" : "s"}
              {bulk === "sms" ? ` · ${smsPlan.recipients.length} valid mobile${smsPlan.recipients.length === 1 ? "" : "s"}` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const n = selectedRows.filter((s) => s.status === "active" || s.status === "grace").length;
                  if (!n) return;
                  if (!window.confirm(`Suspend ${n} service${n === 1 ? "" : "s"}?`)) return;
                  void (async () => {
                    setBusy(true);
                    try {
                      for (const s of selectedRows) {
                        if (s.status === "active" || s.status === "grace") await setServiceStatus({ data: { id: s.id, status: "suspended" } });
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
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const n = selectedRows.filter((s) => s.status === "suspended").length;
                  if (!n) return;
                  if (!window.confirm(`Restore ${n} service${n === 1 ? "" : "s"}?`)) return;
                  void (async () => {
                    setBusy(true);
                    try {
                      for (const s of selectedRows) {
                        if (s.status === "suspended") await setServiceStatus({ data: { id: s.id, status: "active" } });
                      }
                      await loadDesk(filters);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Restore
              </Button>
              {canGrant ? (
                <Button size="sm" variant={bulk === "grace" ? "default" : "secondary"} onClick={() => setBulk("grace")}>
                  Grant Grace Period
                </Button>
              ) : null}
              <Button size="sm" variant={bulk === "package" ? "default" : "secondary"} onClick={() => setBulk("package")}>
                Change package
              </Button>
              {canComms ? (
                <Button size="sm" variant={bulk === "sms" ? "default" : "secondary"} onClick={() => setBulk("sms")}>
                  Send SMS
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const targets = selectedRows.filter((s) => s.access_method === "pppoe" && (s.status === "pending" || /fail|retry|error/i.test(s.provision_overall)));
                  if (!targets.length) return;
                  if (!window.confirm(`Retry provisioning on ${targets.length} PPPoE line${targets.length === 1 ? "" : "s"}?`)) return;
                  void (async () => {
                    setBusy(true);
                    try {
                      for (const s of targets) await retryPppoeProvisionFn({ data: { id: s.id } });
                      setBulkNote(`Provisioning retried on ${targets.length} services.`);
                      await loadDesk(filters);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                Retry provisioning
              </Button>
              <Button size="sm" variant="secondary" onClick={exportSelected}>
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
          {bulk === "package" ? (
            <div className="flex flex-wrap items-end gap-2">
              <Field label="Package">
                <Select value={bulkPkg} onChange={(e) => setBulkPkg(e.target.value)}>
                  <option value="">Choose package</option>
                  {packageOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.access_method}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button disabled={busy || !bulkPkg} onClick={() => void runBulk()}>
                Apply to {selectedRows.length}
              </Button>
            </div>
          ) : null}
          {bulk === "grace" ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">
                Grants the default staff preset ({presets[2] ?? 3} days) to eligible selected lines. Renewal dates do not change.
              </p>
              <Button disabled={busy} onClick={() => void runBulk()}>
                Confirm grant
              </Button>
            </div>
          ) : null}
          {bulk === "sms" ? (
            <div className="grid gap-3 md:max-w-xl">
              <p className="text-sm text-muted">
                SMS will be queued for {smsPlan.recipients.length} of {uniqueCustomers.length} customers.
                {smsPlan.skipped.length ? ` ${smsPlan.skipped.length} skipped (missing, invalid, or duplicate numbers).` : ""}
              </p>
              <Field label="SMS">
                <Textarea value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} required />
              </Field>
              <Button disabled={busy || !bulkBody.trim() || !smsPlan.recipients.length} onClick={() => void runBulk()}>
                Send SMS to {smsPlan.recipients.length}
              </Button>
            </div>
          ) : null}
          {bulkNote ? <p className="text-sm text-accent">{bulkNote}</p> : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Button className="mt-3" variant="secondary" onClick={() => void loadDesk(filters)}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading && !rows.length ? <ServiceSkeleton /> : null}

      {empty ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            {noneYet ? "No services yet." : noSearch ? "No search results." : "No results for the selected filters."}
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {noneYet && canManage ? <Button onClick={() => setOnboardOpen(true)}>Add service</Button> : null}
            {noSearch ? (
              <Button variant="secondary" onClick={() => patchSearch({ q: "", page: 1 })}>
                Clear search
              </Button>
            ) : null}
            {noFilter ? (
              <Button variant="secondary" onClick={() => patchSearch({ ...EMPTY_SERVICE_FILTERS, q: filters.q, page: 1 })}>
                Clear filters
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!empty && rows.length ? (
        <>
          <ServiceTable
            rows={rows}
            selected={selected}
            allSelected={allSelected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onToggleAll={() => setSelected(allSelected ? new Set() : new Set(rows.map((s) => s.id)))}
            onPreview={setPreviewFor}
            perms={perms}
            actions={actions}
            sort={filters.sort}
            dir={filters.dir}
            onSort={onSort}
          />
          <ServiceCards
            rows={rows}
            selected={selected}
            onToggle={(id) =>
              setSelected((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onPreview={setPreviewFor}
            perms={perms}
            actions={actions}
          />
          <ServicePagination page={desk?.page ?? 1} pages={desk?.pages ?? 1} total={desk?.total ?? 0} onPage={(page) => patchSearch({ page })} />
        </>
      ) : null}

      <OnboardWizard
        open={onboardOpen}
        onOpenChange={setOnboardOpen}
        mode="service"
        onCreated={(res) => {
          setOnboardOpen(false);
          if (res.service_id) {
            void navigate({ to: "/app/services/$serviceId", params: { serviceId: res.service_id } });
          } else if (res.customer_id) {
            void navigate({ to: "/app/customers/$customerId", params: { customerId: res.customer_id } });
          } else {
            void loadDesk(filters);
          }
        }}
      />

      <ServicePreview
        open={Boolean(previewFor)}
        onOpenChange={(next) => {
          if (!next) setPreviewFor(null);
        }}
        loading={previewLoading}
        error={previewErr}
        service={previewFor}
        record={preview}
        perms={perms}
        onTraffic={() => {
          if (previewFor) setTraffic(previewFor);
        }}
        onEdit={() => {
          if (previewFor) actions.onEdit(previewFor);
        }}
      />

      <Dialog
        open={Boolean(panel)}
        onOpenChange={(next) => {
          if (!next) setPanel(null);
        }}
        title={panel?.mode === "grant" ? "Grant Grace Period" : panel?.mode === "extend" ? "Extend Grace Period" : "Revoke Grace Period"}
        description={panelService ? `${panelService.customer_name} · ${panelService.package_name}` : undefined}
      >
        {panel ? (
          <form onSubmit={submitGrace} className="grid gap-3">
            <p className="text-sm text-muted">
              {panel.mode === "revoke"
                ? "Revoking makes this line eligible for normal suspension. The renewal date does not change."
                : "Grace Period is temporary access only. The paid-through / renewal date stays the same."}
            </p>
            {panel.mode !== "revoke" ? (
              <>
                <Field label="Days">
                  <Select
                    value={custom ? "custom" : String(days)}
                    onChange={(e) => {
                      if (e.target.value === "custom") setCustom(String(days));
                      else {
                        setCustom("");
                        setDays(Number(e.target.value));
                      }
                    }}
                  >
                    {presets.map((d) => (
                      <option key={d} value={d}>
                        {d} day{d === 1 ? "" : "s"}
                      </option>
                    ))}
                    {policy?.allow_custom_days ? <option value="custom">Custom</option> : null}
                  </Select>
                </Field>
                {custom ? (
                  <Field label="Custom days">
                    <Input type="number" min={1} max={policy?.staff_max_days ?? 14} value={custom} onChange={(e) => setCustom(e.target.value)} />
                  </Field>
                ) : null}
              </>
            ) : null}
            <Field label="Reason (optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Note for the audit log" />
            </Field>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {panel.mode === "grant" ? "Grant" : panel.mode === "extend" ? "Extend" : "Revoke"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(expiry)}
        onOpenChange={(next) => {
          if (!next && !busy) setExpiry(null);
        }}
        title="Edit expiry date"
        description="Changes access only. Paid-through date, invoices, and customer messages stay as they are."
      >
        {expiry ? (
          <ExpiryEditor form={expiry} setForm={setExpiry} busy={busy} error={actionError} onSubmit={submitExpiry} onClose={() => setExpiry(null)} />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(pkgFor)}
        onOpenChange={(next) => {
          if (!next) setPkgFor(null);
        }}
        title="Change package"
        description="Updates the line and QoS profile. Invoices and payments are not created."
      >
        {pkgFor ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setActionError(null);
              try {
                await updateServiceFn({ data: { id: pkgFor.id, package_id: pkgId } });
                setPkgFor(null);
                setSecretNote(`Package updated for ${pkgFor.customer_name}.`);
                await loadDesk(filters);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : "Could not change package");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Package">
              <Select value={pkgId} onChange={(e) => setPkgId(e.target.value)}>
                {packageOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.access_method}
                  </option>
                ))}
              </Select>
            </Field>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Save package
              </Button>
              <Button type="button" variant="ghost" onClick={() => setPkgFor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(editFor)}
        onOpenChange={(next) => {
          if (!next) setEditFor(null);
        }}
        title="Edit service"
        description="Updates credentials and network identity. Invoices are not changed."
      >
        {editFor ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setActionError(null);
              try {
                await updateServiceFn({
                  data: {
                    id: editFor.id,
                    username: edit.username,
                    static_ip: edit.static_ip,
                    mac_address: edit.mac_address,
                    notes: edit.notes,
                  },
                });
                setEditFor(null);
                setSecretNote(`Service updated for ${editFor.customer_name}.`);
                await loadDesk(filters);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : "Could not update service");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Username">
              <Input value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} />
            </Field>
            <Field label="Static IP">
              <Input value={edit.static_ip} onChange={(e) => setEdit({ ...edit, static_ip: e.target.value })} />
            </Field>
            <Field label="MAC address">
              <Input value={edit.mac_address} onChange={(e) => setEdit({ ...edit, mac_address: e.target.value })} />
            </Field>
            <Field label="Notes">
              <Input value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEditFor(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <TrafficDrawer
        open={Boolean(traffic)}
        onOpenChange={(next) => {
          if (!next) setTraffic(null);
        }}
        customerId={traffic?.customer_id || ""}
        customerName={traffic?.customer_name}
        serviceId={traffic?.id}
      />

      <Dialog
        open={Boolean(reassign)}
        onOpenChange={(next) => {
          if (!next) setReassign(null);
        }}
        title="Reassign service"
        description="The line keeps its package, credentials, expiry, and history. Invoices and payments stay on the current customer."
      >
        {reassign ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!reassign.to) return;
              setBusy(true);
              setActionError(null);
              try {
                await reassignServiceFn({ data: { id: reassign.id, customer_id: reassign.to, confirm: true } });
                setReassign(null);
                await loadDesk(filters);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : "Could not reassign");
              } finally {
                setBusy(false);
              }
            }}
          >
            <Field label="Destination customer">
              <Select value={reassign.to} onChange={(e) => setReassign({ ...reassign, to: e.target.value })} required>
                <option value="">Select customer</option>
                {customers
                  .filter((c) => c.id !== rows.find((row) => row.id === reassign.id)?.customer_id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy || !reassign.to}>
                Confirm reassignment
              </Button>
              <Button type="button" variant="ghost" onClick={() => setReassign(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(drop)}
        onOpenChange={(next) => {
          if (!next) setDrop(null);
        }}
        title="Move service to Recycle Bin"
        description="The line leaves live searches and network access is revoked. The customer, other services, invoices, and payments stay. Staff can restore it from the Recycle Bin."
      >
        {drop ? (
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setActionError(null);
              try {
                await deleteServiceFn({ data: { id: drop.id, reason: drop.reason, confirm: true } });
                setDrop(null);
                setSecretNote("Service moved to the Recycle Bin. Customer kept. No invoice or message was sent.");
                await loadDesk(filters);
              } catch (err) {
                setActionError(err instanceof Error ? err.message : "Could not delete service");
              } finally {
                setBusy(false);
              }
            }}
          >
            <p className="text-sm">{drop.label}</p>
            <Field label="Reason">
              <Input required value={drop.reason} onChange={(e) => setDrop({ ...drop, reason: e.target.value })} placeholder="Why this line is being removed" />
            </Field>
            {actionError ? <p className="text-sm text-danger">{actionError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="danger" disabled={busy || !drop.reason.trim()}>
                Move to Recycle Bin
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDrop(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}
      </Dialog>
    </div>
  );
}

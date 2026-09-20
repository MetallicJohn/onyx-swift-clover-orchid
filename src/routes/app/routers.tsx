import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FilterSheet,
  MobileFilterButton,
  RouterCards,
  RouterCounters,
  RouterFilterBar,
  RouterPagination,
  RouterSearch,
  RouterTable,
  type RouterActions,
  type RouterPerms,
} from "@/components/isp/router-desk-ui";
import { RosScriptDialog, type RosScriptPack } from "@/components/isp/ros-script-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { hasPermission } from "@/lib/isp/rbac";
import {
  EMPTY_ROUTER_FILTERS,
  activeRouterFilterCount,
  normalizeRouterDeskQuery,
  type RouterDeskFilters,
  type RouterDeskRow,
  type RouterDeskStatus,
} from "@/lib/isp/router-desk-format";
import { addRouter } from "@/lib/isp/server";
import {
  archiveRouterFn,
  copyRouterScript,
  issueRouterTokenFn,
  queryRoutersDeskFn,
  reconfigureRouterFn,
  setRouterEnabledFn,
  testRouterConnectionFn,
} from "@/lib/isp/server-routers";

type Search = {
  q?: string;
  status?: RouterDeskStatus;
  location?: string;
  vendor?: string;
  pools?: boolean;
  services?: boolean;
  page?: number;
};

type DeskPayload = Awaited<ReturnType<typeof queryRoutersDeskFn>>;

const EMPTY_FORM = {
  name: "",
  identity: "",
  ros_version: "",
  model: "",
  site_pop: "",
  management_ip: "",
  role: "access",
};

function searchToFilters(search: Search): RouterDeskFilters {
  return normalizeRouterDeskQuery({
    q: search.q || "",
    status: search.status || "all",
    location: search.location || "",
    vendor: search.vendor || "",
    hasPools: Boolean(search.pools),
    hasServices: Boolean(search.services),
    page: search.page || 1,
  });
}

function filtersToSearch(filters: RouterDeskFilters): Search {
  return {
    q: filters.q || undefined,
    status: filters.status === "all" ? undefined : filters.status,
    location: filters.location || undefined,
    vendor: filters.vendor || undefined,
    pools: filters.hasPools || undefined,
    services: filters.hasServices || undefined,
    page: filters.page > 1 ? filters.page : undefined,
  };
}

export const Route = createFileRoute("/app/routers")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    q: typeof search.q === "string" ? search.q : undefined,
    status:
      search.status === "online" ||
      search.status === "offline" ||
      search.status === "awaiting" ||
      search.status === "disabled" ||
      search.status === "archived"
        ? search.status
        : undefined,
    location: typeof search.location === "string" ? search.location : undefined,
    vendor: typeof search.vendor === "string" ? search.vendor : undefined,
    pools: search.pools === true || search.pools === "true" ? true : undefined,
    services: search.services === true || search.services === "true" ? true : undefined,
    page: typeof search.page === "number" ? search.page : Number(search.page) || undefined,
  }),
  component: RoutersGate,
});

function RoutersGate() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname !== "/app/routers") return <Outlet />;
  return <RoutersPage />;
}

function RoutersPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const filters = useMemo(() => searchToFilters(search), [search]);
  const [desk, setDesk] = useState<DeskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [draftQ, setDraftQ] = useState(filters.q);
  const [filterOpen, setFilterOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [pack, setPack] = useState<RosScriptPack | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmSync, setConfirmSync] = useState<RouterDeskRow | null>(null);
  const [confirmArchive, setConfirmArchive] = useState<RouterDeskRow | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function setFilters(patch: Partial<RouterDeskFilters>) {
    void navigate({
      to: "/app/routers",
      search: filtersToSearch({ ...filters, ...patch }),
    });
  }

  async function load() {
    setLoading(true);
    try {
      const next = await queryRoutersDeskFn({
        data: {
          q: filters.q,
          status: filters.status,
          location: filters.location,
          vendor: filters.vendor,
          hasPools: filters.hasPools,
          hasServices: filters.hasServices,
          page: filters.page,
        },
      });
      setDesk(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load routers");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.status, filters.location, filters.vendor, filters.hasPools, filters.hasServices, filters.page]);

  useEffect(() => {
    setDraftQ(filters.q);
  }, [filters.q]);

  function onSearch(v: string) {
    setDraftQ(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilters({ q: v, page: 1 }), 250);
  }

  const role = desk?.workspace.role || "";
  const canManage = hasPermission(role, "routers.manage");
  const perms: RouterPerms = {
    canManage,
    canMonitor: hasPermission(role, "traffic.view") || hasPermission(role, "routers.read"),
  };
  const dateFormat = desk?.workspace.dateFormat || "dd/mm/yy";
  const rows = desk?.routers || [];

  const actions: RouterActions = {
    onDetails: (r) => void navigate({ to: "/app/routers/$routerId", params: { routerId: r.id } }),
    onEdit: (r) => void navigate({ to: "/app/routers/$routerId", params: { routerId: r.id }, search: { action: "edit" } }),
    onTest: async (r) => {
      try {
        const out = await testRouterConnectionFn({ data: { id: r.id } });
        setNotice(
          out.online
            ? `${out.name} has agent evidence (${out.reachability}). Last seen is stored, not invented.`
            : `${out.name} is not claimed online. ${out.source === "none" ? "No heartbeat yet." : `Last evidence: ${out.reachability}.`}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Test failed");
      }
    },
    onSync: (r) => setConfirmSync(r),
    onCopyBootstrap: async (r) => {
      try {
        const out = await issueRouterTokenFn({ data: { id: r.id } });
        setPack({
          title: `Bootstrap · ${r.name}`,
          bootstrap: out.bootstrap,
          enroll: out.enroll,
        });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not generate bootstrap");
      }
    },
    onCopyEnroll: async (r) => {
      try {
        const out = await copyRouterScript({ data: { id: r.id } });
        setPack({ title: `Enroll · ${r.name}`, enroll: out.script });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not generate enroll script");
      }
    },
    onPools: (r) =>
      void navigate({ to: "/app/routers/$routerId", params: { routerId: r.id }, search: { tab: "pools" } }),
    onMonitor: (r) =>
      void navigate({ to: "/app/routers/$routerId", params: { routerId: r.id }, search: { tab: "monitoring" } }),
    onToggleEnabled: async (r) => {
      try {
        await setRouterEnabledFn({ data: { id: r.id, enabled: !r.enabled } });
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update router");
      }
    },
    onArchive: (r) => setConfirmArchive(r),
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Routers</h1>
          <p className="text-sm text-muted">
            MikroTik fleet for this ISP. Open a router for pools, bootstrap, and monitoring.
          </p>
        </div>
        {canManage ? (
          <Button
            type="button"
            onClick={() => {
              setForm(EMPTY_FORM);
              setAddOpen(true);
            }}
          >
            Add router
          </Button>
        ) : null}
      </div>

      {desk && !desk.provisioning.enabled ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Router provisioning is disabled for this ISP.
        </div>
      ) : null}
      {desk && !desk.hubReady ? (
        <div className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          Set the hub public IP under{" "}
          <Link to="/app/settings" className="text-accent hover:underline">
            Settings → Network
          </Link>
          .
        </div>
      ) : null}

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {notice ? <p className="text-sm text-ok">{notice}</p> : null}

      <RouterCounters
        counters={desk?.counters || { total: 0, online: 0, awaiting: 0, disabled: 0 }}
        status={filters.status}
        onStatus={(status) => setFilters({ status, page: 1 })}
      />

      <div className="flex flex-wrap items-center gap-2">
        <RouterSearch value={draftQ} onChange={onSearch} />
        <MobileFilterButton
          open={filterOpen}
          count={activeRouterFilterCount(filters)}
          onClick={() => setFilterOpen((v) => !v)}
        />
      </div>
      <FilterSheet open={filterOpen}>
        <RouterFilterBar
          filters={filters}
          locations={desk?.locations || []}
          vendors={desk?.vendors || []}
          onChange={setFilters}
          onClear={() => setFilters({ ...EMPTY_ROUTER_FILTERS, q: filters.q })}
        />
      </FilterSheet>

      <RouterTable rows={rows} dateFormat={dateFormat} perms={perms} actions={actions} loading={loading && !desk} />
      <RouterCards rows={rows} dateFormat={dateFormat} perms={perms} actions={actions} loading={loading && !desk} />
      {desk ? (
        <RouterPagination page={desk.page} pages={desk.pages} total={desk.total} onPage={(page) => setFilters({ page })} />
      ) : null}

      <Dialog
        open={addOpen}
        onOpenChange={setAddOpen}
        title="Add MikroTik router"
        description="Name, identity, and site are used in the generated configuration."
        className="sm:max-w-xl"
      >
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const created = await addRouter({ data: { ...form, location: form.site_pop } });
              setAddOpen(false);
              setForm(EMPTY_FORM);
              if (created.bootstrap || created.script) {
                setPack({
                  title: `Scripts · ${created.router?.name || form.name}`,
                  bootstrap: created.bootstrap,
                  enroll: created.script,
                });
              } else {
                setNotice(created.domain_error || "Router saved. Configure a public domain before generating a bootstrap script.");
              }
              await load();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not save router");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Router name">
            <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="Identity">
            <Input value={form.identity} onChange={(e) => setForm({ ...form, identity: e.target.value })} placeholder="Same as name if empty" />
          </Field>
          <Field label="RouterOS version">
            <Input value={form.ros_version} onChange={(e) => setForm({ ...form, ros_version: e.target.value })} placeholder="7.16" />
          </Field>
          <Field label="Model">
            <Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder="RB5009" />
          </Field>
          <Field label="Site / POP">
            <Input value={form.site_pop} onChange={(e) => setForm({ ...form, site_pop: e.target.value })} />
          </Field>
          <Field label="Management IP">
            <Input value={form.management_ip} onChange={(e) => setForm({ ...form, management_ip: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="core">Core</option>
              <option value="edge">Edge</option>
              <option value="access">Access</option>
              <option value="hotspot">Hotspot</option>
            </Select>
          </Field>
          <div className="sm:col-span-2 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}>
              Add and generate bootstrap
            </Button>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </Dialog>

      <RosScriptDialog pack={pack} onClose={() => setPack(null)} />

      <Dialog
        open={Boolean(confirmSync)}
        onOpenChange={(open) => {
          if (!open) setConfirmSync(null);
        }}
        title="Synchronize configuration"
        description={
          confirmSync
            ? `Issue a new bootstrap token for ${confirmSync.name} and queue assigned IP pools. The previous token stops working.`
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              if (!confirmSync) return;
              setBusy(true);
              try {
                const out = await reconfigureRouterFn({ data: { id: confirmSync.id } });
                setPack({
                  title: `Re-provision · ${confirmSync.name}`,
                  bootstrap: out.bootstrap,
                  enroll: out.enroll,
                });
                setConfirmSync(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Synchronize failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            Synchronize
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmSync(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={Boolean(confirmArchive)}
        onOpenChange={(open) => {
          if (!open) setConfirmArchive(null);
        }}
        title="Archive router"
        description={
          confirmArchive
            ? `Hide ${confirmArchive.name} from the live fleet. Services and history are kept. This is not a silent delete.`
            : undefined
        }
      >
        <div className="flex flex-wrap gap-2">
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (!confirmArchive) return;
              setBusy(true);
              try {
                await archiveRouterFn({ data: { id: confirmArchive.id } });
                setConfirmArchive(null);
                await load();
              } catch (err) {
                setError(err instanceof Error ? err.message : "Could not archive");
              } finally {
                setBusy(false);
              }
            }}
          >
            Archive
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirmArchive(null)}>
            Cancel
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

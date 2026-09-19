import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ConfirmPackageStatusDialog,
  PackageCards,
  PackageEmpty,
  PackageFormDialog,
  PackagePagination,
  PackageSkeleton,
  PackageTable,
  PackageToolbar,
} from "@/components/isp/packages-ui";
import { createPackage, listPackages, updatePackage } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import {
  blankPackageForm,
  capUnitOf,
  DEFAULT_PACKAGE_PAGE_SIZE,
  filterPackages,
  formFromPackage,
  paginatePackages,
  readPackagesPrefs,
  sortPackages,
  validatePackageForm,
  validityUnitOf,
  writePackagesPrefs,
  type CapUnit,
  type PackageFieldErrors,
  type PackageFormState,
  type PackagesAccessFilter,
  type PackagesPrefs,
  type PackagesSort,
  type PackagesStatusFilter,
  type PackagesView,
  type ValidityUnit,
} from "@/lib/isp/packages-ui";
import type { PackageRow } from "@/lib/isp/types";

export const Route = createFileRoute("/app/packages")({ component: PackagesPage });

function PackagesPage() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [query, setQuery] = useState("");
  const [access, setAccess] = useState<PackagesAccessFilter>("all");
  const [status, setStatus] = useState<PackagesStatusFilter>("all");
  const [sort, setSort] = useState<PackagesSort>("price");
  const [view, setView] = useState<PackagesView>("card");
  const [pageSize, setPageSize] = useState<PackagesPrefs["pageSize"]>(DEFAULT_PACKAGE_PAGE_SIZE);
  const [prefsReady, setPrefsReady] = useState(false);
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormState>(() => blankPackageForm());
  const [validityUnit, setValidityUnit] = useState<ValidityUnit>("days");
  const [capUnit, setCapUnit] = useState<CapUnit>("gb");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PackageFieldErrors>({});
  const [role, setRole] = useState("");
  const [pendingToggle, setPendingToggle] = useState<PackageRow | null>(null);

  async function load(opts?: { silent?: boolean }) {
    setLoadError(null);
    if (!opts?.silent) setLoading(true);
    try {
      const res = await listPackages();
      setPackages(res.packages);
      setRole(res.workspace.role);
    } catch (ex) {
      setLoadError(ex instanceof Error ? ex.message : "Could not load packages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  useEffect(() => {
    const prefs = readPackagesPrefs();
    setView(prefs.view);
    setPageSize(prefs.pageSize);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    writePackagesPrefs({ view, pageSize });
  }, [prefsReady, view, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [query, access, status, sort, pageSize]);

  function startCreate() {
    const method = access === "all" ? "pppoe" : access;
    setEditingId(null);
    setForm(blankPackageForm(method));
    setValidityUnit("days");
    setCapUnit("gb");
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  function startEdit(p: PackageRow) {
    setEditingId(p.id);
    setForm(formFromPackage(p));
    setValidityUnit(validityUnitOf(p.validity_hours));
    setCapUnit(capUnitOf(p.bundle_mb));
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  function closeForm(next: boolean) {
    setOpen(next);
    if (!next) {
      setEditingId(null);
      setFieldErrors({});
      setError(null);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validatePackageForm(form);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updatePackage({ data: { id: editingId, ...form } });
      } else {
        await createPackage({ data: form });
      }
      closeForm(false);
      setForm(blankPackageForm(access === "all" ? "pppoe" : access));
      await load({ silent: true });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function confirmToggle() {
    if (!pendingToggle) return;
    const p = pendingToggle;
    setBusy(true);
    try {
      await updatePackage({
        data: {
          ...formFromPackage(p),
          id: p.id,
          active: !p.active,
        },
      });
      setPendingToggle(null);
      await load({ silent: true });
    } catch (ex) {
      setLoadError(ex instanceof Error ? ex.message : "Could not update package");
    } finally {
      setBusy(false);
    }
  }

  const filtered = useMemo(
    () => sortPackages(filterPackages(packages, { q: query, access, status }), sort),
    [packages, query, access, status, sort],
  );
  const paged = paginatePackages(filtered, page, pageSize);
  const canManage = hasPermission(role, "packages.manage");
  const lockMethod = !editingId && access !== "all";

  return (
    <div className="min-w-0 space-y-5">
      <PackageToolbar
        query={query}
        access={access}
        status={status}
        sort={sort}
        view={view}
        pageSize={pageSize}
        canManage={canManage}
        onQuery={setQuery}
        onAccess={setAccess}
        onStatus={setStatus}
        onSort={setSort}
        onView={setView}
        onPageSize={(n) => setPageSize(n as PackagesPrefs["pageSize"])}
        onCreate={startCreate}
      />

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm">
          <p className="text-danger">{loadError}</p>
          <button type="button" className="text-sm font-medium text-accent hover:underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      ) : null}

      {loading ? (
        <PackageSkeleton />
      ) : paged.total === 0 ? (
        <PackageEmpty filtered={packages.length > 0} canManage={canManage} onCreate={startCreate} />
      ) : view === "card" ? (
        <PackageCards rows={paged.rows} canManage={canManage} onEdit={startEdit} onToggle={setPendingToggle} />
      ) : (
        <PackageTable rows={paged.rows} canManage={canManage} onEdit={startEdit} onToggle={setPendingToggle} />
      )}

      {!loading && paged.total > 0 ? (
        <PackagePagination
          page={paged.page}
          pages={paged.pages}
          from={paged.from}
          to={paged.to}
          total={paged.total}
          onPage={setPage}
        />
      ) : null}

      <PackageFormDialog
        open={open}
        editing={Boolean(editingId)}
        form={form}
        lockMethod={lockMethod}
        validityUnit={validityUnit}
        capUnit={capUnit}
        busy={busy}
        error={error}
        fieldErrors={fieldErrors}
        onOpenChange={closeForm}
        onChange={(next) => {
          setForm(next);
          setFieldErrors({});
        }}
        onValidityUnit={setValidityUnit}
        onCapUnit={setCapUnit}
        onSubmit={submit}
      />

      <ConfirmPackageStatusDialog
        pkg={pendingToggle}
        busy={busy}
        onOpenChange={(next) => {
          if (!next) setPendingToggle(null);
        }}
        onConfirm={() => void confirmToggle()}
      />
    </div>
  );
}

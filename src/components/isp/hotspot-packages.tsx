import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  PackageCards,
  PackageEmpty,
  PackageFormDialog,
  PackagePagination,
  PackageSkeleton,
  PackageTable,
} from "@/components/isp/packages-ui";
import { Button } from "@/components/ui/button";
import { createPackage, listPackages, updatePackage } from "@/lib/isp/server";
import { hasPermission } from "@/lib/isp/rbac";
import {
  blankPackageForm,
  capUnitOf,
  DEFAULT_PACKAGE_PAGE_SIZE,
  filterPackages,
  formFromPackage,
  paginatePackages,
  sortPackages,
  validatePackageForm,
  type CapUnit,
  type PackageFieldErrors,
  type PackageFormState,
  type PackagesSort,
  type PackagesView,
  type ValidityUnit,
} from "@/lib/isp/packages-ui";
import type { PackageRow } from "@/lib/isp/types";

export function HotspotPackagesPanel() {
  const [packages, setPackages] = useState<PackageRow[]>([]);
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<PackagesSort>("price");
  const [view, setView] = useState<PackagesView>("card");
  const [page, setPage] = useState(1);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PackageFormState>(() => blankPackageForm("hotspot"));
  const [validityUnit, setValidityUnit] = useState<ValidityUnit>("hours");
  const [capUnit, setCapUnit] = useState<CapUnit>("mb");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<PackageFieldErrors>({});

  async function load(opts?: { silent?: boolean }) {
    setLoadError(null);
    if (!opts?.silent) setLoading(true);
    try {
      const res = await listPackages();
      setPackages(res.packages.filter((p) => p.access_method === "hotspot"));
      setRole(res.workspace.role);
    } catch (ex) {
      setLoadError(ex instanceof Error ? ex.message : "Could not load hotspot packages");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const canManage = hasPermission(role, "packages.manage");
  const filtered = useMemo(
    () => sortPackages(filterPackages(packages, { q: query, access: "hotspot", status: "all" }), sort),
    [packages, query, sort],
  );
  const paged = paginatePackages(filtered, page, DEFAULT_PACKAGE_PAGE_SIZE);

  function startCreate() {
    setEditingId(null);
    setForm(blankPackageForm("hotspot"));
    setValidityUnit("hours");
    setCapUnit("mb");
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  function startEdit(p: PackageRow) {
    setEditingId(p.id);
    setForm(formFromPackage(p));
    setValidityUnit("hours");
    setCapUnit(capUnitOf(p.bundle_mb));
    setFieldErrors({});
    setError(null);
    setOpen(true);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { ...form, access_method: "hotspot" as const };
    const nextErrors = validatePackageForm(next);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      setError("Fix the highlighted fields.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editingId) {
        await updatePackage({ data: { id: editingId, ...next, active: next.active } });
      } else {
        await createPackage({ data: next });
      }
      setOpen(false);
      await load({ silent: true });
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p: PackageRow) {
    setBusy(true);
    try {
      await updatePackage({ data: { ...formFromPackage(p), id: p.id, access_method: "hotspot", active: !p.active } });
      await load({ silent: true });
    } catch (ex) {
      setLoadError(ex instanceof Error ? ex.message : "Could not update package");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Hotspot packages</h2>
          <p className="text-sm text-muted">Time-based Wi-Fi plans sold from the captive portal. No business tiers.</p>
        </div>
        {canManage ? <Button onClick={startCreate}>Create package</Button> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(1);
          }}
          placeholder="Search packages"
          aria-label="Search hotspot packages"
          className="h-9 w-full max-w-xs rounded-md border border-border bg-surface px-3 text-sm"
        />
        <select
          aria-label="Sort hotspot packages"
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
          value={sort}
          onChange={(e) => setSort(e.target.value as PackagesSort)}
        >
          <option value="price">Price</option>
          <option value="name">Name</option>
          <option value="duration">Duration</option>
          <option value="speed">Speed</option>
        </select>
        <button type="button" className="h-9 rounded-md border border-border px-3 text-sm" onClick={() => setView(view === "card" ? "list" : "card")}>
          {view === "card" ? "List" : "Cards"}
        </button>
      </div>
      {loadError ? <p className="text-sm text-danger">{loadError}</p> : null}
      {loading ? (
        <PackageSkeleton />
      ) : paged.total === 0 ? (
        <PackageEmpty filtered={packages.length > 0} canManage={canManage} onCreate={startCreate} />
      ) : view === "card" ? (
        <PackageCards rows={paged.rows} canManage={canManage} onEdit={startEdit} onToggle={toggle} />
      ) : (
        <PackageTable rows={paged.rows} canManage={canManage} onEdit={startEdit} onToggle={toggle} />
      )}
      {!loading && paged.total > 0 ? (
        <PackagePagination page={paged.page} pages={paged.pages} from={paged.from} to={paged.to} total={paged.total} onPage={setPage} />
      ) : null}
      <PackageFormDialog
        open={open}
        editing={Boolean(editingId)}
        form={form}
        lockMethod
        validityUnit={validityUnit}
        capUnit={capUnit}
        busy={busy}
        error={error}
        fieldErrors={fieldErrors}
        onOpenChange={setOpen}
        onChange={(next) => {
          setForm({ ...next, access_method: "hotspot" });
          setFieldErrors({});
        }}
        onValidityUnit={setValidityUnit}
        onCapUnit={setCapUnit}
        onSubmit={submit}
      />
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteSavedViewFn, listSavedViewsFn, saveSavedViewFn } from "@/lib/isp/server-saved-views";
import type { SavedViewRow, ViewDensity } from "@/lib/isp/saved-views";
import { parseSavedViews } from "@/lib/isp/ui-shell";

export type ViewSnapshot = {
  filters: Record<string, unknown>;
  sort?: Record<string, unknown>;
  columns?: string[];
  density?: ViewDensity;
};

function storageKey(page: string) {
  return `isp-saved-views:${page}`;
}

function asSnapshot(current: Record<string, unknown> | ViewSnapshot): ViewSnapshot {
  if (current && typeof current === "object" && current.filters && typeof current.filters === "object" && !Array.isArray(current.filters)) {
    const snap = current as ViewSnapshot;
    return {
      filters: snap.filters,
      sort: snap.sort,
      columns: snap.columns,
      density: snap.density,
    };
  }
  return { filters: current as Record<string, unknown> };
}

export function SavedViews({
  page,
  resource,
  current,
  onApply,
}: {
  page?: string;
  resource?: string;
  current: Record<string, unknown> | ViewSnapshot;
  onApply: (snapshot: ViewSnapshot) => void;
}) {
  const key = resource || page || "view";
  const [views, setViews] = useState<SavedViewRow[]>([]);
  const [name, setName] = useState("");
  const [shared, setShared] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function reload() {
    const res = await listSavedViewsFn({ data: { resource: key } });
    setViews(res.rows);
    return res.rows;
  }

  useEffect(() => {
    let cancel = false;
    reload()
      .then(async (rows) => {
        if (cancel) return;
        let legacy: ReturnType<typeof parseSavedViews> = [];
        try {
          legacy = parseSavedViews(localStorage.getItem(storageKey(key)));
        } catch {
          legacy = [];
        }
        if (!legacy.length || rows.length) return;
        for (const view of legacy) {
          await saveSavedViewFn({
            data: {
              name: view.name,
              resource: key,
              filters: view.filters,
              sort: view.sort,
              columns: view.columns,
              density: view.density,
              is_shared: view.scope === "team",
            },
          });
        }
        try {
          localStorage.removeItem(storageKey(key));
        } catch {
          /* private mode */
        }
        if (!cancel) await reload();
      })
      .catch((err) => {
        if (!cancel) setError(err instanceof Error ? err.message : "Could not load views");
      });
    return () => {
      cancel = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const mine = views.filter((row) => !row.is_shared);
  const team = views.filter((row) => row.is_shared);

  function apply(id: string) {
    setPicked(id);
    const view = views.find((row) => row.id === id);
    if (!view) return;
    onApply({ filters: view.filters, sort: view.sort, columns: view.columns, density: view.density });
  }

  async function save(id?: string) {
    const existing = id ? views.find((row) => row.id === id) : undefined;
    const label = (id ? existing?.name : name.trim()) || "";
    if (!label) return;
    const snap = asSnapshot(current);
    setBusy(true);
    setError("");
    try {
      await saveSavedViewFn({
        data: {
          id,
          name: label,
          resource: key,
          filters: snap.filters,
          sort: snap.sort || {},
          columns: snap.columns || [],
          density: snap.density || "comfortable",
          is_shared: existing ? existing.is_shared : shared,
        },
      });
      setName("");
      setShared(false);
      setOpen(false);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the view");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!picked) return;
    setBusy(true);
    setError("");
    try {
      await deleteSavedViewFn({ data: { id: picked } });
      setPicked("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the view");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs text-muted" htmlFor={`saved-views-${key}`}>
        My views
      </label>
      <select
        id={`saved-views-${key}`}
        className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-sm"
        value={mine.some((row) => row.id === picked) ? picked : ""}
        onChange={(e) => apply(e.target.value)}
      >
        <option value="">Personal views</option>
        {mine.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
      </select>
      <label className="text-xs text-muted" htmlFor={`team-views-${key}`}>
        Team views
      </label>
      <select
        id={`team-views-${key}`}
        className="h-9 max-w-full rounded-md border border-border bg-surface px-2 text-sm"
        value={team.some((row) => row.id === picked) ? picked : ""}
        onChange={(e) => apply(e.target.value)}
        aria-label="Team views"
      >
        <option value="">Team views</option>
        {team.map((view) => (
          <option key={view.id} value={view.id}>
            {view.name}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        Save view
      </Button>
      {picked ? (
        <>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void save(picked)}>
            Update view
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
            Delete view
          </Button>
        </>
      ) : null}
      {open ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <input
            aria-label="View name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Overdue customers"
            className="h-9 rounded-md border border-border bg-bg px-2 text-sm"
          />
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
            Share with team
          </label>
          <Button type="submit" size="sm" disabled={!name.trim() || busy}>
            {busy ? "Saving..." : "Save"}
          </Button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-danger">{error}</p> : null}
    </div>
  );
}

import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { commandSearchFn, type SearchHit } from "@/lib/isp/server-search";

export function CommandPalette() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handle = window.setTimeout(() => {
      const query = q.trim();
      if (query.length < 2) {
        setHits([]);
        return;
      }
      setBusy(true);
      commandSearchFn({ data: { q: query } })
        .then((rows) => {
          setHits(rows);
          setActive(0);
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 200);
    return () => window.clearTimeout(handle);
  }, [q, open]);

  const groups = useMemo(() => {
    const map = new Map<string, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.group) || [];
      list.push(hit);
      map.set(hit.group, list);
    }
    return [...map.entries()];
  }, [hits]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    void navigate({ href: hit.href });
  }

  return (
    <>
      <button
        type="button"
        className="hidden h-11 items-center gap-2 rounded-md border border-border bg-bg px-3 text-sm text-muted hover:text-fg md:inline-flex"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K"
      >
        <Search className="size-4" />
        Search
        <kbd className="rounded border border-border px-1.5 text-[10px]">Ctrl K</kbd>
      </button>
      <button type="button" className="grid size-11 place-items-center md:hidden" aria-label="Search" onClick={() => setOpen(true)}>
        <Search className="size-5" />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQ("");
        }}
        title="Search"
        description="Customers, leads, services, invoices, payments, routers, and tickets."
      >
        <input
          ref={box}
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search the workspace"
          aria-label="Search the workspace"
          aria-activedescendant={hits[active] ? `cmd-${hits[active].id}` : undefined}
          className="h-11 w-full rounded-md border border-border bg-bg px-3 text-sm"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((n) => Math.min(hits.length - 1, n + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((n) => Math.max(0, n - 1));
            } else if (event.key === "Enter" && hits[active]) {
              event.preventDefault();
              go(hits[active]);
            }
          }}
        />
        <div className="mt-3 max-h-80 overflow-y-auto" role="listbox" aria-label="Search results">
          {busy ? <p className="text-sm text-muted">Searching…</p> : null}
          {!busy && q.trim().length >= 2 && !hits.length ? <p className="text-sm text-muted">No matches.</p> : null}
          {groups.map(([group, rows]) => (
            <div key={group} className="mb-3">
              <p className="px-1 text-xs font-medium tracking-wide text-subtle uppercase">{group}</p>
              <ul>
                {rows.map((hit) => {
                  const index = hits.findIndex((row) => row.id === hit.id && row.group === hit.group);
                  return (
                    <li key={`${hit.group}-${hit.id}`}>
                      <button
                        id={`cmd-${hit.id}`}
                        type="button"
                        role="option"
                        aria-selected={index === active}
                        className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-elevated aria-selected:bg-elevated"
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit)}
                      >
                        <span className="truncate">{hit.label}</span>
                        <span className="truncate text-xs text-muted">{hit.hint}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

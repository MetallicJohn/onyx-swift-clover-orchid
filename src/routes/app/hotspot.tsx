import { createFileRoute } from "@tanstack/react-router";
import { LayoutGrid, List } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { HotspotBuilderPanel } from "@/components/isp/hotspot-builder";
import { HotspotDashboardPanel, HotspotSessionsPanel } from "@/components/isp/hotspot-dashboard";
import { HotspotPackagesPanel } from "@/components/isp/hotspot-packages";
import { Badge, statusTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { activateHotspotVoucher, createVouchers, listHotspot, revokeHotspotVoucher } from "@/lib/isp/server-ops";
import { cn } from "@/lib/utils";

type TabId = "dashboard" | "packages" | "vouchers" | "sessions" | "builder";

export const Route = createFileRoute("/app/hotspot")({
  validateSearch: (search: Record<string, unknown>): { tab?: TabId } => ({
    tab: isTabId(search.tab) ? search.tab : undefined,
  }),
  component: HotspotPage,
});

const TABS: { id: TabId; label: string }[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "packages", label: "Packages" },
  { id: "vouchers", label: "Vouchers" },
  { id: "sessions", label: "Sessions" },
  { id: "builder", label: "Builder" },
];

function isTabId(value: unknown): value is TabId {
  return TABS.some((t) => t.id === value);
}

const PAGE_SIZES = [10, 25, 50, 100] as const;
const PREFS_KEY = "isp-hotspot-prefs.v1";

type ViewMode = "grid" | "list";
type PageSize = (typeof PAGE_SIZES)[number];
type Voucher = Awaited<ReturnType<typeof listHotspot>>["vouchers"][number];

function toneFor(status: string) {
  if (status === "unused") return statusTone("pending");
  if (status === "active") return statusTone("active");
  if (status === "expired") return statusTone("grace");
  return statusTone("suspended");
}

function isPageSize(value: number): value is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(value);
}

function readPrefs(): { view: ViewMode; pageSize: PageSize } {
  const fallback = { view: "grid" as const, pageSize: 25 as PageSize };
  if (typeof sessionStorage === "undefined") return fallback;
  try {
    const raw = sessionStorage.getItem(PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as { view?: string; pageSize?: number };
    return {
      view: parsed.view === "list" ? "list" : "grid",
      pageSize: isPageSize(Number(parsed.pageSize)) ? (Number(parsed.pageSize) as PageSize) : 25,
    };
  } catch {
    return fallback;
  }
}

function writePrefs(prefs: { view: ViewMode; pageSize: PageSize }) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

function untilLabel(expiresAt: string | null) {
  return expiresAt ? expiresAt.slice(0, 16).replace("T", " ") : "";
}

function HotspotVouchers() {
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [packages, setPackages] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({ package_id: "", count: 5, hours: 24 });
  const [codes, setCodes] = useState<string[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("grid");
  const [pageSize, setPageSize] = useState<PageSize>(25);
  const [prefsReady, setPrefsReady] = useState(false);
  const [page, setPage] = useState(1);

  async function load() {
    const r = await listHotspot();
    setVouchers(r.vouchers);
    setPackages(r.packages);
    if (!form.package_id && r.packages[0]) setForm((f) => ({ ...f, package_id: r.packages[0].id }));
  }
  useEffect(() => {
    load().catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const prefs = readPrefs();
    setView(prefs.view);
    setPageSize(prefs.pageSize);
    setPrefsReady(true);
  }, []);

  useEffect(() => {
    if (!prefsReady) return;
    writePrefs({ view, pageSize });
  }, [prefsReady, view, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [pageSize, vouchers.length]);

  const pages = Math.max(1, Math.ceil(vouchers.length / pageSize) || 1);
  const currentPage = Math.min(page, pages);
  const pageRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return vouchers.slice(start, start + pageSize);
  }, [vouchers, currentPage, pageSize]);
  const from = vouchers.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const to = Math.min(currentPage * pageSize, vouchers.length);

  async function activate(v: Voucher) {
    const r = await activateHotspotVoucher({ data: { id: v.id } });
    setNote(`Activated ${r.code} until ${r.expires_at.slice(0, 16).replace("T", " ")}`);
    await load();
  }

  async function revoke(v: Voucher) {
    await revokeHotspotVoucher({ data: { id: v.id } });
    await load();
  }

  function actionsFor(v: Voucher) {
    return (
      <div className="flex flex-wrap gap-1">
        {v.status === "unused" ? (
          <Button size="sm" variant="secondary" onClick={() => void activate(v)}>
            Activate
          </Button>
        ) : null}
        {v.status === "unused" || v.status === "active" ? (
          <Button size="sm" variant="ghost" onClick={() => void revoke(v)}>
            Revoke
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await createVouchers({ data: form });
          setCodes(r.codes);
          await load();
        }}
      >
        <Field label="Package">
          <Select value={form.package_id} onChange={(e) => setForm({ ...form, package_id: e.target.value })}>
            {packages.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Count">
          <Input type="number" min={1} max={50} value={form.count} onChange={(e) => setForm({ ...form, count: Number(e.target.value) })} />
        </Field>
        <Field label="Hours after activate">
          <Input type="number" min={1} value={form.hours} onChange={(e) => setForm({ ...form, hours: Number(e.target.value) })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit">Generate</Button>
        </div>
      </form>

      {codes.length ? <p className="rounded-xl border border-border bg-elevated p-3 font-mono text-xs">{codes.join("  ")}</p> : null}
      {note ? <p className="text-sm text-accent">{note}</p> : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex rounded-lg border border-border bg-surface p-1" role="group" aria-label="Voucher view">
          <button
            type="button"
            aria-pressed={view === "grid"}
            aria-label="Grid view"
            className={cn(
              "inline-flex size-9 items-center justify-center rounded-md",
              view === "grid" ? "bg-accent text-accent-fg" : "text-muted hover:text-fg",
            )}
            onClick={() => setView("grid")}
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
            onClick={() => setView("list")}
          >
            <List className="size-4" strokeWidth={1.75} />
          </button>
        </div>
        <Select
          aria-label="Vouchers per page"
          className="h-9 w-28"
          value={String(pageSize)}
          onChange={(e) => setPageSize(Number(e.target.value) as PageSize)}
        >
          {PAGE_SIZES.map((n) => (
            <option key={n} value={n}>
              {n} / page
            </option>
          ))}
        </Select>
      </div>

      {view === "grid" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pageRows.map((v) => (
            <article key={v.id} className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between">
                <div className="font-mono text-sm">{v.code}</div>
                <Badge tone={toneFor(v.status)}>{v.status}</Badge>
              </div>
              <p className="mt-2 text-sm text-muted">
                {v.package_name} · {v.hours}h
                {v.expires_at ? ` · until ${untilLabel(v.expires_at)}` : ""}
              </p>
              <div className="mt-3">{actionsFor(v)}</div>
            </article>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Code</th>
                <th className="px-4 py-3 font-medium">Package</th>
                <th className="px-4 py-3 font-medium">Hours</th>
                <th className="px-4 py-3 font-medium">Expires</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pageRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted" colSpan={6}>
                    No vouchers yet.
                  </td>
                </tr>
              ) : (
                pageRows.map((v) => (
                  <tr key={v.id}>
                    <td className="px-4 py-3 font-mono text-xs">{v.code}</td>
                    <td className="px-4 py-3">{v.package_name}</td>
                    <td className="px-4 py-3 tabular-nums">{v.hours}h</td>
                    <td className="px-4 py-3 text-xs text-muted">{untilLabel(v.expires_at) || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge tone={toneFor(v.status)}>{v.status}</Badge>
                    </td>
                    <td className="px-4 py-3">{actionsFor(v)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {vouchers.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <p>
            {from}–{to} of {vouchers.length}
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>
              Previous
            </Button>
            <span className="px-1 tabular-nums">
              {currentPage} / {pages}
            </span>
            <Button size="sm" variant="secondary" disabled={currentPage >= pages} onClick={() => setPage(currentPage + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function HotspotPage() {
  const navigate = Route.useNavigate();
  const { tab: tabParam } = Route.useSearch();
  const tab: TabId = tabParam ?? "dashboard";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Hotspot</h1>
        <p className="text-sm text-muted">Revenue, live sessions, vouchers, and login pages for this ISP’s hotspot network.</p>
      </div>

      <div role="tablist" aria-label="Hotspot sections" className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={cn(
              "h-11 shrink-0 rounded-lg px-4 text-sm font-medium transition-colors",
              tab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:bg-elevated hover:text-fg",
            )}
            onClick={() => {
              void navigate({ search: { tab: t.id === "dashboard" ? undefined : t.id }, replace: true });
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "dashboard" ? <HotspotDashboardPanel /> : null}
      {tab === "packages" ? <HotspotPackagesPanel /> : null}
      {tab === "vouchers" ? <HotspotVouchers /> : null}
      {tab === "sessions" ? <HotspotSessionsPanel /> : null}
      {tab === "builder" ? <HotspotBuilderPanel /> : null}
    </div>
  );
}

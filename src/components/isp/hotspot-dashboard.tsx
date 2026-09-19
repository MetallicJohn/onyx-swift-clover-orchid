import { Link } from "@tanstack/react-router";
import {
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Radio,
  Router as RouterIcon,
  Wifi,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/input";
import {
  HOTSPOT_DASH_POLL_MS,
  HOTSPOT_STALE_MS,
  moneyKes,
  type HotspotRouterStatus,
} from "@/lib/isp/hotspot-dashboard-format";
import type { HotspotDashboard } from "@/lib/isp/hotspot-dashboard";
import { getHotspotDashboardFn } from "@/lib/isp/server-hotspot";
import { formatDateTime } from "@/lib/isp/display";
import { cn } from "@/lib/utils";

type DashPayload = Awaited<ReturnType<typeof getHotspotDashboardFn>>;

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={cn("rounded-xl bg-surface p-4 shadow-card md:p-5", className)}>{children}</section>;
}

function Kpi({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "accent",
  unavailable,
}: {
  label: string;
  value: string;
  hint: string;
  delta?: number;
  icon: typeof Wifi;
  tone?: "accent" | "ok" | "warn" | "danger";
  unavailable?: string | null;
}) {
  const chip =
    tone === "ok"
      ? "bg-ok/15 text-ok"
      : tone === "warn"
        ? "bg-warn/15 text-warn"
        : tone === "danger"
          ? "bg-danger/15 text-danger"
          : "bg-accent/15 text-accent";
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className={cn("grid size-11 shrink-0 place-items-center rounded-md", chip)}>
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
        {typeof delta === "number" && !unavailable ? (
          <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", delta >= 0 ? "text-ok" : "text-danger")}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
      <div className="mt-4 text-xs tracking-wide text-muted uppercase">{label}</div>
      {unavailable ? (
        <>
          <div className="mt-1 text-lg font-medium text-muted">Unavailable</div>
          <div className="mt-2 text-sm text-subtle">{unavailable}</div>
        </>
      ) : (
        <>
          <div className="mt-1 font-mono text-2xl tracking-tight tabular-nums md:text-3xl">{value}</div>
          <div className="mt-2 text-sm text-subtle">{hint}</div>
        </>
      )}
    </Card>
  );
}

function RevenueChart({ days, currency }: { days: Array<{ day: string; amount: number }>; currency: string }) {
  const max = Math.max(1, ...days.map((d) => d.amount));
  return (
    <div className="flex h-36 items-end gap-1.5 sm:gap-2">
      {days.map((d) => {
        const pct = Math.max(d.amount > 0 ? 8 : 2, Math.round((d.amount / max) * 100));
        return (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-28 w-full items-end justify-center">
              <div
                title={`${d.day} · ${moneyKes(d.amount, currency)}`}
                className="w-full max-w-8 rounded-sm bg-chart/80"
                style={{ height: `${pct}%`, opacity: d.amount ? 1 : 0.25 }}
              />
            </div>
            <span className="hidden w-full truncate text-center text-[10px] text-subtle sm:block">{d.day.slice(5)}</span>
          </div>
        );
      })}
    </div>
  );
}

function routerTone(status: HotspotRouterStatus) {
  if (status === "online") return statusTone("online");
  if (status === "warning") return statusTone("grace");
  if (status === "offline") return statusTone("offline");
  return "muted";
}

function authReason(reason: string | null) {
  if (reason === "not_authorised") return "Not authorised to view this figure.";
  if (reason === "radius_unavailable") return "RADIUS accounting is not connected.";
  return reason || "Data not connected.";
}

export function HotspotDashboardPanel() {
  const [payload, setPayload] = useState<DashPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [routerQ, setRouterQ] = useState("");
  const [routerStatus, setRouterStatus] = useState<"all" | HotspotRouterStatus>("all");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;

    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await getHotspotDashboardFn();
        if (cancelled) return;
        setPayload(next);
        setError(null);
        setFetchedAt(Date.now());
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load hotspot dashboard");
      }
    }

    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load().finally(() => {
          if (!cancelled) schedule();
        });
      }, HOTSPOT_DASH_POLL_MS);
    }

    function onVis() {
      if (document.visibilityState === "visible") void load();
    }

    void load().finally(() => {
      if (!cancelled) schedule();
    });
    document.addEventListener("visibilitychange", onVis);
    const clock = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const stale = fetchedAt != null && now - fetchedAt > HOTSPOT_STALE_MS;
  const dash: HotspotDashboard | null = payload?.dashboard ?? null;
  const can = payload?.can;

  const routers = useMemo(() => {
    const rows = dash?.routers.rows ?? [];
    const q = routerQ.trim().toLowerCase();
    return rows.filter((r) => {
      if (routerStatus !== "all" && r.status !== routerStatus) return false;
      if (!q) return true;
      return [r.name, r.identity, r.management_ip, r.location].join(" ").toLowerCase().includes(q);
    });
  }, [dash, routerQ, routerStatus]);

  if (error && !dash) {
    return (
      <Card>
        <p className="text-sm text-danger">{error}</p>
      </Card>
    );
  }
  if (!dash) {
    return (
      <Card>
        <p className="text-sm text-muted">Loading hotspot activity…</p>
      </Card>
    );
  }

  const currency = dash.currency || "KES";
  const liveSessions = dash.sessions.rows.filter((s) => s.status === "online");
  const revHint = dash.revenue.available
    ? `${dash.revenue.today_count} payment${dash.revenue.today_count === 1 ? "" : "s"} · vs yesterday`
    : authReason(dash.revenue.reason);
  const monthHint = dash.revenue.available
    ? `${dash.revenue.month_count} payment${dash.revenue.month_count === 1 ? "" : "s"} this month`
    : authReason(dash.revenue.reason);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-subtle">
        <p>
          Last updated {dash.generated_at ? formatDateTime(dash.generated_at) : "—"} · {dash.timezone}
        </p>
        {stale ? <span className="text-warn">Showing last known data</span> : null}
        {error ? <span className="text-danger">{error}</span> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Revenue today"
          value={moneyKes(dash.revenue.today_kes, currency)}
          hint={revHint}
          delta={dash.revenue.available && (dash.revenue.today_kes > 0 || dash.revenue.yesterday_kes > 0) ? dash.revenue.today_delta_pct : undefined}
          icon={CreditCard}
          tone="ok"
          unavailable={dash.revenue.available ? null : authReason(dash.revenue.reason)}
        />
        <Kpi
          label="Revenue this month"
          value={moneyKes(dash.revenue.month_kes, currency)}
          hint={monthHint}
          delta={dash.revenue.available && (dash.revenue.month_kes > 0 || dash.revenue.prev_month_kes > 0) ? dash.revenue.month_delta_pct : undefined}
          icon={CreditCard}
          tone="accent"
          unavailable={dash.revenue.available ? null : authReason(dash.revenue.reason)}
        />
        <Kpi
          label="Online routers"
          value={dash.routers.available ? `${dash.routers.online}/${dash.routers.total}` : "—"}
          hint={
            dash.routers.available
              ? dash.routers.total
                ? `${dash.routers.pct}% online`
                : "No hotspot routers. Set a router’s role to Hotspot."
              : authReason(dash.routers.reason)
          }
          icon={RouterIcon}
          tone={dash.routers.online === dash.routers.total && dash.routers.total > 0 ? "ok" : "warn"}
          unavailable={dash.routers.available ? null : authReason(dash.routers.reason)}
        />
        <Kpi
          label="Online sessions"
          value={dash.sessions.available ? String(dash.sessions.active) : "—"}
          hint={
            dash.sessions.available
              ? `${dash.sessions.unique_users} users · ${dash.sessions.started_today} started today`
              : authReason(dash.sessions.reason)
          }
          icon={Wifi}
          tone="accent"
          unavailable={dash.sessions.available ? null : authReason(dash.sessions.reason)}
        />
      </div>

      {dash.alerts.length ? (
        <Card className="border border-warn/30">
          <h2 className="mb-3 text-sm font-medium">Alerts</h2>
          <ul className="grid gap-2">
            {dash.alerts.map((a, i) => (
              <li key={`${a.kind}-${i}`} className="flex items-start gap-2 text-sm">
                <Radio className="mt-0.5 size-4 shrink-0 text-warn" strokeWidth={1.75} />
                <span>
                  <span className="font-medium">{a.title}</span>
                  <span className="text-muted"> — {a.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {can?.revenue && dash.revenue.available ? (
        <Card>
          <h2 className="mb-1 text-sm font-medium">Revenue overview</h2>
          <p className="mb-4 text-sm text-muted">
            {moneyKes(dash.revenue.today_kes, currency)} today · {moneyKes(dash.revenue.month_kes, currency)} this month
          </p>
          {dash.revenue.days.length ? <RevenueChart days={dash.revenue.days} currency={currency} /> : <p className="text-sm text-muted">No hotspot receipts in the last 14 days.</p>}
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-medium">Hotspot routers</h2>
            <div className="flex flex-wrap gap-2">
              <Input
                aria-label="Search routers"
                className="h-9 w-40"
                placeholder="Search"
                value={routerQ}
                onChange={(e) => setRouterQ(e.target.value)}
              />
              <Select aria-label="Router status" className="h-9 w-32" value={routerStatus} onChange={(e) => setRouterStatus(e.target.value as typeof routerStatus)}>
                <option value="all">All</option>
                <option value="online">Online</option>
                <option value="warning">Warning</option>
                <option value="offline">Offline</option>
                <option value="unknown">Unknown</option>
              </Select>
            </div>
          </div>
          {!dash.routers.available ? (
            <p className="py-6 text-sm text-muted">{authReason(dash.routers.reason)}</p>
          ) : routers.length === 0 ? (
            <p className="py-6 text-sm text-muted">
              {dash.routers.total === 0
                ? "No hotspot routers. Set a router’s role to Hotspot."
                : "No routers match that filter."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">Router</th>
                    <th className="pb-2 pr-3 font-medium">Location</th>
                    <th className="pb-2 pr-3 font-medium">IP</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {routers.map((r) => (
                    <tr key={r.id}>
                      <td className="py-2 pr-3">
                        <Link to="/app/routers/$routerId" params={{ routerId: r.id }} className="text-accent hover:underline">
                          {r.name}
                        </Link>
                        <div className="font-mono text-[11px] text-subtle">{r.identity || r.id.slice(0, 10)}</div>
                      </td>
                      <td className="py-2 pr-3 text-muted">{r.location || "—"}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{r.management_ip || "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge tone={routerTone(r.status)}>{r.status}</Badge>
                      </td>
                      <td className="py-2 text-xs text-muted">{r.last_seen ? formatDateTime(r.last_seen) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="mb-3 text-sm font-medium">Active sessions</h2>
          {!dash.sessions.available ? (
            <p className="py-6 text-sm text-muted">{authReason(dash.sessions.reason)}</p>
          ) : liveSessions.length === 0 ? (
            <p className="py-6 text-sm text-muted">No live hotspot sessions. Counts come from RADIUS accounting, not customer totals.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">User</th>
                    <th className="pb-2 pr-3 font-medium">SAN</th>
                    <th className="pb-2 pr-3 font-medium">Router</th>
                    <th className="pb-2 pr-3 font-medium">Duration</th>
                    <th className="pb-2 font-medium">Usage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {liveSessions.slice(0, 12).map((s) => (
                    <tr key={s.id}>
                      <td className="py-2 pr-3">
                        <div className="font-mono text-xs">{s.username}</div>
                        {can?.customers && s.customer_name ? <div className="text-xs text-muted">{s.customer_name}</div> : null}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{s.service_account_number || "—"}</td>
                      <td className="py-2 pr-3">{s.router_name || s.nas_ip || "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{s.duration}</td>
                      <td className="py-2 tabular-nums">{s.usage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {can?.revenue ? (
        <Card>
          <h2 className="mb-3 text-sm font-medium">Recent hotspot payments</h2>
          {dash.payments.length === 0 ? (
            <p className="py-6 text-sm text-muted">No confirmed hotspot payments yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">When</th>
                    <th className="pb-2 pr-3 font-medium">Customer / SAN</th>
                    <th className="pb-2 pr-3 font-medium">Amount</th>
                    <th className="pb-2 pr-3 font-medium">Reference</th>
                    <th className="pb-2 font-medium">Method</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {dash.payments.map((p) => (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 text-xs">{formatDateTime(p.paid_at)}</td>
                      <td className="py-2 pr-3">
                        <div>{p.customer_name || "—"}</div>
                        <div className="font-mono text-[11px] text-subtle">{p.service_account_number || ""}</div>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{moneyKes(p.amount_kes, currency)}</td>
                      <td className="py-2 pr-3 font-mono text-xs">{p.reference}</td>
                      <td className="py-2">
                        <Badge tone={statusTone(p.status)}>{p.provider}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}
    </div>
  );
}

export function HotspotSessionsPanel() {
  const [payload, setPayload] = useState<DashPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    async function load() {
      if (document.visibilityState === "hidden") return;
      try {
        const next = await getHotspotDashboardFn();
        if (!cancelled) {
          setPayload(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load sessions");
      }
    }
    function schedule() {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load().finally(() => {
          if (!cancelled) schedule();
        });
      }, HOTSPOT_DASH_POLL_MS);
    }
    void load().finally(() => {
      if (!cancelled) schedule();
    });
    const onVis = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const rows = (payload?.dashboard.sessions.rows ?? []).filter((s) => {
    const needle = q.trim().toLowerCase();
    if (!needle) return true;
    return [s.username, s.customer_name, s.service_account_number, s.router_name, s.framed_ip].join(" ").toLowerCase().includes(needle);
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Live and recent hotspot sessions from RADIUS accounting.</p>
        <Input aria-label="Search sessions" className="h-9 w-48" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {!payload?.dashboard.sessions.available ? (
        <p className="rounded-xl border border-border bg-surface p-4 text-sm text-muted">
          {payload ? authReason(payload.dashboard.sessions.reason) : "Loading sessions…"}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-surface text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">SAN</th>
                <th className="px-4 py-3 font-medium">Router</th>
                <th className="px-4 py-3 font-medium">IP</th>
                <th className="px-4 py-3 font-medium">Login</th>
                <th className="px-4 py-3 font-medium">Duration</th>
                <th className="px-4 py-3 font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-muted" colSpan={8}>
                    Sessions appear when RADIUS accounting is received.
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id}>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs">{s.username}</div>
                      {payload.can.customers && s.customer_name ? <div className="text-xs text-muted">{s.customer_name}</div> : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{s.service_account_number || "—"}</td>
                    <td className="px-4 py-3">{s.router_name || s.nas_ip || "—"}</td>
                    <td className="px-4 py-3 font-mono text-xs">{s.framed_ip || "—"}</td>
                    <td className="px-4 py-3 text-xs">{formatDateTime(s.started_at)}</td>
                    <td className="px-4 py-3 tabular-nums">{s.duration}</td>
                    <td className="px-4 py-3 tabular-nums">{s.usage}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(s.status === "online" ? "online" : "offline")}>{s.status}</Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

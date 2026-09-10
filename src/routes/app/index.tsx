import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  CreditCard,
  Radio,
  Router as RouterIcon,
  UserPlus,
  Wifi,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Badge, statusTone } from "@/components/ui/badge";
import { getDashboard } from "@/lib/isp/server";
import type { DashboardData } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

export const Route = createFileRoute("/app/")({ component: Overview });

function deltaPct(current: number, previous: number) {
  if (previous <= 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone: "Africa/Nairobi" }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Intl.DateTimeFormat("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Africa/Nairobi",
  }).format(new Date());
}

function shortDay(iso: string) {
  const d = iso.length <= 10 ? `${iso.slice(0, 10)}T12:00:00Z` : iso;
  return new Intl.DateTimeFormat("en-KE", { day: "numeric", month: "short" }).format(new Date(d));
}

function timeAgo(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return shortDay(iso);
}

function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-xl bg-surface p-5 shadow-card md:p-6", className)}>{children}</section>
  );
}

function churnTone(band: string) {
  if (band === "high" || band === "churned") return "danger" as const;
  if (band === "medium") return "warn" as const;
  return "ok" as const;
}

function CardHead({ title, to, link }: { title: string; to?: "/app/billing" | "/app/tickets" | "/app/routers" | "/app/services" | "/app/customers"; link?: string }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-3">
      <h2 className="text-base font-medium tracking-tight">{title}</h2>
      {to && link ? (
        <Link to={to} className="min-h-11 text-sm text-accent hover:underline">
          {link}
        </Link>
      ) : null}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-6 text-sm text-muted">{text}</p>;
}

function Kpi({
  label,
  value,
  hint,
  delta,
  icon: Icon,
  tone = "accent",
}: {
  label: string;
  value: string;
  hint: string;
  delta?: number;
  icon: typeof Activity;
  tone?: "accent" | "ok" | "warn" | "danger";
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
        {typeof delta === "number" ? (
          <span className={cn("inline-flex items-center gap-0.5 text-xs tabular-nums", delta >= 0 ? "text-ok" : "text-danger")}>
            {delta >= 0 ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
            {Math.abs(delta)}%
          </span>
        ) : null}
      </div>
      <div className="mt-5 text-xs tracking-wide text-muted uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl tracking-tight tabular-nums md:text-3xl">{value}</div>
      <div className="mt-2 text-sm text-subtle">{hint}</div>
    </Card>
  );
}

function RevenueChart({ days }: { days: DashboardData["revenueDays"] }) {
  const max = Math.max(1, ...days.map((d) => d.amount));
  return (
    <div className="flex h-44 items-end gap-1.5 sm:gap-2">
      {days.map((d) => {
        const pct = Math.max(d.amount > 0 ? 8 : 2, Math.round((d.amount / max) * 100));
        return (
          <div key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-2">
            <div className="flex h-36 w-full items-end justify-center">
              <div
                title={`${shortDay(d.day)} · ${kes(d.amount)}`}
                className="w-full max-w-8 rounded-sm bg-chart/80 transition-opacity hover:opacity-100 sm:max-w-none"
                style={{ height: `${pct}%`, opacity: d.amount ? 1 : 0.25 }}
              />
            </div>
            <span className="hidden w-full truncate text-center text-[10px] text-subtle sm:block">{shortDay(d.day)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Overview() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDashboard()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  if (error) {
    return (
      <Card>
        <p className="text-danger">{error}</p>
      </Card>
    );
  }
  if (!data) return <Skeleton />;

  const t = data.totals;
  const revDelta = deltaPct(t.revenueMonth, t.revenueLastMonth);
  const monthTotal = data.revenueDays.reduce((s, d) => s + d.amount, 0);

  return (
    <div className="space-y-6 md:space-y-8">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">{todayLabel()}</p>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
          {greeting()}, {data.workspace.tenantName}
        </h1>
        <p className="text-sm text-subtle">Collections, access, and network for today.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Kpi
          label="This month"
          value={kes(t.revenueMonth)}
          hint={`${kes(t.paymentsToday)} today · ${t.paymentsTodayCount} receipts`}
          delta={t.revenueLastMonth > 0 ? revDelta : undefined}
          icon={CreditCard}
          tone="ok"
        />
        <Kpi
          label="Outstanding"
          value={kes(t.outstanding)}
          hint={`${t.renewalsToday} due in the next 3 days`}
          icon={Activity}
          tone={t.outstanding > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="Online"
          value={String(t.online)}
          hint={`${t.grace} in grace · ${t.suspended} suspended`}
          icon={Wifi}
          tone={t.suspended > 0 ? "warn" : "ok"}
        />
        <Kpi
          label="New connections"
          value={String(t.connectionsWeek)}
          hint={`${t.connectionsToday} provisioned today`}
          icon={UserPlus}
        />
        <Kpi
          label="Network"
          value={`${t.routersOnline}/${t.routersTotal}`}
          hint={`${t.liveSessions} live sessions · CPU ${t.avgCpu}%`}
          icon={RouterIcon}
          tone={t.routersTotal > 0 && t.routersOnline === t.routersTotal ? "ok" : "warn"}
        />
        <Kpi
          label="Customers"
          value={String(t.customers)}
          hint={`${t.atRiskHigh} high risk · ${t.atRiskMedium} watch`}
          icon={Radio}
          tone={t.atRiskHigh > 0 ? "danger" : t.atRiskMedium > 0 ? "warn" : "ok"}
        />
      </div>

      <Card>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-base font-medium tracking-tight">Revenue, last 14 days</h2>
            <p className="mt-1 text-sm text-muted">{kes(monthTotal)} confirmed in this window</p>
          </div>
          <Link to="/app/billing" className="min-h-11 text-sm text-accent hover:underline">
            Billing
          </Link>
        </div>
        {data.revenueDays.every((d) => d.amount === 0) ? <Empty text="No confirmed payments in the last two weeks." /> : <RevenueChart days={data.revenueDays} />}
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <Card>
          <CardHead title="Churn risk" to="/app/customers" link="Customers" />
          {data.atRisk.length === 0 ? (
            <Empty text="No customers above the watch threshold." />
          ) : (
            <ul className="divide-y divide-border">
              {data.atRisk.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{c.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{c.reason || "Elevated score"}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm tabular-nums">{c.score}</div>
                    <Badge tone={churnTone(c.band)}>{c.band}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Recent payments" to="/app/billing" link="All receipts" />
          {data.recentPayments.length === 0 ? (
            <Empty text="No payments yet." />
          ) : (
            <ul className="divide-y divide-border">
              {data.recentPayments.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{p.customer_name}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">
                      {p.provider} · {p.reference}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm tabular-nums">{kes(p.amount_kes)}</div>
                    <div className="text-xs text-subtle">{timeAgo(p.paid_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Expected renewals" to="/app/services" link="Services" />
          {data.renewals.length === 0 && data.dueInvoices.length === 0 ? (
            <Empty text="Nothing coming due in the next three days." />
          ) : (
            <ul className="divide-y divide-border">
              {data.renewals.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.customer_name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {r.package_name} · {shortDay(r.period_end)}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm tabular-nums">{kes(r.price_kes)}</div>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </div>
                </li>
              ))}
              {data.dueInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center justify-between gap-3 py-3.5 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{inv.customer_name}</div>
                    <div className="mt-0.5 font-mono text-xs text-muted">
                      {inv.number} · due {shortDay(inv.due_date)}
                    </div>
                  </div>
                  <div className="font-mono text-sm tabular-nums">{kes(Math.max(0, inv.amount_kes - inv.paid_kes))}</div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-5">
        <Card>
          <CardHead title="New connections" to="/app/customers" link="Customers" />
          {data.newConnections.length === 0 ? (
            <Empty text="No services provisioned yet." />
          ) : (
            <ul className="divide-y divide-border">
              {data.newConnections.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="truncate text-sm">{s.customer_name}</div>
                    <div className="mt-0.5 text-xs text-muted">
                      {s.package_name} · {s.access_method}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                    <div className="mt-1 text-xs text-subtle">{timeAgo(s.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHead title="Tickets" to="/app/tickets" link="All tickets" />
          {data.recentTickets.length === 0 ? (
            <Empty text="Queue is clear." />
          ) : (
            <ul className="divide-y divide-border">
              {data.recentTickets.map((tk) => (
                <li key={tk.id} className="flex items-start justify-between gap-3 py-3.5 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="text-sm">{tk.title}</div>
                    <div className="mt-1 text-xs text-muted">
                      {tk.customer_name ?? "Network"} · {tk.priority}
                    </div>
                  </div>
                  <Badge tone={statusTone(tk.status)}>{tk.status.replace("_", " ")}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHead title="Network health" to="/app/routers" link="Inventory" />
        {data.routers.length === 0 ? (
          <Empty text="No routers enrolled." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {data.routers.map((r) => (
              <div key={r.id} className="rounded-md bg-elevated p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="mt-0.5 truncate text-xs text-muted">{r.location || r.role}</div>
                  </div>
                  <Badge tone={statusTone(r.wg_status)}>{r.wg_status}</Badge>
                </div>
                <div className="mt-4 flex justify-between font-mono text-xs tabular-nums text-subtle">
                  <span>CPU {r.cpu_pct}%</span>
                  <span>{r.uptime_hours}h up</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg">
                  <div
                    className={cn("h-full rounded-full", r.cpu_pct >= 85 ? "bg-danger" : r.cpu_pct >= 60 ? "bg-warn" : "bg-ok")}
                    style={{ width: `${Math.min(100, r.cpu_pct)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-6">
      <div className="h-16 max-w-sm animate-pulse rounded-md bg-surface" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl bg-surface" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}

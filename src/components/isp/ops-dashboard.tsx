import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { DashboardPeriod, RouterTone, WorkDraft } from "@/lib/isp/dashboard-period";
import { dashboardNudgeFn } from "@/lib/isp/server";
import { assignOpenTicket, listTicketStaff } from "@/lib/isp/server-more";
import type { DashboardData } from "@/lib/isp/types";
import { cn, kes } from "@/lib/utils";

const PERIODS: Array<{ id: DashboardPeriod; label: string }> = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7d" },
  { id: "30d", label: "30d" },
];

function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-KE", { hour: "numeric", hour12: false, timeZone }).format(new Date()),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function dateLabel(timeZone: string) {
  return new Intl.DateTimeFormat("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "short",
    timeZone,
  }).format(new Date());
}

function ago(iso: string) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function updatedLabel(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(mins) || mins < 1) return "Updated just now";
  return `Updated ${mins}m ago`;
}

function useReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduce(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return reduce;
}

function Go({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const [path, query = ""] = href.split("?");
  const search = Object.fromEntries(new URLSearchParams(query));
  const customer = path.match(/^\/app\/customers\/([^/]+)$/);
  if (customer) {
    return (
      <Link to="/app/customers/$customerId" params={{ customerId: customer[1] }} className={className}>
        {children}
      </Link>
    );
  }
  const service = path.match(/^\/app\/services\/([^/]+)$/);
  if (service) {
    return (
      <Link to="/app/services/$serviceId" params={{ serviceId: service[1] }} className={className}>
        {children}
      </Link>
    );
  }
  const router = path.match(/^\/app\/routers\/([^/]+)$/);
  if (router) {
    return (
      <Link to="/app/routers/$routerId" params={{ routerId: router[1] }} className={className}>
        {children}
      </Link>
    );
  }
  const ticket = path.match(/^\/app\/tickets\/([^/]+)$/);
  if (ticket) {
    return (
      <Link to="/app/tickets/$ticketId" params={{ ticketId: ticket[1] }} className={className}>
        {children}
      </Link>
    );
  }
  const lead = path.match(/^\/app\/leads\/([^/]+)$/);
  if (lead) {
    return (
      <Link to="/app/leads/$leadId" params={{ leadId: lead[1] }} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/settings/general") {
    return (
      <Link to="/app/settings/$page" params={{ page: "general" }} search={{ section: "company" }} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/settings/payments") {
    return (
      <Link to="/app/settings/$page" params={{ page: "payments" }} search={{ section: "gateways" }} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/billing") {
    return (
      <Link to="/app/billing" search={search as never} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/routers") {
    return (
      <Link to="/app/routers" search={search as never} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/tickets") {
    return (
      <Link to="/app/tickets" search={search as never} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/customers") {
    return (
      <Link to="/app/customers" search={search as never} className={className}>
        {children}
      </Link>
    );
  }
  if (path === "/app/services") {
    return (
      <Link to="/app/services" search={search as never} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <Link to={path as never} className={className}>
      {children}
    </Link>
  );
}

const toneDot: Record<RouterTone, string> = {
  offline: "bg-danger",
  critical: "bg-danger",
  warning: "bg-warn",
  unknown: "bg-subtle",
  healthy: "bg-ok",
};

function Panel({
  title,
  action,
  children,
  className,
  busy,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  return (
    <section className={cn("rounded-md border border-border bg-surface p-4", className)} aria-busy={busy || undefined}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-6" aria-hidden>
      <div className="h-16 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-6" />
      <div className="h-16 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-6" />
      <div className="grid grid-cols-2 gap-3 lg:col-span-6 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 motion-safe:animate-pulse rounded-md bg-surface" />
        ))}
      </div>
      <div className="h-64 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-4" />
      <div className="h-64 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-2" />
      <div className="h-56 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-4" />
      <div className="h-56 motion-safe:animate-pulse rounded-md bg-surface lg:col-span-2" />
    </div>
  );
}

export function OpsDashboard({
  data,
  period,
  pending,
  refreshError,
  onPeriod,
  onRefresh,
}: {
  data: DashboardData;
  period: DashboardPeriod;
  pending: boolean;
  refreshError: boolean;
  onPeriod: (period: DashboardPeriod) => void;
  onRefresh: () => void;
}) {
  const ops = data.ops;
  const toast = useToast();
  const reduce = useReducedMotion();
  const [assignFor, setAssignFor] = useState<WorkDraft | null>(null);
  const [staff, setStaff] = useState<Array<{ user_id: string; name: string; role: string }>>([]);
  const [who, setWho] = useState("");
  const [assignBusy, setAssignBusy] = useState(false);
  const [assignErr, setAssignErr] = useState("");
  const [nowTick, setNowTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setNowTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);
  void nowTick;

  const name = ops.viewerName;
  const hello = greeting(ops.timezone);
  const finance = ops.metrics.collectedKes != null;
  const bills = ops.metrics.outstandingKes != null;
  const people = ops.metrics.activeSubscribers != null;
  const online = ops.metrics.onlineNow != null;

  async function remind(row: WorkDraft, event: "invoice.due" | "invoice.overdue") {
    const ok = await askConfirm({
      title: event === "invoice.overdue" ? `Send SMS to ${row.subject}?` : `Remind ${row.subject}?`,
      description: `${event === "invoice.overdue" ? "Invoice overdue" : "Invoice due"} template${
        row.phoneMask ? ` · ${row.phoneMask}` : ""
      }. Nothing is sent until you confirm.`,
      confirmLabel: event === "invoice.overdue" ? "Send SMS" : "Send reminder",
      pendingLabel: "Sending",
      action: async () => {
        await dashboardNudgeFn({
          data: { customerId: row.customerId, event, entityId: row.entityId },
        });
      },
    });
    if (!ok) return;
    toast.success(event === "invoice.overdue" ? "SMS sent" : "Reminder sent", row.subject);
    onRefresh();
  }

  async function openAssign(row: WorkDraft) {
    setAssignFor(row);
    setWho("");
    setAssignErr("");
    try {
      const res = await listTicketStaff();
      setStaff(res.staff);
    } catch (err) {
      setAssignErr(err instanceof Error ? err.message : "Could not load staff");
    }
  }

  async function submitAssign() {
    if (!assignFor || !who || assignBusy) return;
    setAssignBusy(true);
    setAssignErr("");
    try {
      await assignOpenTicket({ data: { id: assignFor.entityId, user_id: who } });
      setAssignFor(null);
      toast.success("Ticket assigned");
      onRefresh();
    } catch (err) {
      setAssignErr(err instanceof Error ? err.message : "Could not assign");
    } finally {
      setAssignBusy(false);
    }
  }

  const kpis = [
    finance
      ? {
          id: "collected",
          label: period === "today" ? "Collected today" : "Collected",
          value: kes(ops.metrics.collectedKes ?? 0),
          hint: ops.metrics.collectedHint,
          href: "/app/billing?tab=payments",
        }
      : null,
    people
      ? {
          id: "active",
          label: "Active subscribers",
          value: String(ops.metrics.activeSubscribers ?? 0),
          hint: ops.metrics.activeHint,
          href: "/app/services?status=active",
        }
      : null,
    online
      ? {
          id: "online",
          label: "Online now",
          value: String(ops.metrics.onlineNow ?? 0),
          hint: ops.metrics.onlineHint,
          href: ops.access.radius ? "/app/radius" : ops.access.routers ? "/app/routers" : "",
        }
      : null,
    bills
      ? {
          id: "outstanding",
          label: "Outstanding",
          value: kes(ops.metrics.outstandingKes ?? 0),
          hint: ops.metrics.outstandingHint,
          href: "/app/billing?status=open",
        }
      : null,
  ].filter((item): item is NonNullable<typeof item> => Boolean(item));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">
      <header className="order-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between lg:col-span-6">
        <div>
          <p className="text-sm text-muted">{dateLabel(ops.timezone)}</p>
          <h1 className="text-xl font-semibold tracking-tight md:text-2xl">
            {name ? `${hello}, ${name}` : hello}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div role="radiogroup" aria-label="Dashboard period" className="inline-flex rounded-md border border-border p-0.5">
            {PERIODS.map((item) => {
              const selected = period === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  data-period={item.id}
                  className={cn(
                    "min-h-11 rounded-sm px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                    selected ? "bg-elevated text-fg" : "text-muted hover:text-fg",
                  )}
                  onClick={() => onPeriod(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "ArrowLeft" || e.key === "ArrowUp") {
                      e.preventDefault();
                      const ids = PERIODS.map((p) => p.id);
                      const i = ids.indexOf(item.id);
                      const next =
                        e.key === "ArrowRight" || e.key === "ArrowDown"
                          ? ids[(i + 1) % ids.length]
                          : ids[(i + ids.length - 1) % ids.length];
                      if (!next) return;
                      onPeriod(next);
                      const target = e.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-period="${next}"]`);
                      target?.focus();
                    }
                  }}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-subtle" aria-live="polite">
            {refreshError ? "Couldn't refresh" : updatedLabel(ops.generatedAt)}
          </p>
          {refreshError ? (
            <Button type="button" size="sm" variant="secondary" onClick={onRefresh}>
              Retry
            </Button>
          ) : null}
        </div>
      </header>

      {ops.setup.required ? (
        <section className="order-2 rounded-md border border-border bg-surface p-4 lg:col-span-6" aria-label="Setup checklist">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-medium">Get your ISP ready</h2>
            <p className="text-xs text-muted">
              {ops.setup.completed} of {ops.setup.total} complete
            </p>
          </div>
          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {ops.setup.items.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 rounded-md bg-elevated/60 px-3 py-2">
                <div className="min-w-0">
                  <p className={cn("text-sm", item.done && "text-muted")}>
                    <span className="sr-only">{item.done ? "Done" : "Not done"}: </span>
                    {item.done ? "Done · " : ""}
                    {item.label}
                  </p>
                  <p className="text-xs text-muted">{item.detail}</p>
                </div>
                {item.done ? null : (
                  <Go href={item.href} className="shrink-0 text-sm text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                    {item.action}
                  </Go>
                )}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="order-3 lg:col-span-6" aria-label="Needs attention">
        {ops.attentionClear ? (
          <div className="rounded-md border border-border px-4 py-3">
            <p className="text-sm">
              <span aria-hidden>✓ </span>All clear
            </p>
            <p className="text-xs text-muted">No urgent operational issues</p>
          </div>
        ) : (
          <div>
            <h2 className="mb-2 text-sm font-medium">Needs attention</h2>
            <ul className="flex flex-wrap gap-2">
              {ops.attention.map((item) => (
                <li key={item.id}>
                  <Go
                    href={item.href}
                    className="block min-h-11 rounded-md border border-border bg-surface px-3 py-2 hover:bg-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                  >
                    <span className={cn("block text-sm font-medium", item.tone === "critical" ? "text-danger" : item.tone === "warning" ? "text-warn" : "text-fg")}>
                      {item.title}
                    </span>
                    <span className="block text-xs text-muted">
                      {item.id === "overdue" && item.amountKes != null ? kes(item.amountKes) : item.detail}
                    </span>
                  </Go>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className={cn("order-4 grid grid-cols-2 gap-3 lg:col-span-6 lg:grid-cols-4", pending && "opacity-70")} aria-busy={pending}>
        {kpis.map((kpi) => {
          const body = (
            <>
              <span className="text-xs text-muted">{kpi.label}</span>
              <span className="mt-1 block font-mono text-xl tabular-nums tracking-tight md:text-2xl">{kpi.value}</span>
              <span className="mt-1 block text-xs text-subtle">{kpi.hint}</span>
            </>
          );
          return kpi.href ? (
            <Go
              key={kpi.id}
              href={kpi.href}
              className="rounded-md border border-border bg-surface p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {body}
            </Go>
          ) : (
            <div key={kpi.id} className="rounded-md border border-border bg-surface p-3">
              {body}
            </div>
          );
        })}
      </div>

      {ops.revenue ? (
        <Panel
          title="Revenue"
          busy={pending}
          className={cn("order-6 lg:order-5", ops.network ? "lg:col-span-4" : "lg:col-span-6")}
          action={
            <Go href="/app/billing?tab=payments" className="text-xs text-accent hover:underline">
              View payments
            </Go>
          }
        >
          <p className="mb-3 text-xs text-muted">
            <span className="text-fg">{ops.revenue.currentLabel}</span>
            <span> vs </span>
            <span>{ops.revenue.previousLabel}</span>
            <span className="mt-1 block font-mono tabular-nums">
              {kes(ops.revenue.currentTotal)}
              <span className="text-subtle"> · previous {kes(ops.revenue.previousTotal)}</span>
            </span>
          </p>
          {ops.revenue.series.every((p) => p.current === 0 && p.previous === 0) ? (
            <EmptyState
              title="No payments recorded for this period."
              action={
                <Go href="/app/billing?tab=payments" className="text-sm text-accent hover:underline">
                  View payments
                </Go>
              }
            />
          ) : (
            <figure aria-label={`Revenue for ${ops.revenue.currentLabel} compared with ${ops.revenue.previousLabel}`}>
              <figcaption className="sr-only">
                Solid bars are the current period. Outlined bars are the previous period.
              </figcaption>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ops.revenue.series} barGap={2}>
                    <CartesianGrid vertical={false} stroke="var(--color-border)" />
                    <XAxis dataKey="label" tick={{ fill: "var(--color-subtle)", fontSize: 11 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                    <YAxis
                      width={48}
                      tick={{ fill: "var(--color-subtle)", fontSize: 11 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : String(v))}
                    />
                    <Tooltip
                      cursor={{ fill: "var(--color-elevated)" }}
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        color: "var(--color-fg)",
                        fontSize: 12,
                      }}
                      formatter={(value, name) => [kes(Number(value)), name === "current" ? "Current" : "Previous"]}
                    />
                    <Bar dataKey="previous" name="previous" fill="transparent" stroke="var(--color-muted)" strokeWidth={1.5} radius={[2, 2, 0, 0]} isAnimationActive={!reduce} />
                    <Bar dataKey="current" name="current" fill="var(--color-chart)" radius={[2, 2, 0, 0]} isAnimationActive={!reduce} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="mt-2 flex gap-4 text-xs text-muted">
                <li className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-3 rounded-sm bg-chart" aria-hidden />
                  Current period
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-3 rounded-sm border border-muted" aria-hidden />
                  Previous period
                </li>
              </ul>
            </figure>
          )}
          <div className="mt-4">
            <h3 className="text-xs font-medium text-muted">Payment methods</h3>
            {ops.revenue.methods.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No confirmed payments in this period.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {ops.revenue.methods.map((method) => (
                  <li key={method.id}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span>{method.label}</span>
                      <span className="font-mono text-xs tabular-nums text-muted">
                        {method.pct}% · {kes(method.amountKes)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden>
                      <div className="h-full rounded-full bg-chart" style={{ width: `${Math.min(100, method.pct)}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Panel>
      ) : null}

      {ops.network ? (
        <Panel
          title="Network"
          className={cn("order-7 lg:order-5", ops.revenue ? "lg:col-span-2" : "lg:col-span-6")}
          action={
            ops.access.routers ? (
              <Go href="/app/routers" className="text-xs text-accent hover:underline">
                Routers
              </Go>
            ) : null
          }
        >
          {ops.network.length === 0 ? (
            <EmptyState
              title="No routers connected yet."
              action={
                ops.access.routers ? (
                  <Go href="/app/routers" className="text-sm text-accent hover:underline">
                    Add router
                  </Go>
                ) : null
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {ops.network.map((row) => {
                const inner = (
                  <span className="flex min-h-11 items-center justify-between gap-3 py-1.5">
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-sm">
                        <span className={cn("size-2 shrink-0 rounded-full", toneDot[row.state])} aria-hidden />
                        <span className="sr-only">{row.state}. </span>
                        <span className="truncate">{row.name}</span>
                      </span>
                      {row.location ? <span className="mt-0.5 block truncate pl-4 text-xs text-muted">{row.location}</span> : null}
                    </span>
                    <span className="shrink-0 text-xs text-muted">{row.detail}</span>
                  </span>
                );
                return (
                  <li key={row.id}>
                    {row.href ? (
                      <Go href={row.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                        {inner}
                      </Go>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {ops.networkMore > 0 && ops.access.routers ? (
            <Go href="/app/routers" className="mt-2 inline-block text-xs text-accent hover:underline">
              {ops.networkMore} more
            </Go>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Work queue" className={cn("order-5 lg:order-6", "lg:col-span-4")}>
        {ops.workQueue.length === 0 ? (
          <EmptyState title="Nothing needs your attention right now." />
        ) : (
          <ul className="divide-y divide-border">
            {ops.workQueue.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <Go href={row.href} className="block truncate text-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
                    {row.subject}
                  </Go>
                  <p className="truncate text-xs text-muted">
                    {row.context}
                    <span className="text-subtle"> · {row.urgency}</span>
                  </p>
                </div>
                {row.action === "open" ? (
                  <Go href={row.href} className="inline-flex min-h-11 items-center px-2 text-sm text-accent hover:underline">
                    Open
                  </Go>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (row.action === "assign") void openAssign(row);
                      else if (row.action === "sms") void remind(row, "invoice.overdue");
                      else void remind(row, "invoice.due");
                    }}
                  >
                    {row.actionLabel}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="Live activity"
        className="order-8 lg:order-6 lg:col-span-2"
        action={
          ops.access.payments ? (
            <Go href="/app/billing?tab=payments" className="text-xs text-accent hover:underline">
              View payments
            </Go>
          ) : null
        }
      >
        {ops.activity.length === 0 ? (
          <EmptyState title="No recent activity." />
        ) : (
          <ul className="space-y-2">
            {ops.activity.map((row) => (
              <li key={row.id} className="flex items-start justify-between gap-3 text-sm">
                {row.href ? (
                  <Go href={row.href} className="min-w-0 hover:underline">
                    {row.text}
                  </Go>
                ) : (
                  <span className="min-w-0">{row.text}</span>
                )}
                <time className="shrink-0 text-xs text-subtle" dateTime={row.at}>
                  {ago(row.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Dialog
        open={Boolean(assignFor)}
        onOpenChange={(open) => {
          if (!assignBusy && !open) setAssignFor(null);
        }}
        title="Assign ticket"
        description={assignFor ? assignFor.context : ""}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={assignBusy} onClick={() => setAssignFor(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={assignBusy || !who} onClick={() => void submitAssign()}>
              {assignBusy ? "Assigning" : "Assign"}
            </Button>
          </>
        }
      >
        <div className="px-4 py-3">
          <label className="text-sm text-muted" htmlFor="dash-assign">
            Staff
          </label>
          <Select id="dash-assign" className="mt-1" value={who} onChange={(e) => setWho(e.target.value)} disabled={assignBusy}>
            <option value="">Select</option>
            {staff.map((member) => (
              <option key={member.user_id} value={member.user_id}>
                {member.name || member.role}
              </option>
            ))}
          </Select>
          {assignErr ? <p className="mt-2 text-sm text-danger">{assignErr}</p> : null}
        </div>
      </Dialog>
    </div>
  );
}

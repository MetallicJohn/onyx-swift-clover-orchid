import { publicOnlineStatus } from "./router-provisioning.ts";
import {
  fillHotspotRevenueDays,
  formatHotspotBytes,
  formatSessionDuration,
  HIGH_SESSION_ALERT,
  hotspotDeltaPct,
  hotspotPeriodBounds,
  hotspotRouterStatus,
  normalizeHotspotTimezone,
  zonedWallTime,
  type HotspotAlertKind,
  type HotspotRouterStatus,
} from "./hotspot-dashboard-format.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type HotspotRevenueBlock = {
  available: boolean;
  reason: string | null;
  today_kes: number;
  today_count: number;
  yesterday_kes: number;
  yesterday_count: number;
  month_kes: number;
  month_count: number;
  prev_month_kes: number;
  prev_month_count: number;
  today_delta_pct: number;
  month_delta_pct: number;
  days: Array<{ day: string; amount: number; count: number }>;
  currency: string;
};

export type HotspotDashRouter = {
  id: string;
  name: string;
  identity: string;
  management_ip: string;
  location: string;
  last_seen: string | null;
  wg_status: string;
  status: HotspotRouterStatus;
  online: boolean;
  active_sessions: number;
};

export type HotspotDashSession = {
  id: string;
  username: string;
  customer_name: string;
  service_account_number: string;
  router_name: string;
  framed_ip: string;
  nas_ip: string;
  started_at: string;
  duration: string;
  bytes_in: number;
  bytes_out: number;
  usage: string;
  status: "online" | "stopped";
};

export type HotspotDashPayment = {
  id: string;
  paid_at: string;
  customer_name: string;
  service_account_number: string;
  amount_kes: number;
  reference: string;
  provider: string;
  status: string;
};

export type HotspotDashAlert = {
  kind: HotspotAlertKind;
  title: string;
  detail: string;
};

export type HotspotDashboard = {
  generated_at: string;
  timezone: string;
  currency: string;
  revenue: HotspotRevenueBlock;
  routers: {
    available: boolean;
    reason: string | null;
    online: number;
    total: number;
    pct: number;
    rows: HotspotDashRouter[];
  };
  sessions: {
    available: boolean;
    reason: string | null;
    active: number;
    started_today: number;
    started_month: number;
    unique_users: number;
    rows: HotspotDashSession[];
  };
  payments: HotspotDashPayment[];
  alerts: HotspotDashAlert[];
};

function emptyRevenue(currency: string, reason: string | null, available = false): HotspotRevenueBlock {
  return {
    available,
    reason,
    today_kes: 0,
    today_count: 0,
    yesterday_kes: 0,
    yesterday_count: 0,
    month_kes: 0,
    month_count: 0,
    prev_month_kes: 0,
    prev_month_count: 0,
    today_delta_pct: 0,
    month_delta_pct: 0,
    days: [],
    currency,
  };
}

/** Confirmed payments attributed to a hotspot service (direct service_id or invoice line). */
const HOTSPOT_PAY_PRED = `
  p.status = 'confirmed'
  and (
    exists (
      select 1 from services s
      where s.id = p.service_id and s.tenant_id = p.tenant_id and s.access_method = 'hotspot'
    )
    or (
      coalesce(p.service_id, '') = ''
      and exists (
        select 1 from invoice_items ii
        join services s2 on s2.id = ii.service_id and s2.tenant_id = p.tenant_id
        where ii.invoice_id = p.invoice_id and s2.access_method = 'hotspot'
      )
    )
  )
`;

const HOTSPOT_USER_PRED = `
  (
    exists (select 1 from hotspot_vouchers v where v.tenant_id = rs.tenant_id and v.code = rs.username)
    or exists (
      select 1 from services sx
      where sx.tenant_id = rs.tenant_id and sx.username = rs.username and sx.access_method = 'hotspot'
    )
  )
`;

async function sumWindow(sql: Sql, tenantId: string, from: Date, to: Date) {
  const [row] = await sql.query<{ n: number; c: number }>(
    `select coalesce(sum(p.amount_kes),0)::int as n, count(*)::int as c
     from payments p
     where p.tenant_id = $1 and ${HOTSPOT_PAY_PRED}
       and p.paid_at >= $2 and p.paid_at < $3`,
    [tenantId, from.toISOString(), to.toISOString()],
  );
  return { n: row?.n ?? 0, c: row?.c ?? 0 };
}

export async function loadHotspotDashboard(
  sql: Sql,
  opts: {
    tenantId: string;
    timezone?: string;
    currency?: string;
    canRevenue: boolean;
    canRouters: boolean;
    canSessions: boolean;
    now?: Date;
  },
): Promise<HotspotDashboard> {
  const now = opts.now ?? new Date();
  const [ten] = await sql<{ timezone: string; currency: string }>`
    select coalesce(nullif(timezone,''), 'Africa/Nairobi') as timezone,
           coalesce(nullif(currency,''), 'KES') as currency
    from tenants where id = ${opts.tenantId}`;
  const timezone = normalizeHotspotTimezone(opts.timezone || ten?.timezone);
  const currency = opts.currency || ten?.currency || "KES";
  const bounds = hotspotPeriodBounds(now, timezone);
  const alerts: HotspotDashAlert[] = [];

  let revenue = emptyRevenue(currency, opts.canRevenue ? null : "not_authorised", opts.canRevenue);
  let payments: HotspotDashPayment[] = [];

  if (opts.canRevenue) {
    const today = await sumWindow(sql, opts.tenantId, bounds.todayStart, bounds.todayEnd);
    const yesterday = await sumWindow(sql, opts.tenantId, bounds.yesterdayStart, bounds.yesterdayEnd);
    const month = await sumWindow(sql, opts.tenantId, bounds.monthStart, bounds.monthEnd);
    const prev = await sumWindow(sql, opts.tenantId, bounds.prevMonthStart, bounds.prevMonthEnd);
    const from14 = zonedWallTime(shiftYmd(bounds.todayYmd, -13), timezone);
    const daily14 = await sql.query<{ day: string; amount: number; count: number }>(
      `select (p.paid_at at time zone $4)::date::text as day,
              coalesce(sum(p.amount_kes),0)::int as amount,
              count(*)::int as count
       from payments p
       where p.tenant_id = $1 and ${HOTSPOT_PAY_PRED}
         and p.paid_at >= $2 and p.paid_at < $3
       group by 1
       order by 1`,
      [opts.tenantId, from14.toISOString(), bounds.todayEnd.toISOString(), timezone],
    );
    revenue = {
      available: true,
      reason: null,
      today_kes: today.n,
      today_count: today.c,
      yesterday_kes: yesterday.n,
      yesterday_count: yesterday.c,
      month_kes: month.n,
      month_count: month.c,
      prev_month_kes: prev.n,
      prev_month_count: prev.c,
      today_delta_pct: hotspotDeltaPct(today.n, yesterday.n),
      month_delta_pct: hotspotDeltaPct(month.n, prev.n),
      days: fillHotspotRevenueDays(daily14, 14, bounds.todayYmd),
      currency,
    };
    payments = await sql.query<HotspotDashPayment>(
      `select p.id, p.paid_at::text as paid_at,
              coalesce(c.name, '') as customer_name,
              coalesce(s.account_number, '') as service_account_number,
              p.amount_kes, p.reference, p.provider, p.status
       from payments p
       left join customers c on c.id = p.customer_id
       left join services s on s.id = p.service_id
       where p.tenant_id = $1 and ${HOTSPOT_PAY_PRED}
       order by p.paid_at desc
       limit 12`,
      [opts.tenantId],
    );

    const [failed] = await sql<{ n: number }>`
      select count(*)::int as n from payment_intents i
      where i.tenant_id = ${opts.tenantId}
        and i.status in ('failed', 'cancelled')
        and i.created_at >= ${bounds.todayStart.toISOString()}
        and exists (
          select 1 from invoice_items ii
          join services s on s.id = ii.service_id and s.tenant_id = i.tenant_id
          where ii.invoice_id = i.invoice_id and s.access_method = 'hotspot'
        )`;
    if ((failed?.n ?? 0) > 0) {
      alerts.push({
        kind: "failed_callbacks",
        title: "Failed payment callbacks",
        detail: `${failed?.n} hotspot payment prompt${failed?.n === 1 ? "" : "s"} failed or cancelled today.`,
      });
    }
  }

  let routers: HotspotDashboard["routers"] = {
    available: opts.canRouters,
    reason: opts.canRouters ? null : "not_authorised",
    online: 0,
    total: 0,
    pct: 0,
    rows: [],
  };

  if (opts.canRouters) {
    const rows = await sql<{
      id: string;
      name: string;
      identity: string;
      management_ip: string;
      location: string;
      last_seen: string | null;
      wg_status: string;
      enabled: boolean;
    }>`select r.id, r.name, coalesce(r.identity,'') as identity, coalesce(r.management_ip,'') as management_ip,
             coalesce(r.location,'') as location, r.last_seen::text as last_seen, r.wg_status,
             coalesce(r.enabled, true) as enabled
      from routers r
      where r.tenant_id = ${opts.tenantId} and r.archived_at is null
        and r.role = 'hotspot'
      order by r.name`;
    const sessionCounts = await sql<{ nas_ip: string; n: number }>`
      select nas_ip, count(*)::int as n
      from radius_sessions
      where tenant_id = ${opts.tenantId} and stopped_at is null
      group by nas_ip`;
    const byNas = new Map(sessionCounts.map((s) => [s.nas_ip, s.n]));
    const mapped: HotspotDashRouter[] = rows.map((r) => {
      const status = hotspotRouterStatus(r.last_seen, r.wg_status, r.enabled !== false, now.getTime());
      const { online } = publicOnlineStatus(r.last_seen, r.enabled === false ? "offline" : r.wg_status, now.getTime());
      return {
        id: r.id,
        name: r.name,
        identity: r.identity,
        management_ip: r.management_ip,
        location: r.location,
        last_seen: r.last_seen,
        wg_status: r.wg_status,
        status,
        online: r.enabled !== false && online,
        active_sessions: byNas.get(r.management_ip) || 0,
      };
    });
    const online = mapped.filter((r) => r.online).length;
    routers = {
      available: true,
      reason: null,
      online,
      total: mapped.length,
      pct: mapped.length ? Math.round((online / mapped.length) * 100) : 0,
      rows: mapped,
    };
    for (const r of mapped) {
      if (r.status === "offline") {
        alerts.push({ kind: "router_offline", title: `${r.name} is offline`, detail: r.management_ip || r.identity || "No last heartbeat." });
      } else if (r.status === "warning") {
        alerts.push({ kind: "router_stale", title: `${r.name} heartbeat is stale`, detail: "Last seen more than 3 minutes ago." });
      }
    }
  }

  let sessions: HotspotDashboard["sessions"] = {
    available: opts.canSessions,
    reason: opts.canSessions ? null : "not_authorised",
    active: 0,
    started_today: 0,
    started_month: 0,
    unique_users: 0,
    rows: [],
  };

  if (opts.canSessions) {
    try {
      const live = await sql.query<{
        id: string;
        username: string;
        customer_name: string;
        service_account_number: string;
        router_name: string;
        framed_ip: string;
        nas_ip: string;
        started_at: string;
        bytes_in: number;
        bytes_out: number;
        stopped_at: string | null;
      }>(
        `select rs.id, rs.username,
                coalesce(c.name, '') as customer_name,
                coalesce(s.account_number, '') as service_account_number,
                coalesce(r.name, '') as router_name,
                coalesce(rs.framed_ip, '') as framed_ip,
                coalesce(rs.nas_ip, '') as nas_ip,
                rs.started_at::text as started_at,
                rs.bytes_in, rs.bytes_out,
                rs.stopped_at::text as stopped_at
         from radius_sessions rs
         left join services s on s.tenant_id = rs.tenant_id and s.username = rs.username and s.access_method = 'hotspot' and s.deleted_at is null
         left join customers c on c.id = s.customer_id
         left join routers r on r.tenant_id = rs.tenant_id and (r.management_ip = rs.nas_ip or r.identity = rs.nas_ip)
         where rs.tenant_id = $1 and ${HOTSPOT_USER_PRED}
         order by rs.stopped_at nulls first, rs.started_at desc
         limit 80`,
        [opts.tenantId],
      );
      const [counts] = await sql.query<{ active: number; today: number; month: number; users: number }>(
        `select
           count(*) filter (where stopped_at is null)::int as active,
           count(*) filter (where started_at >= $2 and started_at < $3)::int as today,
           count(*) filter (where started_at >= $4 and started_at < $5)::int as month,
           count(distinct username) filter (where stopped_at is null)::int as users
         from radius_sessions rs
         where rs.tenant_id = $1 and ${HOTSPOT_USER_PRED}`,
        [opts.tenantId, bounds.todayStart.toISOString(), bounds.todayEnd.toISOString(), bounds.monthStart.toISOString(), bounds.monthEnd.toISOString()],
      );
      const rows: HotspotDashSession[] = live.map((s) => {
        const total = Number(s.bytes_in || 0) + Number(s.bytes_out || 0);
        return {
          id: s.id,
          username: s.username,
          customer_name: s.customer_name,
          service_account_number: s.service_account_number,
          router_name: s.router_name,
          framed_ip: s.framed_ip,
          nas_ip: s.nas_ip,
          started_at: s.started_at,
          duration: formatSessionDuration(s.started_at, s.stopped_at, now.getTime()),
          bytes_in: Number(s.bytes_in || 0),
          bytes_out: Number(s.bytes_out || 0),
          usage: formatHotspotBytes(total),
          status: s.stopped_at ? "stopped" : "online",
        };
      });
      sessions = {
        available: true,
        reason: null,
        active: counts?.active ?? rows.filter((r) => r.status === "online").length,
        started_today: counts?.today ?? 0,
        started_month: counts?.month ?? 0,
        unique_users: counts?.users ?? 0,
        rows,
      };
      if ((sessions.active || 0) >= HIGH_SESSION_ALERT) {
        alerts.push({
          kind: "high_sessions",
          title: "High active session count",
          detail: `${sessions.active} hotspot sessions are online.`,
        });
      }
    } catch {
      sessions = {
        available: false,
        reason: "radius_unavailable",
        active: 0,
        started_today: 0,
        started_month: 0,
        unique_users: 0,
        rows: [],
      };
      alerts.push({
        kind: "radius_unavailable",
        title: "RADIUS accounting unavailable",
        detail: "Live hotspot sessions could not be read.",
      });
    }
  }

  try {
    await sql`select 1 from traffic_samples where tenant_id = ${opts.tenantId} limit 1`;
  } catch {
    alerts.push({
      kind: "traffic_unavailable",
      title: "Traffic monitoring unavailable",
      detail: "Usage samples could not be read for this ISP.",
    });
  }

  return {
    generated_at: now.toISOString(),
    timezone,
    currency,
    revenue,
    routers,
    sessions,
    payments,
    alerts,
  };
}

function shiftYmd(ymd: string, days: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, (d || 1) + days)).toISOString().slice(0, 10);
}

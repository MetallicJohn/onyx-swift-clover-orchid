import assert from "node:assert/strict";
import { test } from "node:test";
import { routerReachability } from "./mikrotik-ops.ts";
import {
  classifyRouter,
  collectedHint,
  dashboardAccess,
  greetingName,
  methodSplit,
  periodWindow,
  redactOps,
  seriesFromPayments,
  sortWork,
  type DashboardOps,
  type WorkDraft,
} from "./dashboard-period.ts";
import { loadDashboard } from "./dashboard.ts";
import { openTestDb } from "./test-db.ts";
import type { Workspace } from "./types.ts";

function ws(role: Workspace["role"], id = "ten_v2"): Workspace {
  return {
    tenantId: id,
    tenantName: "Imani",
    slug: "imani",
    status: "trial",
    currency: "KES",
    role,
    supportEmail: "",
    supportPhone: "",
  };
}

test("greeting uses the person's first name, not the company", () => {
  assert.equal(greetingName("Wanjiru Kamau"), "Wanjiru");
  assert.equal(greetingName("Imani Networks"), "Imani");
  assert.equal(greetingName(""), "");
});

test("period windows are equal length and timezone-aware", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const today = periodWindow("today", now, "Africa/Nairobi");
  assert.equal(today.start.toISOString(), "2026-09-30T21:00:00.000Z");
  assert.equal(today.end.toISOString(), now.toISOString());
  assert.equal(today.prevEnd.getTime() - today.prevStart.getTime(), today.end.getTime() - today.start.getTime());
  assert.equal(today.currentLabel, "Today");
  assert.equal(today.previousLabel, "Yesterday");

  const week = periodWindow("7d", now, "Africa/Nairobi");
  assert.equal(week.buckets.length, 7);
  assert.equal(week.end.getTime() - week.start.getTime(), week.prevEnd.getTime() - week.prevStart.getTime());
  assert.equal(week.buckets[0]?.label.includes("Sep") || week.buckets[0]?.label.includes("Oct"), true);

  const month = periodWindow("30d", now, "Africa/Nairobi");
  assert.equal(month.buckets.length, 30);
  assert.equal(month.end.getTime() - month.start.getTime(), month.prevEnd.getTime() - month.prevStart.getTime());
});

test("collected hint does not invent a percent without a previous period", () => {
  assert.equal(collectedHint(0, 0), "No payments in this period");
  assert.equal(collectedHint(100, 0), "No previous period to compare");
  assert.equal(collectedHint(112, 100), "+12% vs previous period");
});

test("payment split ignores non-confirmed rows passed in and keeps extra methods", () => {
  const split = methodSplit([
    { provider: "mpesa", amount: 81 },
    { provider: "cash", amount: 12 },
    { provider: "bank", amount: 7 },
    { provider: "kopokopo", amount: 10 },
    { provider: "pending", amount: 0 },
  ]);
  assert.equal(split.find((m) => m.id === "mpesa")?.pct, 74);
  assert.equal(split.find((m) => m.id === "cash")?.label, "Cash");
  assert.equal(split.find((m) => m.id === "bank")?.label, "Bank");
  assert.equal(split.find((m) => m.id === "kopokopo")?.label, "Kopo Kopo");
  assert.equal(split.some((m) => m.id === "pending"), false);
});

test("router classifier matches reachability and does not call a silent router healthy", () => {
  const now = Date.parse("2026-10-01T12:00:00.000Z");
  const fresh = new Date(now - 60_000).toISOString();
  assert.equal(classifyRouter({ last_seen: fresh, wg_status: "connected", cpu_pct: 20, memory_pct: 10, enabled: true }, now).state, "healthy");
  assert.equal(classifyRouter({ last_seen: null, wg_status: "connected", cpu_pct: 0, memory_pct: null, enabled: true }, now).detail, "No heartbeat");
  assert.equal(classifyRouter({ last_seen: null, wg_status: "pending", cpu_pct: 0, memory_pct: null, enabled: true }, now).detail, "Status unavailable");
  const hot = new Date(now - 30_000).toISOString();
  assert.equal(classifyRouter({ last_seen: hot, wg_status: "connected", cpu_pct: 90, memory_pct: 10, enabled: true }, now).state, "critical");
  assert.equal(routerReachability(null, now, "connected"), "unreachable");
});

test("work queue order is deterministic", () => {
  const rows: WorkDraft[] = [
    { id: "b", kind: "churn", subject: "B", context: "", urgency: "", action: "open", actionLabel: "Open", entityId: "b", customerId: "", phoneMask: "", href: "/app/customers/b", score: 50 },
    { id: "a", kind: "ticket", subject: "A", context: "", urgency: "", action: "open", actionLabel: "Open", entityId: "a", customerId: "", phoneMask: "", href: "/app/tickets/a", score: 10 },
    { id: "c", kind: "ticket", subject: "A", context: "", urgency: "", action: "open", actionLabel: "Open", entityId: "c", customerId: "", phoneMask: "", href: "/app/tickets/c", score: 10 },
  ];
  assert.deepEqual(sortWork(rows).map((r) => r.id), ["a", "c", "b"]);
});

test("technician ops payload has no collected or outstanding amounts", () => {
  const ops = {
    period: "today",
    timezone: "Africa/Nairobi",
    generatedAt: "2026-10-01T00:00:00.000Z",
    viewerName: "Wanjiru",
    access: dashboardAccess("isp_owner"),
    attention: [
      { id: "overdue", title: "2 overdue", detail: "", href: "/app/billing?status=overdue", tone: "warning", severity: 3, amountKes: 86400 },
    ],
    attentionClear: false,
    metrics: {
      collectedKes: 48200,
      collectedPrevKes: 100,
      collectedHint: "+12% vs previous period",
      activeSubscribers: 4,
      activeHint: "+1 this period",
      onlineNow: 2,
      onlineHint: "50% of active",
      outstandingKes: 212000,
      outstandingHint: "Open balance",
    },
    revenue: {
      currentLabel: "Today",
      previousLabel: "Yesterday",
      currentTotal: 48200,
      previousTotal: 100,
      series: [],
      methods: [{ id: "mpesa", label: "M-Pesa", amountKes: 48200, pct: 100 }],
    },
    network: [],
    networkMore: 0,
    workQueue: [
      { id: "inv_1", kind: "overdue", subject: "A", context: "INV", urgency: "Due", action: "sms", actionLabel: "Send SMS", entityId: "1", customerId: "c", phoneMask: "···222", href: "/app/billing/invoices/1", score: 1 },
    ],
    activity: [{ id: "pay_1", at: "2026-10-01T00:00:00.000Z", text: "KES 48,200 from A", href: "/app/billing?tab=payments" }],
    setup: { required: false, completed: 6, total: 6, items: [] },
  } as DashboardOps;
  const tech = redactOps(ops, dashboardAccess("technician"));
  assert.equal(tech.metrics.collectedKes, null);
  assert.equal(tech.metrics.outstandingKes, null);
  assert.equal(tech.revenue, null);
  assert.equal(tech.workQueue.some((row) => row.kind === "overdue"), false);
  assert.equal(tech.activity.some((row) => row.id.startsWith("pay_")), false);
  assert.equal(JSON.stringify(tech).includes("48200"), false);
  assert.equal(JSON.stringify(tech).includes("212000"), false);
  const owner = redactOps(ops, dashboardAccess("isp_owner"));
  assert.equal(owner.metrics.collectedKes, 48200);
});

test("dashboard v2 uses confirmed payments, live sessions, and tenant isolation", async () => {
  const { sql, bypass, asRole, close } = await openTestDb();
  try {
    await bypass();
    await sql`insert into tenants (id, name, slug) values ('ten_v2', 'Imani', 'imani-v2')`;
    await sql`insert into tenants (id, name, slug) values ('ten_other', 'Other', 'other-v2')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_v2', 'ten_v2', 'Mercy Atieno', '0711000222')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_dead', 'ten_v2', 'Gone', '0711000333')`;
    await sql`insert into customers (id, tenant_id, name, phone) values ('cus_o', 'ten_other', 'Other', '0799000000')`;
    await sql`insert into packages (id, tenant_id, name, access_method, download_mbps, upload_mbps, price_kes)
      values ('pkg_v2', 'ten_v2', 'Home 10', 'pppoe', 10, 10, 2500)`;
    const now = new Date("2026-10-01T12:30:00.000Z");
    const paid = new Date("2026-10-01T12:00:00.000Z");
    const yesterday = new Date("2026-09-30T11:00:00.000Z");
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, period_end, created_at)
      values ('svc_v2', 'ten_v2', 'cus_v2', 'pkg_v2', 'pppoe', 'mercy', 'active', ${paid.toISOString()}, ${paid.toISOString()})`;
    await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, status, created_at)
      values ('svc_dead', 'ten_v2', 'cus_dead', 'pkg_v2', 'pppoe', 'gone', 'terminated', ${yesterday.toISOString()})`;
    await sql`insert into leads (id, tenant_id, lead_number, name, phone) values ('lead_v2', 'ten_v2', 'L-1', 'Lead Only', '0700000001')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, paid_kes, status, due_date)
      values ('inv_open', 'ten_v2', 'cus_v2', 'INV-9', 5000, 1000, 'overdue', '2026-09-20')`;
    await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values ('inv_paid', 'ten_v2', 'cus_v2', 'INV-8', 2500, 'paid', '2026-10-01')`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_ok', 'ten_v2', 'cus_v2', 'inv_paid', 'mpesa', 2500, 'ROK', 'confirmed', ${paid.toISOString()})`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_old', 'ten_v2', 'cus_v2', 'inv_paid', 'cash', 1000, 'ROLD', 'confirmed', ${yesterday.toISOString()})`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_pend', 'ten_v2', 'cus_v2', 'inv_open', 'mpesa', 9000, 'RPEND', 'pending', ${paid.toISOString()})`;
    await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status, paid_at)
      values ('pay_other', 'ten_other', 'cus_o', 'inv_paid', 'mpesa', 77777, 'ROTH', 'confirmed', ${paid.toISOString()})`;
    await sql`insert into radius_sessions (id, tenant_id, username) values ('ses_1', 'ten_v2', 'mercy')`;
    await sql`insert into radius_sessions (id, tenant_id, username) values ('ses_2', 'ten_v2', 'mercy')`;
    await sql`insert into routers (id, tenant_id, name, location, wg_status, last_seen, cpu_pct)
      values ('rtr_off', 'ten_v2', 'Kileleshwa', 'West', 'connected', null, 0)`;
    await asRole("ten_v2");
    const dash = await loadDashboard(sql, ws("isp_owner"), { period: "today", viewerName: "Wanjiru Kamau", now });
    assert.equal(dash.ops.viewerName, "Wanjiru");
    assert.equal(dash.ops.metrics.collectedKes, 2500);
    assert.equal(dash.ops.metrics.collectedPrevKes, 1000);
    assert.equal(dash.ops.metrics.activeSubscribers, 1);
    assert.equal(dash.ops.metrics.onlineNow, 1);
    assert.equal(dash.ops.metrics.outstandingKes, 4000);
    assert.equal(dash.ops.attention.some((item) => item.id === "routers" && item.title.includes("1 router")), true);
    assert.equal(dash.ops.attention.some((item) => item.id === "overdue" && item.amountKes === 4000), true);
    assert.equal(dash.ops.revenue?.methods.some((m) => m.id === "mpesa" && m.amountKes === 2500), true);
    assert.equal(JSON.stringify(dash.ops).includes("77777"), false);
    assert.equal(dash.ops.setup.items.find((item) => item.id === "customer")?.done, true);
    assert.equal(dash.ops.workQueue.some((row) => row.kind === "overdue" && row.subject === "Mercy Atieno"), true);

    const tech = await loadDashboard(sql, ws("technician"), { period: "today", viewerName: "Tech", now });
    assert.equal(tech.ops.metrics.collectedKes, null);
    assert.equal(tech.ops.metrics.outstandingKes, null);
    assert.equal(tech.ops.revenue, null);
    assert.equal(tech.totals.revenueMonth, 0);
    assert.equal(tech.totals.outstanding, 0);
    assert.equal(JSON.stringify(tech.ops).includes("2500"), false);
    assert.equal(JSON.stringify(tech).includes("77777"), false);
  } finally {
    await close();
  }
});

test("revenue series aligns the previous period onto the current buckets", () => {
  const now = new Date("2026-10-01T12:30:00.000Z");
  const window = periodWindow("today", now, "Africa/Nairobi");
  const series = seriesFromPayments(
    [
      { at: "2026-10-01T12:00:00.000Z", amount: 2500 },
      { at: "2026-09-30T12:00:00.000Z", amount: 1000 },
    ],
    window,
  );
  const noon = series.find((b) => b.label === "15");
  assert.equal(noon?.current, 2500);
  assert.equal(noon?.previous, 1000);
});

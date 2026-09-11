import { provisionServiceAccess } from "./access.ts";
import { intervalDays } from "./billing.ts";
import {
  activeGrant,
  consumeActiveGrantsForCustomer,
  ensureSystemGrant,
  expireDueGrants,
  notifyNearingGrants,
} from "./grace.ts";
import { expireDueVouchers } from "./hotspot.ts";
import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export function periodMs(billingInterval: string, validityHours = 0) {
  if (validityHours > 0) return validityHours * 3600_000;
  return intervalDays(billingInterval) * 86400_000;
}

export function extendPeriodEnd(current: Date | string | null, now: Date, durationMs: number) {
  const cur = current ? new Date(current) : null;
  const valid = cur && !Number.isNaN(cur.getTime()) ? cur : null;
  const base = valid && valid.getTime() > now.getTime() ? valid : now;
  return new Date(base.getTime() + durationMs);
}

export function bundleExhausted(usedMb: number, bundleMb: number) {
  return bundleMb > 0 && usedMb >= bundleMb;
}

export function usedMbFromBytes(bytesIn: number, bytesOut: number) {
  return Math.max(0, Math.floor((Number(bytesIn) + Number(bytesOut)) / (1024 * 1024)));
}

export async function customerHasOverdue(
  sql: Sql,
  tenantId: string,
  customerId: string,
  today = new Date().toISOString().slice(0, 10),
) {
  const rows = await sql<{ id: string }>`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${today}
    limit 1`;
  return Boolean(rows[0]);
}

async function notify(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event: "invoice.due" | "invoice.overdue" | "grace.started" | "grace.expired" | "service.suspended",
  entityId: string,
  vars: { invoice_number?: string; amount?: string; due_date?: string; service_name?: string },
) {
  const { notifyCustomerEvent } = await import("./notifications.ts");
  return notifyCustomerEvent(sql, tenantId, ispName, customerId, event, entityId, {
    customer_name: "",
    ...vars,
  });
}

async function setServiceState(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  status: "grace" | "suspended",
  reason: string,
) {
  await sql`update services
    set status = ${status}, suspend_reason = ${reason}
    where id = ${serviceId} and tenant_id = ${tenantId}`;
  await provisionServiceAccess(sql, tenantId, serviceId);
}

export async function grantPaidPeriod(sql: Sql, tenantId: string, customerId: string, now = new Date()) {
  const svcs = await sql<{
    id: string;
    period_end: string | null;
    billing_interval: string;
    validity_hours: number;
  }>`select s.id, s.period_end::text as period_end, p.billing_interval, p.validity_hours
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}
       and s.status <> 'terminated'`;
  for (const s of svcs) {
    const next = extendPeriodEnd(s.period_end, now, periodMs(s.billing_interval, s.validity_hours));
    await sql`update services
      set period_end = ${next.toISOString()}, bundle_used_mb = 0, suspend_reason = ''
      where id = ${s.id} and tenant_id = ${tenantId}`;
  }
  return svcs.length;
}

export async function restorePaidAccess(sql: Sql, tenantId: string, customerId: string) {
  await grantPaidPeriod(sql, tenantId, customerId);
  if (await customerHasOverdue(sql, tenantId, customerId)) {
    return { restored: 0, held: true };
  }
  await consumeActiveGrantsForCustomer(sql, tenantId, customerId);
  const svcs = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('grace','suspended','pending')`;
  await sql`update services set status = 'active', suspend_reason = ''
    where customer_id = ${customerId} and tenant_id = ${tenantId}
      and status in ('grace','suspended','pending')`;
  for (const s of svcs) await provisionServiceAccess(sql, tenantId, s.id);
  return { restored: svcs.length, held: false };
}

export async function recordAccounting(
  sql: Sql,
  tenantId: string,
  input: {
    username: string;
    bytes_in?: number;
    bytes_out?: number;
    nas_ip?: string;
    session_id?: string;
    framed_ip?: string;
    acct_status?: "start" | "stop" | "interim";
  },
) {
  const username = input.username.trim();
  if (!username) throw new Error("username required");
  const [viaRadius] = await sql<{
    id: string;
    status: string;
    bundle_used_mb: number;
    bundle_mb: number;
    access_method: string;
    static_ip: string | null;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
  }>`select s.id, s.status, s.bundle_used_mb, p.bundle_mb, s.access_method, s.static_ip,
            p.name as package_name, p.download_mbps, p.upload_mbps
     from radius_accounts a
     join services s on s.id = a.service_id
     join packages p on p.id = s.package_id
     where a.tenant_id = ${tenantId} and a.username = ${username}
     limit 1`;
  const [viaService] = viaRadius
    ? [viaRadius]
    : await sql<{
        id: string;
        status: string;
        bundle_used_mb: number;
        bundle_mb: number;
        access_method: string;
        static_ip: string | null;
        package_name: string;
        download_mbps: number;
        upload_mbps: number;
      }>`select s.id, s.status, s.bundle_used_mb, p.bundle_mb, s.access_method, s.static_ip,
            p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.username = ${username}
     order by s.created_at desc limit 1`;
  const svc = viaRadius ?? viaService;
  if (!svc) throw new Error("Unknown username");
  const bytesIn = Math.max(0, Number(input.bytes_in) || 0);
  const bytesOut = Math.max(0, Number(input.bytes_out) || 0);
  const sessionId = input.session_id?.trim() || nid("ses");
  const framed = (input.framed_ip || "").trim() || svc.static_ip || "";
  const nas = input.nas_ip || "";
  const existing = await sql<{ id: string; bytes_in: number; bytes_out: number }>`
    select id, bytes_in, bytes_out from radius_sessions where tenant_id = ${tenantId} and id = ${sessionId}`;
  let addMb = 0;
  if (existing[0]) {
    const dIn = Math.max(0, bytesIn - Number(existing[0].bytes_in));
    const dOut = Math.max(0, bytesOut - Number(existing[0].bytes_out));
    addMb = usedMbFromBytes(dIn, dOut);
    await sql`update radius_sessions
      set bytes_in = ${bytesIn}, bytes_out = ${bytesOut}, nas_ip = ${nas}, framed_ip = ${framed}
      where id = ${sessionId} and tenant_id = ${tenantId}`;
  } else {
    addMb = usedMbFromBytes(bytesIn, bytesOut);
    await sql`insert into radius_sessions (id, tenant_id, username, framed_ip, nas_ip, bytes_in, bytes_out)
      values (${sessionId}, ${tenantId}, ${username}, ${framed}, ${nas}, ${bytesIn}, ${bytesOut})`;
  }
  if (input.acct_status === "stop") {
    await sql`update radius_sessions set stopped_at = now()
      where id = ${sessionId} and tenant_id = ${tenantId} and stopped_at is null`;
  }
  const used = svc.bundle_used_mb + addMb;
  await sql`update services set bundle_used_mb = ${used} where id = ${svc.id} and tenant_id = ${tenantId}`;
  if (bundleExhausted(used, svc.bundle_mb) && (svc.status === "active" || svc.status === "grace")) {
    await setServiceState(sql, tenantId, svc.id, "suspended", "bundle");
    return { username, used_mb: used, bundle_mb: svc.bundle_mb, suspended: true, reason: "bundle" as const };
  }
  return { username, used_mb: used, bundle_mb: svc.bundle_mb, suspended: false, reason: "" as const };
}

export async function applyAccessPolicy(sql: Sql, tenantId: string, ispName: string) {
  const vouchers = await expireDueVouchers(sql, tenantId);
  await expireDueGrants(sql, tenantId, ispName);
  const invoices = await sql<{
    id: string;
    customer_id: string;
    number: string;
    amount_kes: number;
    status: string;
    due_date: string;
  }>`select id, customer_id, number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and status in ('issued','due','overdue','partial')
       and amount_kes > paid_kes`;

  const today = new Date().toISOString().slice(0, 10);
  let due = 0;
  let overdue = 0;
  let grace = 0;
  let suspended = 0;
  let time = 0;
  let bundle = 0;
  let notices = 0;

  for (const inv of invoices) {
    const vars = {
      invoice_number: inv.number,
      amount: `KES ${inv.amount_kes}`,
      due_date: inv.due_date,
    };
    if (inv.due_date === today && inv.status === "issued") {
      await sql`update invoices set status = 'due' where id = ${inv.id} and tenant_id = ${tenantId}`;
      notices += await notify(sql, tenantId, ispName, inv.customer_id, "invoice.due", inv.id, vars);
      due += 1;
    }
    if (inv.due_date < today && inv.status !== "overdue" && inv.status !== "partial") {
      await sql`update invoices set status = 'overdue' where id = ${inv.id} and tenant_id = ${tenantId}`;
      notices += await notify(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
      overdue += 1;
    }
    if (inv.due_date >= today) continue;

    const daysPast = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
    const services = await sql<{
      id: string;
      status: string;
      name: string;
      grace_days: number;
    }>`select s.id, s.status, p.name, p.grace_days
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${tenantId} and s.customer_id = ${inv.customer_id} and s.status in ('active','grace')`;

    for (const svc of services) {
      const svcVars = { ...vars, service_name: svc.name };
      const grant = await activeGrant(sql, tenantId, svc.id);
      const inGranted = Boolean(grant && Date.parse(grant.expires_at) > Date.now());
      const inPackage = daysPast <= svc.grace_days;
      if (inPackage || inGranted) {
        if (svc.status === "active") {
          await setServiceState(sql, tenantId, svc.id, "grace", "invoice");
          if (inPackage && svc.grace_days > 0) {
            const start = new Date(Date.parse(inv.due_date));
            const until = new Date(Date.parse(inv.due_date) + svc.grace_days * 86400_000);
            await ensureSystemGrant(sql, {
              tenantId,
              serviceId: svc.id,
              customerId: inv.customer_id,
              days: svc.grace_days,
              startsAt: start,
              expiresAt: until,
            });
          }
          notices += await notify(sql, tenantId, ispName, inv.customer_id, "grace.started", svc.id, svcVars);
          grace += 1;
        }
      } else if (svc.status !== "suspended") {
        await setServiceState(sql, tenantId, svc.id, "suspended", "invoice");
        notices += await notify(sql, tenantId, ispName, inv.customer_id, "service.suspended", svc.id, svcVars);
        suspended += 1;
      }
    }
  }

  const timed = await sql<{
    id: string;
    customer_id: string;
    status: string;
    name: string;
    grace_days: number;
    period_end: string;
  }>`select s.id, s.customer_id, s.status, p.name, p.grace_days, s.period_end::text as period_end
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId}
       and s.status in ('active','grace')
       and s.period_end is not null
       and s.period_end <= now()`;

  for (const svc of timed) {
    const end = Date.parse(svc.period_end);
    const graceMs = Math.max(0, svc.grace_days) * 86400_000;
    const grant = await activeGrant(sql, tenantId, svc.id);
    const inGranted = Boolean(grant && Date.parse(grant.expires_at) > Date.now());
    const pastGrace = Date.now() > end + graceMs && !inGranted;
    if (!pastGrace && svc.status === "active" && (svc.grace_days > 0 || inGranted)) {
      await setServiceState(sql, tenantId, svc.id, "grace", "time");
      if (svc.grace_days > 0) {
        await ensureSystemGrant(sql, {
          tenantId,
          serviceId: svc.id,
          customerId: svc.customer_id,
          days: svc.grace_days,
          startsAt: new Date(end),
          expiresAt: new Date(end + graceMs),
        });
      }
      notices += await notify(sql, tenantId, ispName, svc.customer_id, "grace.started", svc.id, {
        service_name: svc.name,
      });
      grace += 1;
      time += 1;
    } else if (pastGrace) {
      await setServiceState(sql, tenantId, svc.id, "suspended", "time");
      notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.suspended", svc.id, {
        service_name: svc.name,
      });
      suspended += 1;
      time += 1;
    }
  }

  const capped = await sql<{ id: string; customer_id: string; name: string }>`
    select s.id, s.customer_id, p.name
    from services s join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId}
      and s.status in ('active','grace')
      and p.bundle_mb > 0
      and s.bundle_used_mb >= p.bundle_mb`;
  for (const svc of capped) {
    await setServiceState(sql, tenantId, svc.id, "suspended", "bundle");
    notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.suspended", svc.id, {
      service_name: svc.name,
    });
    suspended += 1;
    bundle += 1;
  }

  notices += await notifyNearingGrants(sql, tenantId, ispName);

  return {
    due,
    overdue,
    grace,
    suspended,
    time,
    bundle,
    notices,
    vouchers: vouchers.expired,
  };
}

export async function maybeRunAccessPolicy(sql: Sql, tenantId: string, tenantName: string) {
  try {
    const bumped = await sql<{ id: string }>`
      update tenants set access_policy_ran_at = now()
      where id = ${tenantId}
        and (access_policy_ran_at is null or access_policy_ran_at < now() - interval '2 minutes')
      returning id`;
    if (!bumped[0]) return { ran: false };
    const result = await applyAccessPolicy(sql, tenantId, tenantName);
    return { ran: true, ...result };
  } catch {
    return { ran: false };
  }
}

import { provisionServiceAccess } from "./access.ts";
import { intervalDays } from "./billing.ts";
import { nairobiDate } from "./empty-tenant.ts";
import {
  activeGrant,
  consumeActiveGrantsForService,
  ensureSystemGrant,
  expireDueGrants,
  notifyNearingGrants,
} from "./grace.ts";
import { expireDueVouchers } from "./hotspot.ts";
import { addHotspotDuration, hotspotPackageDuration } from "./hotspot-duration.ts";
import { nid } from "../utils.ts";
import { isCreditBlockedReason } from "./business-credit-format.ts";

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
  today = nairobiDate(),
) {
  const rows = await sql<{ id: string }>`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${today}
    limit 1`;
  return Boolean(rows[0]);
}

export async function serviceHasOverdue(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  customerId: string,
  today = nairobiDate(),
) {
  return serviceHasOverdueEx(sql, tenantId, serviceId, customerId, { today });
}

export async function serviceHasOverdueEx(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  customerId: string,
  opts: { today?: string; ignoreInvoiceId?: string } = {},
) {
  const today = opts.today ?? nairobiDate();
  const ignore = opts.ignoreInvoiceId || "";
  const rows = await sql<{ id: string }>`
    select i.id from invoices i
    where i.tenant_id = ${tenantId} and i.customer_id = ${customerId}
      and i.status in ('issued','due','overdue','partial')
      and i.due_date::text < ${today}
      and (${ignore} = '' or i.id <> ${ignore})
      and (
        i.service_id = ${serviceId}
        or exists (
          select 1 from invoice_items ii
          where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id and ii.service_id = ${serviceId}
        )
        or (
          (i.service_id is null or i.service_id = '')
          and not exists (
            select 1 from invoice_items ii
            where ii.invoice_id = i.id and ii.tenant_id = i.tenant_id
              and ii.service_id is not null and ii.service_id <> ''
          )
        )
      )
    limit 1`;
  return Boolean(rows[0]);
}

async function invoiceServiceIds(
  sql: Sql,
  tenantId: string,
  invoiceId: string,
  customerId: string,
  serviceId: string | null,
) {
  if (serviceId) return [serviceId];
  const items = await sql<{ service_id: string }>`
    select distinct service_id from invoice_items
    where invoice_id = ${invoiceId} and tenant_id = ${tenantId}
      and service_id is not null and service_id <> ''`;
  if (items.length) return items.map((i) => i.service_id);
  const svcs = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and deleted_at is null and status in ('active','grace')`;
  if (svcs.length === 1) return [svcs[0]!.id];
  return [];
}

async function creditCovers(sql: Sql, tenantId: string, serviceId: string) {
  try {
    const { creditCoversService } = await import("./business-credit.ts");
    return await creditCoversService(sql, tenantId, serviceId);
  } catch {
    return false;
  }
}

async function notify(
  sql: Sql,
  tenantId: string,
  ispName: string,
  customerId: string,
  event: "invoice.due" | "invoice.overdue" | "grace.started" | "grace.expired" | "service.suspended" | "service.expired",
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
  const purchaseStatus =
    status === "grace"
      ? "active"
      : /time|expir/i.test(reason)
        ? "expired"
        : "suspended";
  await sql`update hotspot_purchases
    set service_status = ${purchaseStatus}, updated_at = now()
    where tenant_id = ${tenantId} and service_id = ${serviceId}
      and payment_status = 'confirmed' and service_status = 'active'`;
  await provisionServiceAccess(sql, tenantId, serviceId);
}

export async function grantPaidPeriod(
  sql: Sql,
  tenantId: string,
  customerId: string,
  now = new Date(),
  serviceId?: string,
  durationMs?: number,
) {
  const svcs = serviceId
    ? await sql<{
        id: string;
        period_end: string | null;
        billing_interval: string;
        validity_hours: number;
        suspend_reason: string;
        access_method: string;
        duration_value: number;
        duration_unit: string;
      }>`select s.id, s.period_end::text as period_end, p.billing_interval, p.validity_hours,
               coalesce(s.suspend_reason,'') as suspend_reason, s.access_method,
               coalesce(p.duration_value,0)::int as duration_value, coalesce(p.duration_unit,'hours') as duration_unit
         from services s join packages p on p.id = s.package_id
         where s.tenant_id = ${tenantId} and s.id = ${serviceId} and s.customer_id = ${customerId}
           and s.deleted_at is null and s.status <> 'terminated'`
    : await sql<{
        id: string;
        period_end: string | null;
        billing_interval: string;
        validity_hours: number;
        suspend_reason: string;
        access_method: string;
        duration_value: number;
        duration_unit: string;
      }>`select s.id, s.period_end::text as period_end, p.billing_interval, p.validity_hours,
               coalesce(s.suspend_reason,'') as suspend_reason, s.access_method,
               coalesce(p.duration_value,0)::int as duration_value, coalesce(p.duration_unit,'hours') as duration_unit
         from services s join packages p on p.id = s.package_id
         where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}
           and s.deleted_at is null and s.status <> 'terminated'`;
  for (const s of svcs) {
    const awaiting = s.suspend_reason === "awaiting_payment";
    let next: Date;
    if (s.access_method === "hotspot" && durationMs == null) {
      const dur = hotspotPackageDuration(s);
      const from = awaiting ? now : (() => {
        const cur = s.period_end ? new Date(s.period_end) : null;
        return cur && !Number.isNaN(cur.getTime()) && cur.getTime() > now.getTime() ? cur : now;
      })();
      next = addHotspotDuration(from, dur.value, dur.unit);
    } else {
      const addMs = durationMs != null ? Math.max(0, Math.trunc(durationMs)) : periodMs(s.billing_interval, s.validity_hours);
      if (addMs <= 0) continue;
      next = extendPeriodEnd(awaiting ? null : s.period_end, now, addMs);
    }
    await sql`update services
      set period_end = ${next.toISOString()}, bundle_used_mb = 0, suspend_reason = '',
          access_until = null, expiry_source = ${"billing"}
      where id = ${s.id} and tenant_id = ${tenantId}`;
  }
  return svcs.length;
}

export async function restorePaidAccess(
  sql: Sql,
  tenantId: string,
  customerId: string,
  serviceId?: string,
  opts?: { durationMs?: number; ignoreInvoiceId?: string; now?: Date; skipGrant?: boolean },
) {
  const targetId = serviceId || "";
  if (!targetId) {
    const live = await sql<{ id: string }>`
      select id from services
      where tenant_id = ${tenantId} and customer_id = ${customerId}
        and deleted_at is null and status <> 'terminated'`;
    if (live.length === 1) return restorePaidAccess(sql, tenantId, customerId, live[0]!.id, opts);
    if (live.length !== 1) return { restored: 0, held: false };
  }

  const [prior] = targetId
    ? await sql<{ suspend_reason: string }>`
        select coalesce(suspend_reason,'') as suspend_reason from services
        where id = ${targetId} and tenant_id = ${tenantId} and deleted_at is null`
    : [];
  if (!opts?.skipGrant) {
    await grantPaidPeriod(sql, tenantId, customerId, opts?.now ?? new Date(), targetId, opts?.durationMs);
  }
  if (await serviceHasOverdueEx(sql, tenantId, targetId, customerId, { ignoreInvoiceId: opts?.ignoreInvoiceId })) {
    if (isCreditBlockedReason(prior?.suspend_reason || "")) {
      return { restored: 0, held: true };
    }
    if (await creditCovers(sql, tenantId, targetId)) {
      /* business credit may restore while older invoices remain unpaid */
    } else {
      return { restored: 0, held: true };
    }
  }
  await consumeActiveGrantsForService(sql, tenantId, targetId);
  const svcs = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and id = ${targetId} and customer_id = ${customerId}
      and deleted_at is null and status in ('grace','suspended','pending')`;
  await sql`update services set status = 'active', suspend_reason = ''
    where id = ${targetId} and customer_id = ${customerId} and tenant_id = ${tenantId}
      and deleted_at is null and status in ('grace','suspended','pending')`;
  await sql`update hotspot_vouchers v
    set status = 'active', used_at = coalesce(v.used_at, now()), expires_at = coalesce(v.expires_at, s.period_end)
    from services s
    where v.service_id = s.id and v.tenant_id = ${tenantId} and s.id = ${targetId}
      and v.status = 'unused'`;
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
     where a.tenant_id = ${tenantId} and a.username = ${username} and s.deleted_at is null
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
     where s.tenant_id = ${tenantId} and s.username = ${username} and s.deleted_at is null
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
  try {
    const { notePppoeSession } = await import("./pppoe-provision.ts");
    await notePppoeSession(sql, tenantId, {
      username,
      framedIp: framed,
      nasIp: nas,
      acctStatus: input.acct_status,
    });
  } catch {
    /* provisioning notes must not fail accounting */
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
    service_id: string | null;
    number: string;
    amount_kes: number;
    status: string;
    due_date: string;
  }>`select id, customer_id, service_id, number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and status in ('issued','due','overdue','partial')
       and amount_kes > paid_kes`;

  const today = nairobiDate();
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
    const targetIds = await invoiceServiceIds(sql, tenantId, inv.id, inv.customer_id, inv.service_id);
    if (inv.due_date < today && inv.status !== "overdue" && inv.status !== "partial") {
      await sql`update invoices set status = 'overdue' where id = ${inv.id} and tenant_id = ${tenantId}`;
      let business = false;
      for (const sid of targetIds) {
        try {
          const { notifyBusinessOverdue } = await import("./business-credit.ts");
          if (
            await notifyBusinessOverdue(sql, {
              tenantId,
              ispName,
              customerId: inv.customer_id,
              serviceId: sid,
              invoiceId: inv.id,
              invoiceNumber: inv.number,
              amountKes: inv.amount_kes,
              dueDate: inv.due_date,
            })
          ) {
            business = true;
            notices += 1;
            break;
          }
        } catch {
          /* fall through to residential overdue */
        }
      }
      if (!business) notices += await notify(sql, tenantId, ispName, inv.customer_id, "invoice.overdue", inv.id, vars);
      overdue += 1;
    }
    if (inv.due_date >= today) continue;

    const daysPast = Math.floor((Date.parse(today) - Date.parse(inv.due_date)) / 86400000);
    if (!targetIds.length) continue;
    const wanted = new Set(targetIds);
    const live = await sql<{
      id: string;
      status: string;
      name: string;
      grace_days: number;
    }>`select s.id, s.status, p.name, p.grace_days
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${tenantId} and s.customer_id = ${inv.customer_id}
         and s.deleted_at is null and s.status in ('active','grace')`;
    const services = live.filter((s) => wanted.has(s.id));

    for (const svc of services) {
      if (await creditCovers(sql, tenantId, svc.id)) continue;
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
    period_end: string | null;
    access_until: string | null;
    expiry_source: string;
  }>`select s.id, s.customer_id, s.status, p.name, p.grace_days,
            s.period_end::text as period_end, s.access_until::text as access_until, s.expiry_source
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId}
       and s.deleted_at is null
       and s.status in ('active','grace')
       and coalesce(case when s.expiry_source = 'staff' then s.access_until end, s.period_end) is not null
       and coalesce(case when s.expiry_source = 'staff' then s.access_until end, s.period_end) <= now()`;

  for (const svc of timed) {
    const endIso = svc.expiry_source === "staff" && svc.access_until ? svc.access_until : svc.period_end;
    const end = Date.parse(endIso || "");
    if (svc.expiry_source === "staff") {
      if (Number.isFinite(end) && Date.now() > end) {
        await setServiceState(sql, tenantId, svc.id, "suspended", "expired_by_staff_date_change");
        notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.expired", svc.id, {
          service_name: svc.name,
        });
        suspended += 1;
        time += 1;
      }
      continue;
    }
    if (await creditCovers(sql, tenantId, svc.id)) continue;
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
      notices += await notify(sql, tenantId, ispName, svc.customer_id, "service.expired", svc.id, {
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
      and s.deleted_at is null
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

  try {
    const { evaluateTenantBusinessCredit } = await import("./business-credit.ts");
    await evaluateTenantBusinessCredit(sql, tenantId, ispName);
  } catch {
    /* credit evaluation must not fail the residential access cycle */
  }

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

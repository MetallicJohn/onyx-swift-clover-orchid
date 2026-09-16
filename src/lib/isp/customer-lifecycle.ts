import { enqueueAgentCommand, enqueueServiceCommand } from "./agent.ts";
import { serviceBalance } from "./ledger.ts";
import { archiveCustomer, archiveService, listAssignedLiveServices } from "./recycle-bin.ts";
import type { InvoiceRow, PackageRow, PaymentRow, ServiceRow, TicketRow } from "./types.ts";
import { listTags } from "./tags.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type AssignedService = {
  id: string;
  package_name: string;
  access_method: string;
  username: string | null;
  static_ip: string | null;
  status: string;
};

export type TrafficLine = {
  service_id: string;
  username: string;
  package_name: string;
  status: string;
  access_method: string;
  online: boolean;
  framed_ip: string;
  nas_ip: string;
  bytes_in: number;
  bytes_out: number;
  started_at: string | null;
  last_seen: string | null;
  duration_sec: number | null;
  router_id: string;
  router_name: string;
  up_bps: number | null;
  down_bps: number | null;
  download_mbps: number;
  upload_mbps: number;
  bundle_used_mb: number;
  bundle_mb: number;
  source: string;
  spark: Array<{ at: number; up_bps: number | null; down_bps: number | null }>;
};

export type CustomerTraffic = {
  at: string;
  source: "radius-accounting" | "traffic-collector" | "routeros";
  freshness: "live" | "stale" | "unavailable";
  last_collected_at: string | null;
  fresh: boolean;
  lines: TrafficLine[];
};

function sanitizeMac(raw: string) {
  const hex = String(raw || "")
    .replace(/[^0-9a-f]/gi, "")
    .toUpperCase();
  if (hex.length === 12) return hex.match(/.{2}/g)?.join(":") ?? hex;
  return String(raw || "").trim();
}

async function loadService(sql: Sql, tenantId: string, serviceId: string) {
  const [svc] = await sql<{
    id: string;
    customer_id: string;
    package_id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    mac_address: string;
    status: string;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
    notes: string;
  }>`select s.id, s.customer_id, s.package_id, s.access_method, s.username, s.static_ip,
            coalesce(s.mac_address,'') as mac_address, s.status, p.name as package_name,
            p.download_mbps, p.upload_mbps, coalesce(s.notes,'') as notes
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId} and s.deleted_at is null`;
  return svc ?? null;
}

async function nasTeardown(sql: Sql, tenantId: string, svc: NonNullable<Awaited<ReturnType<typeof loadService>>>) {
  await enqueueServiceCommand(sql, tenantId, { ...svc, status: "terminated" });
  const [prov] = await sql<{ framed_ip: string; username: string }>`
    select framed_ip, username from service_provisioning
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  const framed = (prov?.framed_ip || svc.static_ip || "").trim();
  const user = svc.username || prov?.username || "";
  if (framed) {
    await enqueueAgentCommand(sql, tenantId, "queue.remove", {
      qname: `pppoe-${user}`.slice(0, 32),
      static_ip: framed,
      username: user,
      service_id: svc.id,
    });
  }
  if (user) {
    await sql`update radius_sessions set stopped_at = now()
      where tenant_id = ${tenantId} and username = ${user} and stopped_at is null`;
    await sql`update radius_accounts set enabled = false
      where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  }
}

export async function listAssignedServices(sql: Sql, tenantId: string, customerId: string) {
  return listAssignedLiveServices(sql, tenantId, customerId);
}

/** Archives a line. The customer record stays live. Network access is revoked. */
export async function deleteService(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  opts?: { actorId?: string; actorLabel?: string; reason?: string },
) {
  return archiveService(sql, tenantId, serviceId, {
    actorId: opts?.actorId || "system",
    actorLabel: opts?.actorLabel,
    reason: opts?.reason || "Deleted from services",
  });
}

export async function reassignService(sql: Sql, tenantId: string, serviceId: string, newCustomerId: string) {
  const svc = await loadService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  const [cus] = await sql<{ id: string; deleted_at: string | null }>`
    select id, deleted_at::text as deleted_at from customers
    where id = ${newCustomerId} and tenant_id = ${tenantId}`;
  if (!cus || cus.deleted_at) throw new Error("Customer not found");
  if (svc.customer_id === newCustomerId) {
    return { id: serviceId, from: svc.customer_id, to: newCustomerId };
  }
  await sql`update services set customer_id = ${newCustomerId}
    where id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update service_provisioning set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update cpe_devices set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update ip_addresses set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  await sql`update service_grace_periods set customer_id = ${newCustomerId}
    where service_id = ${serviceId} and tenant_id = ${tenantId}`;
  return { id: serviceId, from: svc.customer_id, to: newCustomerId };
}

export async function updateService(
  sql: Sql,
  tenantId: string,
  data: {
    id: string;
    package_id?: string;
    username?: string | null;
    static_ip?: string | null;
    mac_address?: string;
    customer_id?: string;
    notes?: string;
  },
) {
  const svc = await loadService(sql, tenantId, data.id);
  if (!svc) throw new Error("Service not found");
  if (data.customer_id && data.customer_id !== svc.customer_id) {
    await reassignService(sql, tenantId, data.id, data.customer_id);
  }
  let packageId = svc.package_id;
  if (data.package_id && data.package_id !== svc.package_id) {
    const [pkg] = await sql<{ id: string; access_method: string }>`
      select id, access_method from packages where id = ${data.package_id} and tenant_id = ${tenantId}`;
    if (!pkg) throw new Error("Package not found");
    packageId = pkg.id;
  }
  const username = data.username === undefined ? svc.username : data.username?.trim() || null;
  const staticIp = data.static_ip === undefined ? svc.static_ip : data.static_ip?.trim() || null;
  const mac = data.mac_address === undefined ? svc.mac_address : sanitizeMac(data.mac_address);
  const notes = data.notes === undefined ? svc.notes : data.notes.trim().slice(0, 4000);
  await sql`update services
    set package_id = ${packageId},
        username = ${username},
        static_ip = ${staticIp},
        mac_address = ${mac},
        notes = ${notes}
    where id = ${data.id} and tenant_id = ${tenantId}`;
  const next = await loadService(sql, tenantId, data.id);
  if (next) await enqueueServiceCommand(sql, tenantId, next);
  return { id: data.id };
}

/**
 * Archives the customer after associated services are handled.
 * Leftover lines must be reassigned first, or `deleteServices` must be true.
 * Invoices and payments are never deleted.
 */
export async function deleteCustomer(
  sql: Sql,
  tenantId: string,
  customerId: string,
  opts?: { deleteServices?: boolean; actorId?: string; actorLabel?: string; reason?: string },
) {
  return archiveCustomer(sql, tenantId, customerId, {
    actorId: opts?.actorId || "system",
    actorLabel: opts?.actorLabel,
    reason: opts?.reason || "Deleted from customers",
    archiveServices: Boolean(opts?.deleteServices),
  });
}

export async function customerTraffic(sql: Sql, tenantId: string, customerId: string): Promise<CustomerTraffic> {
  const [cus] = await sql<{ id: string }>`
    select id from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!cus) throw new Error("Customer not found");
  const lines = await sql<{
    id: string;
    username: string | null;
    static_ip: string | null;
    package_name: string;
    status: string;
    access_method: string;
    download_mbps: number;
    upload_mbps: number;
    bundle_used_mb: number;
    bundle_mb: number;
  }>`select s.id, s.username, s.static_ip, p.name as package_name, s.status, s.access_method,
            p.download_mbps, p.upload_mbps, s.bundle_used_mb, p.bundle_mb
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId} and s.deleted_at is null
     order by s.created_at desc`;
  const usernames = lines.map((l) => l.username).filter((u): u is string => Boolean(u));
  const sessions = usernames.length
    ? await sql.query<{
        username: string;
        framed_ip: string;
        nas_ip: string;
        bytes_in: number;
        bytes_out: number;
        started_at: string;
        stopped_at: string | null;
      }>(
        `select username, framed_ip, nas_ip, bytes_in, bytes_out,
                started_at::text as started_at, stopped_at::text as stopped_at
         from radius_sessions
         where tenant_id = $1 and username = any($2::text[])
         order by started_at desc`,
        [tenantId, usernames],
      )
    : [];
  const liveByUser = new Map<string, (typeof sessions)[number]>();
  for (const ses of sessions) {
    if (liveByUser.has(ses.username)) continue;
    liveByUser.set(ses.username, ses);
  }

  let source: CustomerTraffic["source"] = "radius-accounting";
  let lastCollected: string | null = null;
  const cache = new Map<string, { collected_at: string; router_id: string; router_name: string; up_bps: number | null; down_bps: number | null; source: string; online: boolean }>();
  const sparks = new Map<string, TrafficLine["spark"]>();
  try {
    const { latestSamplesForUsernames, liveTrafficFromCache, shortSparkForUser, trafficFreshness } = await import("./traffic-collector.ts");
    for (const user of usernames) {
      const cached = await liveTrafficFromCache(tenantId, user);
      if (cached) {
        const existing = liveByUser.get(user);
        liveByUser.set(user, {
          username: user,
          framed_ip: cached.framed_ip,
          nas_ip: cached.nas_ip,
          bytes_in: cached.bytes_in,
          bytes_out: cached.bytes_out,
          started_at: existing?.started_at || cached.collected_at,
          stopped_at: cached.online ? null : cached.collected_at,
        });
        cache.set(user, {
          collected_at: cached.collected_at,
          router_id: cached.router_id,
          router_name: cached.router_name,
          up_bps: cached.up_bps,
          down_bps: cached.down_bps,
          source: cached.source,
          online: cached.online,
        });
        source = cached.source === "routeros" ? "routeros" : "traffic-collector";
        lastCollected = cached.collected_at;
        sparks.set(user, await shortSparkForUser(tenantId, user));
      }
    }
    const samples = await latestSamplesForUsernames(sql, tenantId, usernames);
    for (const sample of samples) {
      lastCollected = lastCollected || sample.collected_at;
      if (liveByUser.has(sample.username)) continue;
      liveByUser.set(sample.username, {
        username: sample.username,
        framed_ip: sample.framed_ip,
        nas_ip: sample.nas_ip,
        bytes_in: Number(sample.bytes_in || 0),
        bytes_out: Number(sample.bytes_out || 0),
        started_at: sample.collected_at,
        stopped_at: sample.online ? null : sample.collected_at,
      });
      source = "traffic-collector";
    }
    const freshness = trafficFreshness(lastCollected || sessions[0]?.started_at || null);
    const resolved = source === "radius-accounting" && sessions.length ? ("live" as const) : freshness;
    return {
      at: new Date().toISOString(),
      source,
      freshness: resolved,
      last_collected_at: lastCollected,
      fresh: resolved === "live",
      lines: lines.map((line) => {
        const ses = line.username ? liveByUser.get(line.username) : undefined;
        const cached = line.username ? cache.get(line.username) : undefined;
        const online = Boolean(ses && !ses.stopped_at);
        const started = online ? ses?.started_at || null : null;
        const startedMs = started ? Date.parse(started) : NaN;
        return {
          service_id: line.id,
          username: line.username || "",
          package_name: line.package_name,
          status: line.status,
          access_method: line.access_method,
          online,
          framed_ip: online ? ses?.framed_ip || line.static_ip || "" : line.static_ip || "",
          nas_ip: online ? ses?.nas_ip || "" : "",
          bytes_in: online ? Number(ses?.bytes_in || 0) : 0,
          bytes_out: online ? Number(ses?.bytes_out || 0) : 0,
          started_at: started,
          last_seen: cached?.collected_at || (online ? ses?.started_at || null : null),
          duration_sec: online && Number.isFinite(startedMs) ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000)) : null,
          router_id: cached?.router_id || "",
          router_name: cached?.router_name || "",
          up_bps: online ? cached?.up_bps ?? null : null,
          down_bps: online ? cached?.down_bps ?? null : null,
          download_mbps: Number(line.download_mbps || 0),
          upload_mbps: Number(line.upload_mbps || 0),
          bundle_used_mb: Number(line.bundle_used_mb || 0),
          bundle_mb: Number(line.bundle_mb || 0),
          source: cached?.source || (online ? "radius-accounting" : ""),
          spark: line.username ? sparks.get(line.username) || [] : [],
        };
      }),
    };
  } catch {
    /* tables may not exist yet — fall through to RADIUS accounting */
  }

  return {
    at: new Date().toISOString(),
    source: "radius-accounting",
    freshness: sessions.length ? "live" : "unavailable",
    last_collected_at: sessions[0]?.started_at || null,
    fresh: Boolean(sessions.length),
    lines: lines.map((line) => {
      const ses = line.username ? liveByUser.get(line.username) : undefined;
      const online = Boolean(ses && !ses.stopped_at);
      const started = online ? ses?.started_at || null : null;
      const startedMs = started ? Date.parse(started) : NaN;
      return {
        service_id: line.id,
        username: line.username || "",
        package_name: line.package_name,
        status: line.status,
        access_method: line.access_method,
        online,
        framed_ip: online ? ses?.framed_ip || line.static_ip || "" : line.static_ip || "",
        nas_ip: online ? ses?.nas_ip || "" : "",
        bytes_in: online ? Number(ses?.bytes_in || 0) : 0,
        bytes_out: online ? Number(ses?.bytes_out || 0) : 0,
        started_at: started,
        last_seen: online ? ses?.started_at || null : null,
        duration_sec: online && Number.isFinite(startedMs) ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000)) : null,
        router_id: "",
        router_name: "",
        up_bps: null,
        down_bps: null,
        download_mbps: Number(line.download_mbps || 0),
        upload_mbps: Number(line.upload_mbps || 0),
        bundle_used_mb: Number(line.bundle_used_mb || 0),
        bundle_mb: Number(line.bundle_mb || 0),
        source: online ? "radius-accounting" : "",
        spark: [],
      };
    }),
  };
}

const SERVICE_SELECT = `s.id, s.customer_id, c.name as customer_name, c.phone as customer_phone,
             coalesce(s.account_number, '') as account_number,
             coalesce(c.account_number, '') as customer_account_number,
             coalesce(nullif(s.name,''), p.name) as name,
             s.package_id, p.name as package_name,
             s.access_method, s.username, s.static_ip, coalesce(s.mac_address, '') as mac_address,
             s.status, s.created_at::text as created_at,
             s.period_end::text as period_end, s.access_until::text as access_until, s.expiry_source,
             s.expiry_change_reason, s.bundle_used_mb, p.bundle_mb, s.suspend_reason,
             coalesce(s.notes,'') as notes,
             p.download_mbps, p.upload_mbps, p.billing_interval, p.price_kes,
             (g.id is not null) as grace_active, g.days_granted as grace_days_granted,
             g.starts_at::text as grace_starts_at, g.expires_at::text as grace_expires_at,
             g.granted_by_label as grace_granted_by, g.reason as grace_reason, p.grace_days as package_grace_days`;

export async function loadCustomerRecord(sql: Sql, tenantId: string, customerId: string) {
  const [customer] = await sql<{
    id: string;
    type: string;
    name: string;
    phone: string;
    email: string;
    address: string;
    status: string;
    account_number: string;
    notes: string;
    created_at: string;
    deleted_at: string | null;
  }>`select id, type, name, phone, email, address, status,
            coalesce(account_number,'') as account_number, coalesce(notes,'') as notes,
            created_at::text as created_at, deleted_at::text as deleted_at
     from customers where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!customer) throw new Error("Customer not found");

  const services = await sql.query<
    ServiceRow & { download_mbps: number; upload_mbps: number; billing_interval: string; price_kes: number; notes: string }
  >(
    `select ${SERVICE_SELECT}
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     left join service_grace_periods g
       on g.service_id = s.id and s.tenant_id = g.tenant_id and g.status = 'active'
     where s.tenant_id = $1 and s.customer_id = $2 and s.deleted_at is null
     order by s.created_at desc`,
    [tenantId, customerId],
  );

  const invoices = await sql<InvoiceRow>`
    select i.id, i.customer_id, ${customer.name} as customer_name, i.service_id, i.number, i.amount_kes,
           i.subtotal_kes, i.tax_kes, i.tax_rate, i.paid_kes,
           case when i.status = 'paid' then 0 else greatest(0, i.amount_kes - i.paid_kes) end as remaining_kes,
           i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes,
           coalesce(s.account_number,'') as service_account,
           coalesce(nullif(s.name,''), pk.name, '') as service_name
    from invoices i
    left join services s on s.id = i.service_id and s.tenant_id = i.tenant_id
    left join packages pk on pk.id = s.package_id
    where i.tenant_id = ${tenantId} and i.customer_id = ${customerId}
    order by i.issued_at desc`;

  const payments = await sql<PaymentRow>`
    select p.id, p.customer_id, ${customer.name} as customer_name, p.invoice_id, p.service_id, p.provider,
           p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
    from payments p
    where p.tenant_id = ${tenantId} and p.customer_id = ${customerId}
    order by p.paid_at desc`;

  const tickets = await sql<TicketRow>`
    select t.id, t.customer_id, ${customer.name} as customer_name, t.title, t.category, t.priority,
           t.status, t.assigned_to, t.created_at::text as created_at
    from tickets t
    where t.tenant_id = ${tenantId} and t.customer_id = ${customerId}
    order by t.created_at desc`;

  const messages = await sql<{
    id: string;
    event_code: string;
    channel: string;
    subject: string;
    body: string;
    destination: string;
    status: string;
    created_at: string;
  }>`select id, event_code, channel, subject, body, destination, status, created_at::text as created_at
     from notification_logs
     where tenant_id = ${tenantId} and customer_id = ${customerId}
     order by created_at desc limit 40`;

  const inbox = await sql<{
    id: string;
    subject: string;
    body: string;
    event_code: string;
    created_at: string;
  }>`select id, subject, body, event_code, created_at::text as created_at
     from customer_inbox
     where tenant_id = ${tenantId} and customer_id = ${customerId}
     order by created_at desc limit 40`;

  const serviceIds = services.map((s) => s.id);
  const activity = await sql.query<{
    id: string;
    user_id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    details: string;
    created_at: string;
  }>(
    `select id, user_id, action, entity_type, entity_id, coalesce(details,'') as details, created_at::text as created_at
     from audit_logs
     where tenant_id = $1
       and (entity_id = $2 or entity_id = any($3::text[]))
     order by created_at desc limit 80`,
    [tenantId, customerId, serviceIds.length ? serviceIds : ["__none__"]],
  );

  const tags = await sql<{ id: string; name: string; enabled: boolean }>`
    select t.id, t.name, t.enabled
    from customer_tag_assignments a
    join customer_tags t on t.id = a.tag_id
    where a.tenant_id = ${tenantId} and a.customer_id = ${customerId}
    order by t.name`;

  const others = await sql<{ id: string; name: string; account_number: string }>`
    select id, name, coalesce(account_number,'') as account_number
    from customers
    where tenant_id = ${tenantId} and id <> ${customerId} and deleted_at is null
    order by name`;

  const packages = await sql<PackageRow>`
    select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
    from packages where tenant_id = ${tenantId} and active = true order by name`;

  const tagCatalog = await listTags(sql, tenantId);

  const balance = invoices.reduce((sum, i) => sum + (i.remaining_kes || 0), 0);
  const dueByService = new Map<string, number>();
  for (const inv of invoices) {
    const sid = inv.service_id || "";
    if (!sid) continue;
    dueByService.set(sid, (dueByService.get(sid) || 0) + (inv.remaining_kes || 0));
  }
  const servicesWithDue = services.map((s) => ({
    ...s,
    outstanding_kes: dueByService.get(s.id) ?? 0,
  }));

  return {
    customer: { ...customer, tags, service_count: services.length, balance_kes: balance },
    services: servicesWithDue,
    invoices,
    payments,
    tickets,
    messages,
    inbox,
    activity,
    others,
    packages,
    tagCatalog,
  };
}

export async function loadServiceRecord(sql: Sql, tenantId: string, serviceId: string) {
  const rows = await sql.query<
    ServiceRow & {
      download_mbps: number;
      upload_mbps: number;
      billing_interval: string;
      price_kes: number;
      notes: string;
    }
  >(
    `select ${SERVICE_SELECT}
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     left join service_grace_periods g
       on g.service_id = s.id and s.tenant_id = g.tenant_id and g.status = 'active'
     where s.tenant_id = $1 and s.id = $2 and s.deleted_at is null`,
    [tenantId, serviceId],
  );
  const service = rows[0];
  if (!service) throw new Error("Service not found");

  const [provision] = await sql<{
    username: string;
    framed_ip: string;
    overall: string;
    radius_status: string;
    queue_status: string;
    session_status: string;
    last_error: string;
    router_id: string | null;
  }>`select username, framed_ip, overall, radius_status, queue_status, session_status, last_error, router_id
     from service_provisioning
     where tenant_id = ${tenantId} and service_id = ${serviceId}`;

  const [session] = service.username
    ? await sql<{
        framed_ip: string;
        nas_ip: string;
        bytes_in: number;
        bytes_out: number;
        started_at: string;
        stopped_at: string | null;
      }>`select framed_ip, nas_ip, bytes_in, bytes_out, started_at::text as started_at, stopped_at::text as stopped_at
         from radius_sessions
         where tenant_id = ${tenantId} and username = ${service.username}
         order by started_at desc limit 1`
    : [];

  const activity = await sql<{
    id: string;
    user_id: string;
    action: string;
    details: string;
    created_at: string;
  }>`select id, user_id, action, coalesce(details,'') as details, created_at::text as created_at
     from audit_logs
     where tenant_id = ${tenantId} and entity_id = ${serviceId}
     order by created_at desc limit 40`;

  const packages = await sql<PackageRow>`
    select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
    from packages where tenant_id = ${tenantId} and active = true order by name`;

  const others = await sql<{ id: string; name: string; account_number: string }>`
    select id, name, coalesce(account_number,'') as account_number
    from customers
    where tenant_id = ${tenantId} and id <> ${service.customer_id} and deleted_at is null
    order by name`;

  const outstanding = await serviceBalance(sql, tenantId, serviceId);
  return { service: { ...service, outstanding_kes: outstanding }, provision: provision ?? null, session: session ?? null, activity, packages, others };
}

export { sanitizeMac, nasTeardown };

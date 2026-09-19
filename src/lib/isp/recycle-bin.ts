import { nid } from "../utils.ts";
import { enqueueAgentCommand, enqueueServiceCommand } from "./agent.ts";
import { provisionServiceAccess } from "./access.ts";
import { nairobiDate } from "./empty-tenant.ts";
import { effectiveAccessEndMs } from "./service-expiry-format.ts";
import type { ServiceStatus } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const PERMANENT_DELETE_PHRASE = "PERMANENTLY DELETE";
export const RECYCLE_SOURCE = "staff_recycle_bin";

export type RecycleKind = "customer" | "service";

export type RecycleActor = {
  actorId: string;
  actorLabel?: string;
  reason: string;
  source?: string;
};

export type RecycleRow = {
  kind: RecycleKind;
  id: string;
  name: string;
  account_number: string;
  phone: string;
  access_method: string;
  package_name: string;
  username: string;
  static_ip: string;
  original_status: string;
  deleted_at: string;
  deleted_by: string;
  deleted_by_label: string;
  deletion_reason: string;
  customer_id: string;
  customer_name: string;
  associated_services: number;
  customer_live: boolean;
};

type ServiceSnap = {
  id: string;
  customer_id: string;
  package_id: string;
  access_method: string;
  username: string | null;
  static_ip: string | null;
  mac_address: string;
  status: string;
  suspend_reason: string;
  package_name: string;
  download_mbps: number;
  upload_mbps: number;
  period_end: string | null;
  access_until: string | null;
  expiry_source: string;
  bundle_used_mb: number;
  bundle_mb: number;
  customer_name: string;
  customer_deleted: boolean;
};

function auditDetails(extra: Record<string, unknown>) {
  return JSON.stringify({
    trigger_billing: false,
    send_customer_notifications: false,
    source: RECYCLE_SOURCE,
    ...extra,
  });
}

async function writeAudit(
  sql: Sql,
  tenantId: string,
  actorId: string,
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${actorId}, ${action}, ${entityType}, ${entityId}, ${auditDetails(details)})`;
}

async function loadLiveService(sql: Sql, tenantId: string, serviceId: string) {
  return loadService(sql, tenantId, serviceId, false);
}

async function loadService(sql: Sql, tenantId: string, serviceId: string, includeDeleted: boolean) {
  const [svc] = await sql<ServiceSnap>`
    select s.id, s.customer_id, s.package_id, s.access_method, s.username, s.static_ip,
           coalesce(s.mac_address,'') as mac_address, s.status, s.suspend_reason,
           p.name as package_name, p.download_mbps, p.upload_mbps,
           s.period_end::text as period_end, s.access_until::text as access_until, s.expiry_source,
           s.bundle_used_mb, p.bundle_mb, c.name as customer_name,
           (c.deleted_at is not null) as customer_deleted
    from services s
    join packages p on p.id = s.package_id
    join customers c on c.id = s.customer_id
    where s.id = ${serviceId} and s.tenant_id = ${tenantId}
      and (${includeDeleted} or s.deleted_at is null)
      and s.purged_at is null`;
  return svc ?? null;
}

async function nasOffline(sql: Sql, tenantId: string, svc: ServiceSnap) {
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
  }
  await sql`update radius_accounts set enabled = false
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
}

async function snapshotService(sql: Sql, tenantId: string, svc: ServiceSnap) {
  const ips = await sql<{ address: string; id: string }>`
    select id, address from ip_addresses
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  const cpes = await sql<{ id: string }>`
    select id from cpe_devices where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  return JSON.stringify({
    username: svc.username || "",
    static_ip: svc.static_ip || "",
    package_id: svc.package_id,
    customer_id: svc.customer_id,
    ips: ips.map((r) => r.address),
    cpe_ids: cpes.map((r) => r.id),
  });
}

async function invoiceBlocks(sql: Sql, tenantId: string, customerId: string) {
  const today = nairobiDate();
  const rows = await sql<{ id: string }>`
    select id from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued','due','overdue','partial')
      and due_date::text < ${today}
    limit 1`;
  return Boolean(rows[0]);
}

async function recalculateRestoredStatus(
  sql: Sql,
  tenantId: string,
  svc: ServiceSnap,
): Promise<{ status: ServiceStatus; reason: string }> {
  if (svc.status === "terminated" || svc.suspend_reason === "terminated") {
    return { status: "terminated", reason: svc.suspend_reason || "terminated" };
  }
  const accessEnd = effectiveAccessEndMs(svc);
  if (accessEnd > 0 && accessEnd <= Date.now()) {
    const reason = svc.expiry_source === "staff" ? "expired_by_staff_date_change" : "time";
    return { status: "suspended", reason };
  }
  if (svc.bundle_mb > 0 && svc.bundle_used_mb >= svc.bundle_mb) {
    return { status: "suspended", reason: "bundle" };
  }
  if (svc.suspend_reason === "manual") {
    return { status: "suspended", reason: "manual" };
  }
  if (await invoiceBlocks(sql, tenantId, svc.customer_id)) {
    return { status: "suspended", reason: "invoice" };
  }
  return { status: "active", reason: "" };
}

export async function listAssignedLiveServices(sql: Sql, tenantId: string, customerId: string) {
  return sql<{
    id: string;
    package_name: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
  }>`select s.id, p.name as package_name, s.access_method, s.username, s.static_ip, s.status
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId} and s.deleted_at is null
     order by s.created_at`;
}

export async function listArchivedServicesForCustomer(sql: Sql, tenantId: string, customerId: string) {
  return sql<{
    id: string;
    package_name: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    original_status: string;
    status: string;
  }>`select s.id, p.name as package_name, s.access_method, s.username, s.static_ip,
            case when s.original_status = '' then s.status else s.original_status end as original_status,
            s.status
     from services s join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}
       and s.deleted_at is not null and s.purged_at is null
     order by s.deleted_at desc`;
}

export async function archiveService(sql: Sql, tenantId: string, serviceId: string, opts: RecycleActor) {
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const svc = await loadLiveService(sql, tenantId, serviceId);
  if (!svc) throw new Error("Service not found");
  const meta = await snapshotService(sql, tenantId, svc);
  await nasOffline(sql, tenantId, svc);
  await sql`update services
    set deleted_at = now(),
        deleted_by = ${opts.actorId},
        deleted_by_label = ${opts.actorLabel || ""},
        deletion_reason = ${reason.slice(0, 240)},
        deletion_source = ${opts.source || RECYCLE_SOURCE},
        original_status = ${svc.status},
        restore_metadata = ${meta}
    where id = ${svc.id} and tenant_id = ${tenantId} and deleted_at is null`;
  await writeAudit(sql, tenantId, opts.actorId, "service.archived", "service", svc.id, {
    customer_id: svc.customer_id,
    customer_name: svc.customer_name,
    name: `${svc.customer_name} · ${svc.package_name}`,
    previous_status: svc.status,
    resulting_status: svc.status,
    reason,
    related_customer_id: svc.customer_id,
  });
  return {
    id: svc.id,
    customer_id: svc.customer_id,
    customer_kept: true,
    archived: true as const,
    trigger_billing: false as const,
    send_customer_notifications: false as const,
  };
}

export async function archiveCustomer(
  sql: Sql,
  tenantId: string,
  customerId: string,
  opts: RecycleActor & { archiveServices?: boolean },
) {
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const [cus] = await sql<{ id: string; name: string; status: string; deleted_at: string | null }>`
    select id, name, status, deleted_at::text as deleted_at from customers
    where id = ${customerId} and tenant_id = ${tenantId} and purged_at is null`;
  if (!cus || cus.deleted_at) throw new Error("Customer not found");
  const leftover = await listAssignedLiveServices(sql, tenantId, customerId);
  if (leftover.length && !opts.archiveServices) {
    const err = new Error(
      `${leftover.length} service${leftover.length === 1 ? "" : "s"} still assigned. Reassign them to another customer, or confirm moving the associated services to the Recycle Bin.`,
    );
    (err as Error & { services?: typeof leftover }).services = leftover;
    throw err;
  }
  for (const row of leftover) {
    await archiveService(sql, tenantId, row.id, opts);
  }
  await sql`update customers
    set status = ${"deleted"},
        deleted_at = now(),
        deleted_by = ${opts.actorId},
        deleted_by_label = ${opts.actorLabel || ""},
        deletion_reason = ${reason.slice(0, 240)},
        deletion_source = ${opts.source || RECYCLE_SOURCE},
        original_status = ${cus.status}
    where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  await writeAudit(sql, tenantId, opts.actorId, "customer.archived", "customer", customerId, {
    customer_name: cus.name,
    name: cus.name,
    previous_status: cus.status,
    resulting_status: "deleted",
    reason,
    services_archived: leftover.length,
  });
  return {
    id: customerId,
    name: cus.name,
    services_removed: leftover.length,
    archived: true as const,
    trigger_billing: false as const,
    send_customer_notifications: false as const,
  };
}

async function assertUsernameFree(sql: Sql, tenantId: string, username: string | null, serviceId: string) {
  const user = (username || "").trim();
  if (!user) return;
  const [hit] = await sql<{ id: string }>`
    select id from services
    where tenant_id = ${tenantId} and username = ${user} and deleted_at is null and id <> ${serviceId}
    limit 1`;
  if (hit) throw new Error("That PPPoE / hotspot username is already assigned to a live service");
}

async function assertIpFree(sql: Sql, tenantId: string, ip: string | null, serviceId: string) {
  const address = (ip || "").trim();
  if (!address) return;
  const [hit] = await sql<{ id: string; service_id: string | null }>`
    select id, service_id from ip_addresses
    where tenant_id = ${tenantId} and address = ${address}
      and status <> 'available' and coalesce(service_id,'') <> ${serviceId}
    limit 1`;
  if (hit) throw new Error("That IP address is already assigned to another customer");
}

async function assertNetworkStillValid(sql: Sql, tenantId: string, svc: ServiceSnap) {
  try {
    const [prov] = await sql<{ router_id: string | null }>`
      select router_id from service_provisioning
      where tenant_id = ${tenantId} and service_id = ${svc.id}`;
    if (prov?.router_id) {
      const [router] = await sql<{ id: string }>`
        select id from routers where id = ${prov.router_id} and tenant_id = ${tenantId}`;
      if (!router) {
        throw new Error("The original router is gone. Assign a replacement router before restoring this service.");
      }
    }
  } catch (err) {
    if (err instanceof Error && /original router is gone/.test(err.message)) throw err;
  }
  const ips = await sql<{ pool_id: string | null }>`
    select pool_id from ip_addresses
    where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  for (const ip of ips) {
    if (!ip.pool_id) continue;
    const [pool] = await sql<{ id: string }>`
      select id from ip_pools where id = ${ip.pool_id} and tenant_id = ${tenantId}`;
    if (!pool) {
      throw new Error("The original IP pool is gone. Release or reassign the IP before restoring this service.");
    }
  }
}

export async function restoreService(
  sql: Sql,
  tenantId: string,
  serviceId: string,
  opts: RecycleActor & { assignCustomerId?: string; packageId?: string },
) {
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const svc = await loadService(sql, tenantId, serviceId, true);
  if (!svc) throw new Error("Service not found");
  const [row] = await sql<{ deleted_at: string | null }>`
    select deleted_at::text as deleted_at from services where id = ${serviceId} and tenant_id = ${tenantId}`;
  if (!row?.deleted_at) throw new Error("Service is not in the Recycle Bin");

  let customerId = svc.customer_id;
  if (opts.assignCustomerId) customerId = opts.assignCustomerId;
  const [cus] = await sql<{ id: string; deleted_at: string | null }>`
    select id, deleted_at::text as deleted_at from customers
    where id = ${customerId} and tenant_id = ${tenantId} and purged_at is null`;
  if (!cus || cus.deleted_at) {
    throw new Error("Assign this service to a live customer in this ISP before restoring");
  }

  let packageId = svc.package_id;
  if (opts.packageId) packageId = opts.packageId;
  const [pkg] = await sql<{ id: string; name: string; active: boolean }>`
    select id, name, active from packages where id = ${packageId} and tenant_id = ${tenantId}`;
  if (!pkg) throw new Error("The original package is gone. Choose a replacement package.");
  if (!pkg.active) throw new Error("The original package is inactive. Choose a replacement package.");

  await assertUsernameFree(sql, tenantId, svc.username, svc.id);
  await assertIpFree(sql, tenantId, svc.static_ip, svc.id);
  await assertNetworkStillValid(sql, tenantId, svc);

  if (customerId !== svc.customer_id) {
    await sql`update services set customer_id = ${customerId} where id = ${svc.id} and tenant_id = ${tenantId}`;
    await sql`update service_provisioning set customer_id = ${customerId}
      where service_id = ${svc.id} and tenant_id = ${tenantId}`;
    await sql`update cpe_devices set customer_id = ${customerId}
      where service_id = ${svc.id} and tenant_id = ${tenantId}`;
    await sql`update ip_addresses set customer_id = ${customerId}
      where service_id = ${svc.id} and tenant_id = ${tenantId}`;
    await sql`update service_grace_periods set customer_id = ${customerId}
      where service_id = ${svc.id} and tenant_id = ${tenantId}`;
  }
  if (packageId !== svc.package_id) {
    await sql`update services set package_id = ${packageId} where id = ${svc.id} and tenant_id = ${tenantId}`;
  }

  const next = await loadService(sql, tenantId, svc.id, true);
  if (!next) throw new Error("Service not found");
  const outcome = await recalculateRestoredStatus(sql, tenantId, { ...next, customer_id: customerId });

  await sql`update services
    set deleted_at = null, deleted_by = '', deleted_by_label = '', deletion_reason = '',
        deletion_source = '', restore_metadata = '',
        status = ${outcome.status}, suspend_reason = ${outcome.reason}
    where id = ${svc.id} and tenant_id = ${tenantId}`;
  await provisionServiceAccess(sql, tenantId, svc.id);
  await writeAudit(sql, tenantId, opts.actorId, "service.restored", "service", svc.id, {
    customer_id: customerId,
    customer_name: next.customer_name,
    name: `${next.customer_name} · ${pkg.name}`,
    previous_status: next.status,
    resulting_status: outcome.status,
    reason,
    related_customer_id: customerId,
    assigned: customerId !== svc.customer_id,
  });
  return {
    id: svc.id,
    customer_id: customerId,
    status: outcome.status,
    suspend_reason: outcome.reason,
    trigger_billing: false as const,
    send_customer_notifications: false as const,
  };
}

export async function restoreCustomer(
  sql: Sql,
  tenantId: string,
  customerId: string,
  opts: RecycleActor & { serviceIds?: string[]; restoreAllServices?: boolean },
) {
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const [cus] = await sql<{
    id: string;
    name: string;
    original_status: string;
    deleted_at: string | null;
  }>`select id, name, original_status, deleted_at::text as deleted_at
     from customers where id = ${customerId} and tenant_id = ${tenantId} and purged_at is null`;
  if (!cus?.deleted_at) throw new Error("Customer is not in the Recycle Bin");

  const archived = await listArchivedServicesForCustomer(sql, tenantId, customerId);
  const wanted = opts.restoreAllServices
    ? archived.map((s) => s.id)
    : (opts.serviceIds || []).filter((id) => archived.some((s) => s.id === id));

  const status = cus.original_status && cus.original_status !== "deleted" ? cus.original_status : "active";
  await sql`update customers
    set deleted_at = null, deleted_by = '', deleted_by_label = '', deletion_reason = '',
        deletion_source = '', status = ${status}
    where id = ${customerId} and tenant_id = ${tenantId}`;

  const restoredServices: string[] = [];
  for (const id of wanted) {
    const out = await restoreService(sql, tenantId, id, opts);
    restoredServices.push(out.id);
  }

  await writeAudit(sql, tenantId, opts.actorId, "customer.restored", "customer", customerId, {
    customer_name: cus.name,
    name: cus.name,
    previous_status: "deleted",
    resulting_status: status,
    reason,
    services_restored: restoredServices,
  });
  return {
    id: customerId,
    name: cus.name,
    status,
    services_restored: restoredServices.length,
    associated_archived: archived.length,
    trigger_billing: false as const,
    send_customer_notifications: false as const,
  };
}

async function retentionForCustomer(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{
    invoices: number;
    payments: number;
    ledger: number;
    tickets: number;
    notes: number;
    campaigns: number;
    audit: number;
    sessions: number;
  }>`select
      (select count(*)::int from invoices where tenant_id = ${tenantId} and customer_id = ${customerId}) as invoices,
      (select count(*)::int from payments where tenant_id = ${tenantId} and customer_id = ${customerId}) as payments,
      (select count(*)::int from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}) as ledger,
      (select count(*)::int from tickets where tenant_id = ${tenantId} and customer_id = ${customerId}) as tickets,
      (select count(*)::int from notification_logs where tenant_id = ${tenantId} and customer_id = ${customerId}) as notes,
      (select count(*)::int from comm_recipients where tenant_id = ${tenantId} and customer_id = ${customerId}) as campaigns,
      (select count(*)::int from audit_logs where tenant_id = ${tenantId} and entity_id = ${customerId}) as audit,
      (select count(*)::int from radius_sessions rs
         join services s on s.username = rs.username and s.tenant_id = rs.tenant_id
        where s.tenant_id = ${tenantId} and s.customer_id = ${customerId}) as sessions`;
  return row;
}

async function retentionForService(sql: Sql, tenantId: string, serviceId: string) {
  const [row] = await sql<{ items: number; audit: number; sessions: number }>`
    select
      (select count(*)::int from invoice_items where tenant_id = ${tenantId} and service_id = ${serviceId}) as items,
      (select count(*)::int from audit_logs where tenant_id = ${tenantId} and entity_id = ${serviceId}) as audit,
      (select count(*)::int from radius_sessions rs
         join services s on s.username = rs.username and s.tenant_id = rs.tenant_id
        where s.tenant_id = ${tenantId} and s.id = ${serviceId}) as sessions`;
  return row;
}

function requirePhrase(phrase: string) {
  if (String(phrase || "").trim() !== PERMANENT_DELETE_PHRASE) {
    throw new Error(`Type ${PERMANENT_DELETE_PHRASE} to confirm`);
  }
}

async function releaseServiceNetwork(sql: Sql, tenantId: string, serviceId: string, username: string | null) {
  await sql`update ip_addresses set status = 'available', service_id = null
    where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  await sql`update cpe_devices set service_id = null
    where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  await sql`delete from radius_accounts where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  try {
    await sql`delete from service_provisioning where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  } catch {
    /* optional */
  }
  if (username) {
    await sql`update radius_sessions set stopped_at = now()
      where tenant_id = ${tenantId} and username = ${username} and stopped_at is null`;
  }
}

export async function purgeService(sql: Sql, tenantId: string, serviceId: string, opts: RecycleActor & { confirmPhrase: string }) {
  requirePhrase(opts.confirmPhrase);
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const svc = await loadService(sql, tenantId, serviceId, true);
  if (!svc) throw new Error("Service not found");
  const [state] = await sql<{ deleted_at: string | null; purged_at: string | null }>`
    select deleted_at::text as deleted_at, purged_at::text as purged_at
    from services where id = ${serviceId} and tenant_id = ${tenantId}`;
  if (!state?.deleted_at) throw new Error("Move the service to the Recycle Bin before permanently deleting it");
  if (state.purged_at) throw new Error("Service already permanently deleted");

  const keep = await retentionForService(sql, tenantId, svc.id);
  await writeAudit(sql, tenantId, opts.actorId, "service.purged", "service", svc.id, {
    customer_id: svc.customer_id,
    customer_name: svc.customer_name,
    name: `${svc.customer_name} · ${svc.package_name}`,
    previous_status: svc.status,
    resulting_status: "purged",
    reason,
    related_customer_id: svc.customer_id,
    retained_invoice_items: keep?.items ?? 0,
    retained_audit: keep?.audit ?? 0,
    retained_sessions: keep?.sessions ?? 0,
  });
  await nasOffline(sql, tenantId, svc);
  await releaseServiceNetwork(sql, tenantId, svc.id, svc.username);

  const mustKeep = (keep?.items ?? 0) > 0;
  if (mustKeep) {
    await sql`update services
      set purged_at = now(), purged_by = ${opts.actorId}, purged_by_label = ${opts.actorLabel || ""},
          username = null, static_ip = null, mac_address = ''
      where id = ${svc.id} and tenant_id = ${tenantId}`;
    return { id: svc.id, purged: true, tombstone: true, customer_kept: true };
  }
  try {
    await sql`delete from service_grace_periods where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  } catch {
    /* optional */
  }
  await sql`delete from services where id = ${svc.id} and tenant_id = ${tenantId}`;
  return { id: svc.id, purged: true, tombstone: false, customer_kept: true };
}

const CUSTOMER_OWNED = [
  "payment_intents",
  "loyalty_transactions",
  "loyalty_accounts",
  "portal_otps",
  "portal_sessions",
  "customer_inbox",
] as const;

export async function purgeCustomer(
  sql: Sql,
  tenantId: string,
  customerId: string,
  opts: RecycleActor & { confirmPhrase: string },
) {
  requirePhrase(opts.confirmPhrase);
  const reason = String(opts.reason || "").trim();
  if (!reason) throw new Error("A reason is required");
  const [cus] = await sql<{ id: string; name: string; deleted_at: string | null; purged_at: string | null }>`
    select id, name, deleted_at::text as deleted_at, purged_at::text as purged_at
    from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!cus?.deleted_at) throw new Error("Move the customer to the Recycle Bin before permanently deleting");
  if (cus.purged_at) throw new Error("Customer already permanently deleted");

  const live = await listAssignedLiveServices(sql, tenantId, customerId);
  if (live.length) throw new Error("Reassign or archive remaining live services first");

  const archived = await listArchivedServicesForCustomer(sql, tenantId, customerId);
  for (const row of archived) {
    await purgeService(sql, tenantId, row.id, opts);
  }

  const keep = await retentionForCustomer(sql, tenantId, customerId);
  const [svcRows] = await sql<{ n: number }>`
    select count(*)::int as n from services where tenant_id = ${tenantId} and customer_id = ${customerId}`;
  const mustKeep =
    (keep?.invoices ?? 0) +
      (keep?.payments ?? 0) +
      (keep?.ledger ?? 0) +
      (keep?.audit ?? 0) +
      (keep?.notes ?? 0) +
      (keep?.tickets ?? 0) +
      (keep?.campaigns ?? 0) +
      (keep?.sessions ?? 0) +
      (svcRows?.n ?? 0) >
    0;

  await writeAudit(sql, tenantId, opts.actorId, "customer.purged", "customer", customerId, {
    customer_name: cus.name,
    name: cus.name,
    previous_status: "deleted",
    resulting_status: "purged",
    reason,
    retained_invoices: keep?.invoices ?? 0,
    retained_payments: keep?.payments ?? 0,
    retained_ledger: keep?.ledger ?? 0,
    retained_tickets: keep?.tickets ?? 0,
    tombstone: mustKeep,
  });

  if (mustKeep) {
    await sql`update customers
      set name = ${"Deleted customer"}, phone = ${""}, email = ${""}, address = ${""}, notes = ${""},
          purged_at = now(), purged_by = ${opts.actorId}, purged_by_label = ${opts.actorLabel || ""}
      where id = ${customerId} and tenant_id = ${tenantId}`;
    return { id: customerId, purged: true, tombstone: true, services_purged: archived.length };
  }

  for (const table of CUSTOMER_OWNED) {
    try {
      await sql.query(`delete from ${table} where tenant_id = $1 and customer_id = $2`, [tenantId, customerId]);
    } catch {
      /* optional */
    }
  }
  try {
    await sql.query(`delete from referrals where tenant_id = $1 and referrer_id = $2`, [tenantId, customerId]);
  } catch {
    /* optional */
  }
  await sql`delete from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  return { id: customerId, purged: true, tombstone: false, services_purged: archived.length };
}

export async function listRecycleBin(
  sql: Sql,
  tenantId: string,
  filter: {
    kind?: "all" | RecycleKind;
    q?: string;
    access_method?: string;
    original_status?: string;
    deleted_by?: string;
    from?: string;
    to?: string;
  },
) {
  const customers = await sql<{
    id: string;
    name: string;
    account_number: string;
    phone: string;
    original_status: string;
    deleted_at: string;
    deleted_by: string;
    deleted_by_label: string;
    deletion_reason: string;
    associated: number;
  }>`select c.id, c.name, coalesce(c.account_number,'') as account_number, c.phone,
            case when c.original_status = '' then c.status else c.original_status end as original_status,
            c.deleted_at::text as deleted_at, c.deleted_by, c.deleted_by_label, c.deletion_reason,
            (select count(*)::int from services s
              where s.customer_id = c.id and s.deleted_at is not null and s.purged_at is null) as associated
     from customers c
     where c.tenant_id = ${tenantId} and c.deleted_at is not null and c.purged_at is null
     order by c.deleted_at desc`;

  const services = await sql<{
    id: string;
    customer_id: string;
    customer_name: string;
    account_number: string;
    phone: string;
    access_method: string;
    package_name: string;
    username: string | null;
    static_ip: string | null;
    original_status: string;
    deleted_at: string;
    deleted_by: string;
    deleted_by_label: string;
    deletion_reason: string;
    customer_live: boolean;
  }>`select s.id, s.customer_id, c.name as customer_name, coalesce(s.account_number,'') as account_number,
            c.phone, s.access_method, p.name as package_name, s.username, s.static_ip,
            case when s.original_status = '' then s.status else s.original_status end as original_status,
            s.deleted_at::text as deleted_at, s.deleted_by, s.deleted_by_label, s.deletion_reason,
            (c.deleted_at is null) as customer_live
     from services s
     join customers c on c.id = s.customer_id
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.deleted_at is not null and s.purged_at is null
     order by s.deleted_at desc`;

  const q = (filter.q || "").trim().toLowerCase();
  const from = filter.from || "";
  const to = filter.to || "";
  const method = filter.access_method || "";
  const status = filter.original_status || "";
  const actor = (filter.deleted_by || "").trim().toLowerCase();

  function inRange(iso: string) {
    const day = nairobiDate(iso);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  }

  const customerRows: RecycleRow[] = customers
    .filter((c) => {
      if (!inRange(c.deleted_at)) return false;
      if (status && c.original_status !== status) return false;
      if (actor && !`${c.deleted_by_label} ${c.deleted_by}`.toLowerCase().includes(actor)) return false;
      if (!q) return true;
      const hay = [c.name, c.account_number, c.phone, c.id, c.deleted_by_label, c.deletion_reason]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .map((c) => ({
      kind: "customer" as const,
      id: c.id,
      name: c.name,
      account_number: c.account_number,
      phone: c.phone,
      access_method: "",
      package_name: "",
      username: "",
      static_ip: "",
      original_status: c.original_status,
      deleted_at: c.deleted_at,
      deleted_by: c.deleted_by,
      deleted_by_label: c.deleted_by_label,
      deletion_reason: c.deletion_reason,
      customer_id: c.id,
      customer_name: c.name,
      associated_services: c.associated,
      customer_live: false,
    }));

  const serviceRows: RecycleRow[] = services
    .filter((s) => {
      if (!inRange(s.deleted_at)) return false;
      if (method && s.access_method !== method) return false;
      if (status && s.original_status !== status) return false;
      if (actor && !`${s.deleted_by_label} ${s.deleted_by}`.toLowerCase().includes(actor)) return false;
      if (!q) return true;
      const hay = [
        s.customer_name,
        s.account_number,
        s.phone,
        s.id,
        s.username,
        s.static_ip,
        s.package_name,
        s.access_method,
        s.deleted_by_label,
        s.deletion_reason,
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    })
    .map((s) => ({
      kind: "service" as const,
      id: s.id,
      name: `${s.customer_name} · ${s.package_name}`,
      account_number: s.account_number,
      phone: s.phone,
      access_method: s.access_method,
      package_name: s.package_name,
      username: s.username || "",
      static_ip: s.static_ip || "",
      original_status: s.original_status,
      deleted_at: s.deleted_at,
      deleted_by: s.deleted_by,
      deleted_by_label: s.deleted_by_label,
      deletion_reason: s.deletion_reason,
      customer_id: s.customer_id,
      customer_name: s.customer_name,
      associated_services: 0,
      customer_live: s.customer_live,
    }));

  const kind = filter.kind || "all";
  if (kind === "customer") return customerRows;
  if (kind === "service") return serviceRows;
  return [...customerRows, ...serviceRows].sort((a, b) => (a.deleted_at < b.deleted_at ? 1 : -1));
}

export async function recycleCounts(sql: Sql, tenantId: string) {
  const [c] = await sql<{ n: number }>`
    select count(*)::int as n from customers
    where tenant_id = ${tenantId} and deleted_at is not null and purged_at is null`;
  const [s] = await sql<{ n: number }>`
    select count(*)::int as n from services
    where tenant_id = ${tenantId} and deleted_at is not null and purged_at is null`;
  return { customers: c?.n ?? 0, services: s?.n ?? 0 };
}

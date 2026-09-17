import { nid } from "../utils.ts";
import { likeNeedle } from "./customer-desk-format.ts";
import { last9Phone } from "./customer-portal-format.ts";
import {
  ACS_DEVICE_PAGE_SIZE,
  ACS_DEVICE_SEARCH_LIMIT,
  ACS_DEVICE_SEARCH_MIN,
  assignmentStatus,
  inferDeviceType,
  type AcsAssignmentHit,
  type AcsDeviceFilters,
  type AcsDeviceHit,
  type AcsDeviceRow,
  emptyAcsFilters,
} from "./acs-device-format.ts";
import { loadAcsConfig, syncAcsDevices } from "./acs.ts";
import { nbiOrigin, type NbiFetch } from "./acs-nbi.ts";
import { genieDeviceId } from "./acs-nbi.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const FROM_SQL = `from cpe_devices d
  left join customers c on c.id = d.customer_id and c.tenant_id = d.tenant_id
  left join services s on s.id = d.service_id and s.tenant_id = d.tenant_id
  left join packages p on p.id = s.package_id
  left join service_provisioning sp on sp.service_id = d.service_id and sp.tenant_id = d.tenant_id
  left join routers r on r.id = sp.router_id`;

function parseOpticalRx(raw: string) {
  try {
    const snap = JSON.parse(raw || "{}") as { rx?: string };
    return String(snap.rx || "");
  } catch {
    return "";
  }
}

function mapRow(row: Record<string, unknown>): AcsDeviceRow {
  return {
    id: String(row.id || ""),
    serial: String(row.serial || ""),
    acs_device_id: String(row.acs_device_id || ""),
    manufacturer: String(row.manufacturer || ""),
    model: String(row.model || row.product_class || ""),
    product_class: String(row.product_class || ""),
    manufacturer_oui: String(row.manufacturer_oui || ""),
    mac_address: String(row.mac_address || ""),
    ip_address: String(row.ip_address || ""),
    device_type: String(row.device_type || "cpe"),
    status: String(row.status || "unknown"),
    source: String(row.source || "nbi"),
    ssid: String(row.ssid || ""),
    notes: String(row.notes || ""),
    hardware_version: String(row.hardware_version || ""),
    software_version: String(row.software_version || ""),
    vendor_profile: String(row.vendor_profile || ""),
    last_inform: (row.last_inform as string | null) || null,
    customer_id: (row.customer_id as string | null) || null,
    customer_name: String(row.customer_name || ""),
    customer_account: String(row.customer_account || ""),
    customer_phone: String(row.customer_phone || ""),
    service_id: (row.service_id as string | null) || null,
    service_account: String(row.service_account || ""),
    access_method: String(row.access_method || ""),
    package_name: String(row.package_name || ""),
    service_status: String(row.service_status || ""),
    assigned_at: (row.assigned_at as string | null) || null,
    assigned_by_label: String(row.assigned_by_label || ""),
    last_task_status: String(row.last_task_status || ""),
    last_task_error: String(row.last_task_error || ""),
    last_optical_at: (row.last_optical_at as string | null) || null,
    optical_rx: parseOpticalRx(String(row.optical_snapshot || "")),
    router_name: String(row.router_name || ""),
    location: String(row.location || ""),
  };
}

export function normalizeAcsDeviceQuery(raw?: Partial<AcsDeviceFilters> | Record<string, unknown> | null): AcsDeviceFilters {
  const base = emptyAcsFilters();
  if (!raw) return base;
  const q = raw as Record<string, unknown>;
  return {
    q: String(q.q ?? "").trim(),
    status: String(q.status || "all"),
    online: (["all", "online", "offline", "unknown"].includes(String(q.online)) ? String(q.online) : "all") as AcsDeviceFilters["online"],
    assigned: (["all", "assigned", "unassigned"].includes(String(q.assigned)) ? String(q.assigned) : "all") as AcsDeviceFilters["assigned"],
    vendor: String(q.vendor || q.manufacturer || "").trim(),
    model: String(q.model || "").trim(),
    deviceType: String(q.deviceType || q.device_type || "all"),
    customerId: String(q.customerId || q.customer_id || "").trim(),
    serviceId: String(q.serviceId || q.service_id || "").trim(),
    customer: String(q.customer || "").trim(),
    service: String(q.service || "").trim(),
    location: String(q.location || "").trim(),
    page: Math.max(1, Number(q.page) || 1),
  };
}

function deskWhere(tenantId: string, q: AcsDeviceFilters) {
  const clauses = ["d.tenant_id = $1"];
  const params: unknown[] = [tenantId];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    clauses.push(sql.replace("?", `$${params.length}`));
  };
  if (q.q) {
    const like = likeNeedle(q.q);
    params.push(like);
    const i = params.length;
    clauses.push(`(
      d.serial ilike $${i} escape '#'
      or d.acs_device_id ilike $${i} escape '#'
      or d.manufacturer ilike $${i} escape '#'
      or d.model ilike $${i} escape '#'
      or d.product_class ilike $${i} escape '#'
      or d.mac_address ilike $${i} escape '#'
      or d.ip_address ilike $${i} escape '#'
      or coalesce(c.name,'') ilike $${i} escape '#'
      or coalesce(c.account_number,'') ilike $${i} escape '#'
      or coalesce(s.account_number,'') ilike $${i} escape '#'
    )`);
  }
  if (q.status && q.status !== "all") add("d.status = ?", q.status);
  if (q.online === "online") add("d.status = ?", "online");
  if (q.online === "offline") add("d.status = ?", "offline");
  if (q.online === "unknown") add("d.status = ?", "unknown");
  if (q.assigned === "assigned") clauses.push("d.service_id is not null");
  if (q.assigned === "unassigned") clauses.push("d.service_id is null");
  if (q.vendor) add("d.manufacturer ilike ? escape '#'", likeNeedle(q.vendor));
  if (q.model) {
    params.push(likeNeedle(q.model));
    clauses.push(`(d.model ilike $${params.length} escape '#' or d.product_class ilike $${params.length} escape '#')`);
  }
  if (q.deviceType && q.deviceType !== "all") add("d.device_type = ?", q.deviceType);
  if (q.customerId) add("d.customer_id = ?", q.customerId);
  if (q.serviceId) add("d.service_id = ?", q.serviceId);
  if (q.customer) {
    params.push(likeNeedle(q.customer));
    const i = params.length;
    clauses.push(`(
      coalesce(c.name,'') ilike $${i} escape '#'
      or coalesce(c.account_number,'') ilike $${i} escape '#'
      or coalesce(c.phone,'') ilike $${i} escape '#'
    )`);
  }
  if (q.service) {
    params.push(likeNeedle(q.service));
    const i = params.length;
    clauses.push(`(
      coalesce(s.account_number,'') ilike $${i} escape '#'
      or coalesce(s.username,'') ilike $${i} escape '#'
      or coalesce(s.static_ip,'') ilike $${i} escape '#'
    )`);
  }
  if (q.location) {
    params.push(likeNeedle(q.location));
    const i = params.length;
    clauses.push(`(
      coalesce(r.name,'') ilike $${i} escape '#'
      or coalesce(c.address,'') ilike $${i} escape '#'
    )`);
  }
  return { clause: clauses.join(" and "), params };
}

const SELECT_SQL = `select d.id, d.serial, coalesce(d.acs_device_id,'') as acs_device_id,
  coalesce(d.manufacturer,'') as manufacturer, coalesce(d.model,d.product_class,'') as model,
  d.product_class, coalesce(d.manufacturer_oui,'') as manufacturer_oui,
  coalesce(d.mac_address,'') as mac_address, coalesce(d.ip_address,'') as ip_address,
  coalesce(d.device_type,'cpe') as device_type, d.status, coalesce(d.source,'nbi') as source,
  coalesce(d.ssid,'') as ssid, coalesce(d.notes,'') as notes,
  coalesce(d.hardware_version,'') as hardware_version, coalesce(d.software_version,'') as software_version,
  coalesce(d.vendor_profile,'') as vendor_profile, d.last_inform::text as last_inform,
  d.customer_id, coalesce(c.name,'') as customer_name, coalesce(c.account_number,'') as customer_account,
  coalesce(c.phone,'') as customer_phone, d.service_id,
  coalesce(s.account_number,'') as service_account, coalesce(s.access_method,'') as access_method,
  coalesce(p.name,'') as package_name, coalesce(s.status,'') as service_status,
  d.assigned_at::text as assigned_at, coalesce(d.assigned_by_label,'') as assigned_by_label,
  coalesce(d.last_task_status,'') as last_task_status, coalesce(d.last_task_error,'') as last_task_error,
  d.last_optical_at::text as last_optical_at, coalesce(d.optical_snapshot,'{}') as optical_snapshot,
  coalesce(r.name,'') as router_name, coalesce(c.address,'') as location`;

export async function queryAcsDeviceDesk(sql: Sql, tenantId: string, raw?: Partial<AcsDeviceFilters> | null) {
  const q = normalizeAcsDeviceQuery(raw);
  const { clause, params } = deskWhere(tenantId, q);
  const [countRow] = await sql.query<{ n: number }>(`select count(*)::int as n ${FROM_SQL} where ${clause}`, params);
  const total = countRow?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / ACS_DEVICE_PAGE_SIZE) || 1);
  const page = Math.min(q.page, pages);
  const listParams = [...params, ACS_DEVICE_PAGE_SIZE, (page - 1) * ACS_DEVICE_PAGE_SIZE];
  const rows = await sql.query<Record<string, unknown>>(
    `${SELECT_SQL} ${FROM_SQL} where ${clause} order by d.last_inform desc nulls last, d.serial
     limit $${params.length + 1} offset $${params.length + 2}`,
    listParams,
  );
  const [counters] = await sql.query<{
    total: number;
    online: number;
    offline: number;
    assigned: number;
    unassigned: number;
  }>(
    `select count(*)::int as total,
            count(*) filter (where d.status = 'online')::int as online,
            count(*) filter (where d.status = 'offline')::int as offline,
            count(*) filter (where d.service_id is not null)::int as assigned,
            count(*) filter (where d.service_id is null)::int as unassigned
     from cpe_devices d where d.tenant_id = $1`,
    [tenantId],
  );
  const vendors = await sql.query<{ manufacturer: string }>(
    `select distinct manufacturer from cpe_devices where tenant_id = $1 and manufacturer <> '' order by manufacturer`,
    [tenantId],
  );
  const models = await sql.query<{ model: string }>(
    `select distinct coalesce(nullif(model,''), product_class) as model
     from cpe_devices where tenant_id = $1 and coalesce(nullif(model,''), product_class) <> ''
     order by 1`,
    [tenantId],
  );
  const lastScan = await sql.query<{ last_scan_at: string | null }>(
    `select max(last_scan_at)::text as last_scan_at from cpe_devices where tenant_id = $1`,
    [tenantId],
  );
  return {
    devices: rows.map(mapRow),
    total,
    page,
    pages,
    counters: counters ?? { total: 0, online: 0, offline: 0, assigned: 0, unassigned: 0 },
    vendors: vendors.map((v) => v.manufacturer),
    models: models.map((m) => m.model),
    last_scan_at: lastScan[0]?.last_scan_at || null,
  };
}

export async function searchAvailableAcsDevices(
  sql: Sql,
  tenantId: string,
  q: string,
  opts: { limit?: number } = {},
): Promise<AcsDeviceHit[]> {
  const needle = q.trim();
  const limit = Math.min(ACS_DEVICE_SEARCH_LIMIT, Math.max(1, opts.limit || ACS_DEVICE_SEARCH_LIMIT));
  const like = needle.length >= ACS_DEVICE_SEARCH_MIN ? likeNeedle(needle) : "%";
  const rows = await sql<AcsDeviceHit>`
    select d.id, d.serial, coalesce(d.acs_device_id,'') as acs_device_id,
           coalesce(d.manufacturer,'') as manufacturer, coalesce(d.model,d.product_class,'') as model,
           d.product_class, coalesce(d.manufacturer_oui,'') as manufacturer_oui,
           coalesce(d.mac_address,'') as mac_address, coalesce(d.ip_address,'') as ip_address,
           d.status, d.last_inform::text as last_inform, coalesce(d.source,'nbi') as source,
           (d.service_id is not null) as assigned, coalesce(c.name,'') as customer_name
    from cpe_devices d
    left join customers c on c.id = d.customer_id
    where d.tenant_id = ${tenantId}
      and d.service_id is null
      and (
        ${needle.length < ACS_DEVICE_SEARCH_MIN}
        or d.serial ilike ${like} escape '#'
        or d.acs_device_id ilike ${like} escape '#'
        or d.manufacturer ilike ${like} escape '#'
        or d.model ilike ${like} escape '#'
        or d.product_class ilike ${like} escape '#'
        or d.mac_address ilike ${like} escape '#'
        or d.ip_address ilike ${like} escape '#'
        or d.manufacturer_oui ilike ${like} escape '#'
      )
    order by d.last_inform desc nulls last, d.serial
    limit ${limit}`;
  return rows;
}

export async function searchAcsAssignmentTargets(
  sql: Sql,
  tenantId: string,
  q: string,
  opts: { limit?: number } = {},
): Promise<AcsAssignmentHit[]> {
  const needle = q.trim();
  if (needle.length < ACS_DEVICE_SEARCH_MIN) return [];
  const like = likeNeedle(needle);
  const last9 = last9Phone(needle);
  const limit = Math.min(ACS_DEVICE_SEARCH_LIMIT, Math.max(1, opts.limit || ACS_DEVICE_SEARCH_LIMIT));
  return sql<AcsAssignmentHit>`
    select s.id as service_id, coalesce(s.account_number,'') as service_account,
           s.access_method, p.name as package_name, s.status as service_status,
           coalesce(s.username,'') as username, coalesce(s.static_ip,'') as static_ip,
           c.id as customer_id, c.name as customer_name,
           coalesce(c.account_number,'') as customer_account, c.phone, c.email
    from services s
    join customers c on c.id = s.customer_id
    join packages p on p.id = s.package_id
    where s.tenant_id = ${tenantId}
      and s.deleted_at is null
      and c.deleted_at is null
      and lower(coalesce(c.status,'')) not in ('deleted','inactive','archived')
      and (
        c.name ilike ${like} escape '#'
        or c.phone ilike ${like} escape '#'
        or c.email ilike ${like} escape '#'
        or coalesce(c.account_number,'') ilike ${like} escape '#'
        or coalesce(s.account_number,'') ilike ${like} escape '#'
        or coalesce(s.username,'') ilike ${like} escape '#'
        or coalesce(s.static_ip,'') ilike ${like} escape '#'
        or (${last9.length >= 9} and right(regexp_replace(c.phone, '[^0-9]', '', 'g'), 9) = ${last9})
      )
    order by c.name, p.name
    limit ${limit}`;
}

export async function addManualAcsDevice(
  sql: Sql,
  tenantId: string,
  data: {
    serial?: string;
    acs_device_id?: string;
    manufacturer?: string;
    model?: string;
    oui?: string;
    mac_address?: string;
    device_type?: string;
    notes?: string;
  },
) {
  const serial = String(data.serial || data.acs_device_id || "").trim();
  if (!serial) throw new Error("Serial number or device ID is required");
  const [dup] = await sql<{ id: string }>`
    select id from cpe_devices where tenant_id = ${tenantId} and (serial = ${serial} or acs_device_id = ${String(data.acs_device_id || serial)})`;
  if (dup) throw new Error("A device with this serial is already on this network");
  const model = String(data.model || "Router").trim() || "Router";
  const oui = String(data.oui || "").replace(/[^0-9A-Fa-f]/g, "").toUpperCase().slice(0, 6);
  const acsId = String(data.acs_device_id || "").trim() || genieDeviceId(oui, model, serial);
  const dtype = data.device_type || inferDeviceType(model, data.manufacturer || "");
  const id = nid("cpe");
  await sql`insert into cpe_devices
    (id, tenant_id, serial, product_class, manufacturer, model, manufacturer_oui, acs_device_id,
     mac_address, device_type, notes, status, source, last_inform)
    values (${id}, ${tenantId}, ${serial}, ${model}, ${String(data.manufacturer || "").trim()},
            ${model}, ${oui}, ${acsId}, ${String(data.mac_address || "").trim()}, ${dtype},
            ${String(data.notes || "").trim().slice(0, 400)}, 'unknown', 'manual', null)`;
  return { id, serial, acs_device_id: acsId, status: "unknown" as const, source: "manual" as const };
}

export type AssignAcsOpts = {
  actorId?: string;
  actorLabel?: string;
  confirmMove?: boolean;
  reason?: string;
};

async function liveCustomer(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{
    id: string;
    name: string;
    account_number: string;
    phone: string;
    status: string;
    deleted_at: string | null;
  }>`select id, name, coalesce(account_number,'') as account_number, phone,
            coalesce(status,'active') as status, deleted_at::text as deleted_at
     from customers where id = ${customerId} and tenant_id = ${tenantId}`;
  if (!row || row.deleted_at) throw new Error("Customer not found");
  const s = row.status.toLowerCase();
  if (s === "deleted" || s === "inactive" || s === "archived") {
    throw new Error("Destination customer is not available");
  }
  return row;
}

async function liveService(sql: Sql, tenantId: string, serviceId: string, customerId: string) {
  const [row] = await sql<{
    id: string;
    customer_id: string;
    account_number: string;
    access_method: string;
    status: string;
    package_name: string;
    deleted_at: string | null;
  }>`select s.id, s.customer_id, coalesce(s.account_number,'') as account_number, s.access_method, s.status,
            p.name as package_name, s.deleted_at::text as deleted_at
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
  if (!row || row.deleted_at) throw new Error("Service not found");
  if (row.customer_id !== customerId) throw new Error("Service does not belong to this customer");
  return row;
}

export async function assignAcsDevice(
  sql: Sql,
  tenantId: string,
  deviceId: string,
  customerId: string,
  serviceId: string,
  opts: AssignAcsOpts = {},
) {
  const destCustomer = String(customerId || "").trim();
  const destService = String(serviceId || "").trim();
  if (!destCustomer || !destService) throw new Error("Choose a customer and a service");
  const [device] = await sql<{
    id: string;
    serial: string;
    customer_id: string | null;
    service_id: string | null;
    assigned_at: string | null;
    assigned_by_label: string;
  }>`select id, serial, customer_id, service_id, assigned_at::text as assigned_at,
            coalesce(assigned_by_label,'') as assigned_by_label
     from cpe_devices where id = ${deviceId} and tenant_id = ${tenantId}`;
  if (!device) throw new Error("Device not found");
  const customer = await liveCustomer(sql, tenantId, destCustomer);
  const service = await liveService(sql, tenantId, destService, destCustomer);
  if (device.service_id === destService && device.customer_id === destCustomer) {
    return {
      id: device.id,
      moved: false,
      from_service: device.service_id,
      to_service: destService,
      from_customer: device.customer_id,
      to_customer: destCustomer,
      serial: device.serial,
    };
  }
  if (device.service_id && device.service_id !== destService && !opts.confirmMove) {
    throw new Error("This device is already assigned. Confirm the move.");
  }
  const [taken] = await sql<{ id: string; serial: string }>`
    select id, serial from cpe_devices
    where tenant_id = ${tenantId} and service_id = ${destService} and id <> ${deviceId}`;
  if (taken) throw new Error(`Service already has device ${taken.serial}`);
  await sql.query("begin");
  try {
    await sql`update cpe_devices
      set customer_id = ${destCustomer}, service_id = ${destService},
          assigned_at = now(), assigned_by = ${opts.actorId || ""},
          assigned_by_label = ${opts.actorLabel || ""}
      where id = ${deviceId} and tenant_id = ${tenantId}`;
    await sql.query("commit");
  } catch (err) {
    try {
      await sql.query("rollback");
    } catch {
      /* session may already be idle */
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (/cpe_devices_service_uniq|unique/i.test(msg)) throw new Error("Service already has a device");
    throw err;
  }
  return {
    id: device.id,
    moved: true,
    from_service: device.service_id,
    to_service: destService,
    from_customer: device.customer_id,
    to_customer: destCustomer,
    from_customer_name: "",
    to_customer_name: customer.name,
    to_service_account: service.account_number,
    serial: device.serial,
    previous_assigned_at: device.assigned_at,
    previous_assigned_by: device.assigned_by_label,
    reason: String(opts.reason || "").trim().slice(0, 400),
  };
}

export async function unassignAcsDevice(sql: Sql, tenantId: string, deviceId: string) {
  const [device] = await sql<{ id: string; service_id: string | null; customer_id: string | null; serial: string }>`
    select id, service_id, customer_id, serial from cpe_devices where id = ${deviceId} and tenant_id = ${tenantId}`;
  if (!device) throw new Error("Device not found");
  await sql`update cpe_devices
    set customer_id = null, service_id = null, assigned_at = null, assigned_by = '', assigned_by_label = ''
    where id = ${deviceId} and tenant_id = ${tenantId}`;
  return { id: device.id, serial: device.serial, from_service: device.service_id, from_customer: device.customer_id };
}

export async function loadAcsDeviceRecord(sql: Sql, tenantId: string, deviceId: string) {
  const rows = await sql.query<Record<string, unknown>>(
    `${SELECT_SQL} ${FROM_SQL} where d.tenant_id = $1 and d.id = $2`,
    [tenantId, deviceId],
  );
  const row = rows[0];
  if (!row) throw new Error("Device not found");
  const device = mapRow(row);
  const tasks = await sql<{
    id: string;
    kind: string;
    status: string;
    phase: string;
    result: string;
    error_message: string;
    nbi_accepted: boolean;
    actor_label: string;
    verified_at: string | null;
    created_at: string;
    payload: string;
  }>`select id, kind, status, coalesce(nullif(phase,''), status) as phase, result,
            coalesce(error_message,'') as error_message, coalesce(nbi_accepted,false) as nbi_accepted,
            coalesce(actor_label,'') as actor_label, verified_at::text as verified_at,
            created_at::text as created_at, payload
     from acs_tasks where tenant_id = ${tenantId} and cpe_id = ${deviceId}
     order by created_at desc limit 50`;
  const audit = await sql<{
    id: string;
    action: string;
    user_id: string;
    details: string;
    created_at: string;
  }>`select id, action, user_id, details, created_at::text as created_at
     from audit_logs
     where tenant_id = ${tenantId} and entity_type = 'acs_device' and entity_id = ${deviceId}
     order by created_at desc limit 50`;
  return {
    device,
    assignment: assignmentStatus(device.service_id),
    tasks: tasks.map((t) => ({
      id: t.id,
      kind: t.kind,
      status: t.status,
      phase: t.phase,
      result: t.result,
      error_message: t.error_message,
      nbi_accepted: Boolean(t.nbi_accepted),
      actor_label: t.actor_label,
      verified_at: t.verified_at,
      created_at: t.created_at,
      payload: JSON.stringify(redactTaskPayload(t.payload)),
    })),
    audit,
  };
}

function redactTaskPayload(raw: string) {
  try {
    const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (/pass|secret|psk|key/i.test(k)) continue;
      out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export async function refreshAcsInventory(sql: Sql, tenantId: string, fetchImpl?: NbiFetch) {
  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg)) {
    await sql`update cpe_devices set last_scan_at = now() where tenant_id = ${tenantId}`;
    return { upserted: 0, total: 0, skipped: 0, source: "local" as const, last_scan_at: new Date().toISOString() };
  }
  const out = await syncAcsDevices(sql, tenantId, fetchImpl ?? fetch);
  return { ...out, source: "nbi" as const, last_scan_at: new Date().toISOString() };
}

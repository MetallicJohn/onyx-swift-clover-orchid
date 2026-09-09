import { nid } from "../utils.ts";
import {
  genieDeviceId,
  informStatus,
  lastInformFromGenieDevice,
  nbiListDevices,
  nbiOrigin,
  nbiPing,
  nbiPostTask,
  nbiTaskBody,
  ouiFromGenieDevice,
  productClassFromGenieDevice,
  serialFromGenieDevice,
  type AcsNbiConfig,
  type NbiFetch,
} from "./acs-nbi.ts";
import { hint, open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const ACS_KINDS = ["reboot", "setSsid", "refresh"] as const;

export type AcsDispatchOpts = { fetch?: NbiFetch };

export async function loadAcsConfig(sql: Sql, tenantId: string): Promise<AcsNbiConfig> {
  const [row] = await sql<{
    acs_nbi_url: string;
    acs_nbi_user: string;
    acs_nbi_pass_ref: string;
    acs_oui: string;
  }>`select acs_nbi_url, acs_nbi_user, acs_nbi_pass_ref, acs_oui from tenants where id = ${tenantId}`;
  const fromEnv = (process.env.GENIEACS_NBI_URL || "").trim();
  return {
    nbiUrl: (row?.acs_nbi_url || fromEnv).trim(),
    user: (row?.acs_nbi_user || process.env.GENIEACS_NBI_USER || "").trim(),
    pass: open(row?.acs_nbi_pass_ref || "") || (process.env.GENIEACS_NBI_PASS || "").trim(),
    oui: (row?.acs_oui || "").trim(),
  };
}

export async function saveAcsConfig(
  sql: Sql,
  tenantId: string,
  data: { nbiUrl: string; user: string; pass?: string; oui: string },
) {
  const url = data.nbiUrl.trim().replace(/\/+$/, "");
  const user = data.user.trim();
  const oui = data.oui.replace(/[^0-9A-Fa-f]/g, "").toUpperCase().slice(0, 6);
  if (data.pass && data.pass.trim() && data.pass !== "••••") {
    await sql`update tenants set acs_nbi_url = ${url}, acs_nbi_user = ${user},
      acs_nbi_pass_ref = ${seal(data.pass.trim())}, acs_oui = ${oui} where id = ${tenantId}`;
  } else {
    await sql`update tenants set acs_nbi_url = ${url}, acs_nbi_user = ${user}, acs_oui = ${oui}
      where id = ${tenantId}`;
  }
  return loadAcsConfig(sql, tenantId);
}

export async function acsConnection(sql: Sql, tenantId: string, fetchImpl?: NbiFetch) {
  const cfg = await loadAcsConfig(sql, tenantId);
  const [row] = await sql<{ acs_nbi_pass_ref: string }>`select acs_nbi_pass_ref from tenants where id = ${tenantId}`;
  if (!nbiOrigin(cfg)) {
    return { configured: false, reachable: false, nbiUrl: "", user: "", oui: cfg.oui, passHint: "" };
  }
  const ping = await nbiPing(cfg, fetchImpl ?? fetch);
  return {
    configured: true,
    reachable: ping.ok,
    nbiUrl: cfg.nbiUrl,
    user: cfg.user,
    oui: cfg.oui,
    passHint: hint(row?.acs_nbi_pass_ref || ""),
    error: "error" in ping ? ping.error : ping.ok ? "" : `NBI HTTP ${ping.status}`,
  };
}

export async function queueAcsTask(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  kind: string,
  payload: Record<string, unknown>,
  opts: AcsDispatchOpts = {},
) {
  if (!ACS_KINDS.includes(kind as (typeof ACS_KINDS)[number])) throw new Error("Unknown ACS task");
  const [cpe] = await sql<{
    id: string;
    serial: string;
    product_class: string;
    acs_device_id: string;
    manufacturer_oui: string;
  }>`select id, serial, product_class, acs_device_id, manufacturer_oui from cpe_devices
     where id = ${cpeId} and tenant_id = ${tenantId}`;
  if (!cpe) throw new Error("CPE not found");
  const id = nid("acs");
  await sql`insert into acs_tasks (id, tenant_id, cpe_id, kind, payload, status)
    values (${id}, ${tenantId}, ${cpeId}, ${kind}, ${JSON.stringify(payload)}, 'queued')`;
  if (kind === "setSsid" && payload.ssid) {
    await sql`update cpe_devices set ssid = ${String(payload.ssid)} where id = ${cpeId} and tenant_id = ${tenantId}`;
  }
  const dispatched = await dispatchAcsTask(sql, tenantId, id, opts.fetch);
  return { id, status: dispatched.status, result: dispatched.result };
}

export async function dispatchAcsTask(sql: Sql, tenantId: string, taskId: string, fetchImpl: NbiFetch = fetch) {
  const [task] = await sql<{
    id: string;
    kind: string;
    payload: string;
    cpe_id: string;
    serial: string;
    product_class: string;
    acs_device_id: string;
    manufacturer_oui: string;
  }>`select t.id, t.kind, t.payload, t.cpe_id, d.serial, d.product_class, d.acs_device_id, d.manufacturer_oui
     from acs_tasks t join cpe_devices d on d.id = t.cpe_id
     where t.id = ${taskId} and t.tenant_id = ${tenantId}`;
  if (!task) throw new Error("ACS task not found");
  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg)) {
    const result = "waiting_for_nbi";
    await sql`update acs_tasks set result = ${result} where id = ${task.id}`;
    return { status: "queued" as const, result };
  }
  let payload: { ssid?: string } = {};
  try {
    payload = JSON.parse(task.payload || "{}") as { ssid?: string };
  } catch {
    payload = {};
  }
  const deviceId =
    task.acs_device_id || genieDeviceId(task.manufacturer_oui || cfg.oui, task.product_class, task.serial);
  try {
    const posted = await nbiPostTask(cfg, deviceId, nbiTaskBody(task.kind, payload), fetchImpl);
    if (!posted.ok) {
      const result = `nbi_${posted.status}`;
      await sql`update acs_tasks set status = 'error', result = ${result}, dispatched_at = now() where id = ${task.id}`;
      return { status: "error" as const, result };
    }
    await sql`update acs_tasks set status = 'sent', acs_task_id = ${posted.taskId}, result = 'sent', dispatched_at = now()
      where id = ${task.id}`;
    if (!task.acs_device_id) {
      await sql`update cpe_devices set acs_device_id = ${deviceId} where id = ${task.cpe_id} and tenant_id = ${tenantId}`;
    }
    return { status: "sent" as const, result: "sent" };
  } catch (err) {
    const result = err instanceof Error ? err.message : String(err);
    await sql`update acs_tasks set result = ${result} where id = ${task.id}`;
    return { status: "queued" as const, result };
  }
}

export async function syncAcsDevices(sql: Sql, tenantId: string, fetchImpl: NbiFetch = fetch) {
  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg)) throw new Error("Set the GenieACS NBI URL first");
  const devices = await nbiListDevices(cfg, fetchImpl);
  let upserted = 0;
  for (const doc of devices) {
    const serial = serialFromGenieDevice(doc).trim();
    if (!serial) continue;
    const product = productClassFromGenieDevice(doc);
    const oui = ouiFromGenieDevice(doc);
    const acsId = String(doc._id || genieDeviceId(oui, product, serial));
    const last = lastInformFromGenieDevice(doc);
    const status = informStatus(last);
    const raw = JSON.stringify({ _id: acsId, _lastInform: last });
    const [existing] = await sql<{ id: string }>`
      select id from cpe_devices where tenant_id = ${tenantId} and serial = ${serial}`;
    if (existing) {
      await sql`update cpe_devices set product_class = ${product}, manufacturer_oui = ${oui},
        acs_device_id = ${acsId}, status = ${status}, last_inform = ${last || null}::timestamptz,
        last_inform_raw = ${raw} where id = ${existing.id}`;
    } else {
      await sql`insert into cpe_devices
        (id, tenant_id, serial, product_class, manufacturer_oui, acs_device_id, status, last_inform, last_inform_raw)
        values (${nid("cpe")}, ${tenantId}, ${serial}, ${product}, ${oui}, ${acsId}, ${status},
          ${last || null}::timestamptz, ${raw})`;
    }
    upserted += 1;
  }
  return { upserted, total: devices.length };
}

export async function refreshCpeInform(sql: Sql, tenantId: string, cpeId: string, fetchImpl?: NbiFetch) {
  const cfg = await loadAcsConfig(sql, tenantId);
  const [row] = await sql<{ id: string }>`select id from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("CPE not found");
  if (!nbiOrigin(cfg)) {
    await sql`update cpe_devices set last_inform = now(), status = 'online' where id = ${cpeId} and tenant_id = ${tenantId}`;
    return { ok: true, source: "local" as const };
  }
  await syncAcsDevices(sql, tenantId, fetchImpl ?? fetch);
  const [after] = await sql<{ last_inform: string; status: string }>`
    select last_inform::text as last_inform, status from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
  return { ok: true, source: "nbi" as const, last_inform: after?.last_inform, status: after?.status };
}

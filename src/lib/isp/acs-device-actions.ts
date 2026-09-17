import { nid } from "../utils.ts";
import {
  ACS_DEVICE_ACTION_CATALOG,
  ACS_FACTORY_RESET_PHRASE,
  factoryResetReady,
  taskPhaseLabel,
  unsupportedActionMessage,
  wifiPasswordValid,
  type AcsDeviceAction,
} from "./acs-device-format.ts";
import {
  firstPathValue,
  profileSupports,
  resolveAcsProfile,
  scaleOptical,
  type AcsParameterProfile,
} from "./acs-device-profiles.ts";
import { loadAcsConfig, syncAcsDevices } from "./acs.ts";
import {
  nestedParam,
  nbiGetDevice,
  nbiOrigin,
  nbiPostTask,
  nbiTaskBody,
  type NbiFetch,
} from "./acs-nbi.ts";
import { rateLimit } from "./rate-limit.ts";
import { open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type AcsActor = { id?: string; label?: string };

const DESTRUCTIVE_KINDS = new Set(["reboot", "factoryReset", "firmwareUpgrade"]);

function parseDoc(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}");
    return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function loadCpe(sql: Sql, tenantId: string, cpeId: string) {
  const [row] = await sql<{
    id: string;
    serial: string;
    product_class: string;
    manufacturer: string;
    model: string;
    acs_device_id: string;
    manufacturer_oui: string;
    vendor_profile: string;
    status: string;
    ssid: string;
    last_inform: string | null;
    last_inform_raw: string;
    wifi_snapshot: string;
    optical_snapshot: string;
    source: string;
    last_optical_at: string | null;
  }>`select id, serial, product_class, coalesce(manufacturer,'') as manufacturer,
            coalesce(model, product_class) as model, acs_device_id, manufacturer_oui,
            coalesce(vendor_profile,'') as vendor_profile, status, ssid,
            last_inform::text as last_inform, coalesce(last_inform_raw,'') as last_inform_raw,
            coalesce(wifi_snapshot,'{}') as wifi_snapshot, coalesce(optical_snapshot,'{}') as optical_snapshot,
            coalesce(source,'nbi') as source, last_optical_at::text as last_optical_at
     from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Device not found");
  return row;
}

function profileFor(cpe: Awaited<ReturnType<typeof loadCpe>>) {
  return resolveAcsProfile(cpe.manufacturer, cpe.product_class || cpe.model, cpe.vendor_profile);
}

export function actionsForDevice(
  cpe: { manufacturer: string; product_class: string; model: string; vendor_profile: string; service_id?: string | null; source?: string },
  perms: (permission: string) => boolean,
): AcsDeviceAction[] {
  const profile = resolveAcsProfile(cpe.manufacturer, cpe.product_class || cpe.model, cpe.vendor_profile);
  return ACS_DEVICE_ACTION_CATALOG.map((row) => {
    let supported = profileSupports(profile, row.id);
    if (row.id === "assign") supported = !cpe.service_id;
    if (row.id === "reassign" || row.id === "unassign") supported = Boolean(cpe.service_id);
    if (row.id === "firmware_upgrade") supported = profile.firmwareDownload;
    return { ...row, supported };
  }).filter((row) => perms(row.permission));
}

function assertNotSecret(details: Record<string, unknown>) {
  const blob = JSON.stringify(details);
  if (/passphrase|password|psk|wifi_key/i.test(blob) && /enc:v1:/.test(blob) === false) {
    /* passwords must never appear in audit details */
  }
  return details;
}

export function sanitizeAuditDetails(details: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (/pass|secret|psk|keypass/i.test(k)) continue;
    if (typeof v === "string" && v.startsWith("enc:v1:")) continue;
    out[k] = v;
  }
  return assertNotSecret(out);
}

async function insertTask(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  kind: string,
  payload: Record<string, unknown>,
  actor: AcsActor,
  phase: string,
) {
  const id = nid("acs");
  const safe = { ...payload };
  delete safe.password;
  await sql`insert into acs_tasks (id, tenant_id, cpe_id, kind, payload, status, phase, actor_id, actor_label)
    values (${id}, ${tenantId}, ${cpeId}, ${kind}, ${JSON.stringify(safe)}, 'queued', ${phase},
            ${actor.id || ""}, ${actor.label || ""})`;
  return id;
}

async function markTask(
  sql: Sql,
  tenantId: string,
  taskId: string,
  patch: {
    status?: string;
    phase?: string;
    result?: string;
    error?: string;
    nbiAccepted?: boolean;
    acsTaskId?: string;
    verifiedValue?: string;
    verified?: boolean;
  },
) {
  await sql`update acs_tasks set
      status = coalesce(${patch.status || null}, status),
      phase = coalesce(${patch.phase || null}, phase),
      result = coalesce(${patch.result || null}, result),
      error_message = coalesce(${patch.error || null}, error_message),
      nbi_accepted = coalesce(${patch.nbiAccepted ?? null}, nbi_accepted),
      acs_task_id = coalesce(${patch.acsTaskId || null}, acs_task_id),
      verified_value = coalesce(${patch.verifiedValue || null}, verified_value),
      verified_at = case when ${Boolean(patch.verified)} then now() else verified_at end,
      dispatched_at = coalesce(dispatched_at, now())
    where id = ${taskId} and tenant_id = ${tenantId}`;
}

async function stampDevice(sql: Sql, tenantId: string, cpeId: string, status: string, error: string) {
  await sql`update cpe_devices set last_task_status = ${status}, last_task_error = ${error}
    where id = ${cpeId} and tenant_id = ${tenantId}`;
}

function rateKey(tenantId: string, cpeId: string, kind: string) {
  return `acs:${tenantId}:${cpeId}:${kind}`;
}

async function inFlight(sql: Sql, tenantId: string, cpeId: string, kind: string) {
  const [row] = await sql<{ n: number }>`
    select count(*)::int as n from acs_tasks
    where tenant_id = ${tenantId} and cpe_id = ${cpeId} and kind = ${kind}
      and status in ('queued','sent')
      and coalesce(nullif(phase,''), status) not in ('verified','applied','failed','timed_out','cancelled','error')
      and created_at > now() - interval '2 minutes'`;
  return (row?.n ?? 0) > 0;
}

async function postOrWait(
  sql: Sql,
  tenantId: string,
  cpe: Awaited<ReturnType<typeof loadCpe>>,
  taskId: string,
  kind: string,
  body: Record<string, unknown>,
  fetchImpl: NbiFetch,
) {
  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg) || !cpe.acs_device_id) {
    await markTask(sql, tenantId, taskId, {
      status: "queued",
      phase: "waiting_for_inform",
      result: nbiOrigin(cfg) ? "waiting_for_inform" : "waiting_for_nbi",
    });
    await stampDevice(sql, tenantId, cpe.id, "waiting_for_inform", "");
    return { phase: "waiting_for_inform" as const, nbiAccepted: false, taskId: "" };
  }
  try {
    const posted = await nbiPostTask(cfg, cpe.acs_device_id, body, fetchImpl);
    if (!posted.ok) {
      const timeout = posted.status === 504 || posted.status === 408 || posted.status === 0;
      const phase = timeout ? "waiting_for_inform" : "failed";
      await markTask(sql, tenantId, taskId, {
        status: timeout ? "queued" : "error",
        phase,
        result: `nbi_${posted.status}`,
        error: timeout ? "Device did not answer. Waiting for the next Inform." : `GenieACS NBI ${posted.status}`,
        nbiAccepted: false,
      });
      await stampDevice(sql, tenantId, cpe.id, phase, timeout ? "Waiting for Inform" : `NBI ${posted.status}`);
      return { phase, nbiAccepted: false, taskId: posted.taskId };
    }
    await markTask(sql, tenantId, taskId, {
      status: "sent",
      phase: "applying",
      result: "sent",
      nbiAccepted: true,
      acsTaskId: posted.taskId,
    });
    await stampDevice(sql, tenantId, cpe.id, "applying", "");
    return { phase: "applying" as const, nbiAccepted: true, taskId: posted.taskId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markTask(sql, tenantId, taskId, {
      status: "queued",
      phase: "waiting_for_inform",
      result: msg,
      error: msg,
    });
    await stampDevice(sql, tenantId, cpe.id, "waiting_for_inform", msg);
    return { phase: "waiting_for_inform" as const, nbiAccepted: false, taskId: "" };
  }
}

export async function runAcsDeviceAction(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  kind: string,
  payload: Record<string, unknown>,
  opts: { actor?: AcsActor; fetch?: NbiFetch; confirm?: boolean; confirmPhrase?: string } = {},
) {
  const cpe = await loadCpe(sql, tenantId, cpeId);
  if (DESTRUCTIVE_KINDS.has(kind) && !opts.confirm) {
    throw new Error("Confirm this device action");
  }
  if (kind === "factoryReset" && !factoryResetReady(String(opts.confirmPhrase || ""), Boolean(opts.confirm))) {
    throw new Error(`Type ${ACS_FACTORY_RESET_PHRASE} to confirm factory reset`);
  }
  if (kind === "firmwareUpgrade") {
    throw new Error(unsupportedActionMessage());
  }
  if (DESTRUCTIVE_KINDS.has(kind)) {
    const limit = rateLimit(rateKey(tenantId, cpeId, kind), 4, 10 * 60_000);
    if (!limit.ok) throw new Error("Too many device actions. Wait before retrying.");
  }
  if (await inFlight(sql, tenantId, cpeId, kind)) {
    throw new Error("This action is already in progress on the device");
  }
  const fetchImpl = opts.fetch ?? fetch;
  const actor = opts.actor || {};
  const bodyPayload: Parameters<typeof nbiTaskBody>[1] = {
    ssid: String(payload.ssid || ""),
    objectName: String(payload.objectName || ""),
    parameterNames: Array.isArray(payload.parameterNames) ? (payload.parameterNames as string[]) : undefined,
    parameterValues: Array.isArray(payload.parameterValues)
      ? (payload.parameterValues as Array<[string, string, string]>)
      : undefined,
  };
  if (kind === "setWifi") {
    const profile = profileFor(cpe);
    const band = profile.wifi.find((b) => b.id === payload.band) || profile.wifi[0];
    const values: Array<[string, string, string]> = [];
    if (payload.ssid) {
      for (const path of band?.ssid || []) values.push([path, String(payload.ssid), "xsd:string"]);
    }
    if (payload.password) {
      for (const path of band?.password || []) values.push([path, String(payload.password), "xsd:string"]);
    }
    if (payload.enabled != null) {
      for (const path of band?.enable || []) values.push([path, payload.enabled ? "1" : "0", "xsd:boolean"]);
    }
    if (payload.channel) {
      for (const path of band?.channel || []) values.push([path, String(payload.channel), "xsd:unsignedInt"]);
    }
    if (payload.channelWidth) {
      for (const path of band?.channelWidth || []) values.push([path, String(payload.channelWidth), "xsd:string"]);
    }
    if (payload.mode) {
      for (const path of band?.mode || []) values.push([path, String(payload.mode), "xsd:string"]);
    }
    if (!values.length) throw new Error(unsupportedActionMessage());
    bodyPayload.parameterValues = values;
  }
  const body = nbiTaskBody(kind === "setWifi" ? "setWifi" : kind, bodyPayload);
  const stored: Record<string, unknown> = { ...payload };
  if (payload.password) {
    stored.pass_ref = seal(String(payload.password));
    delete stored.password;
    stored.password_set = true;
  }
  const taskId = await insertTask(sql, tenantId, cpeId, kind, stored, actor, "queued");
  const posted = await postOrWait(sql, tenantId, cpe, taskId, kind, body, fetchImpl);
  return {
    id: taskId,
    kind,
    phase: posted.phase,
    nbi_accepted: posted.nbiAccepted,
    serial: cpe.serial,
    message: taskPhaseLabel(posted.phase),
  };
}

export async function retryAcsTask(sql: Sql, tenantId: string, taskId: string, opts: { actor?: AcsActor; fetch?: NbiFetch } = {}) {
  const [task] = await sql<{
    id: string;
    cpe_id: string;
    kind: string;
    payload: string;
    status: string;
    phase: string;
  }>`select id, cpe_id, kind, payload, status, coalesce(nullif(phase,''), status) as phase
     from acs_tasks where id = ${taskId} and tenant_id = ${tenantId}`;
  if (!task) throw new Error("Task not found");
  if (!["error", "failed", "timed_out", "queued"].includes(task.status) && task.phase !== "failed" && task.phase !== "waiting_for_inform") {
    throw new Error("Only failed or waiting tasks can be retried");
  }
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(task.payload || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  if (payload.pass_ref) payload.password = open(String(payload.pass_ref));
  await sql`update acs_tasks set status = 'cancelled', phase = 'cancelled', result = 'retried'
    where id = ${task.id} and tenant_id = ${tenantId}`;
  return runAcsDeviceAction(sql, tenantId, task.cpe_id, task.kind, payload, {
    actor: opts.actor,
    fetch: opts.fetch,
    confirm: true,
    confirmPhrase: ACS_FACTORY_RESET_PHRASE,
  });
}

export async function readAcsParameters(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  opts: { fetch?: NbiFetch } = {},
) {
  const cpe = await loadCpe(sql, tenantId, cpeId);
  const cfg = await loadAcsConfig(sql, tenantId);
  let doc: Record<string, unknown> | null = null;
  if (nbiOrigin(cfg) && cpe.acs_device_id) {
    try {
      doc = await nbiGetDevice(cfg, cpe.acs_device_id, opts.fetch ?? fetch);
    } catch {
      doc = null;
    }
  }
  if (!doc) doc = parseDoc(cpe.last_inform_raw);
  const profile = profileFor(cpe);
  const read = (d: Record<string, unknown>, path: string) => nestedParam(d, path);
  function pick(paths: string[]) {
    return firstPathValue(doc || {}, paths, read);
  }
  const wifi = profile.wifi.map((band) => {
    const ssid = pick(band.ssid);
    const enable = pick(band.enable);
    const security = pick(band.security);
    const channel = pick(band.channel);
    const width = pick(band.channelWidth);
    const mode = pick(band.mode);
    return {
      id: band.id,
      label: band.label,
      ssid: ssid?.value || "",
      ssid_path: ssid?.path || band.ssid[0] || "",
      enabled: enable ? enable.value === "1" || enable.value.toLowerCase() === "true" : null,
      security: security?.value || "",
      channel: channel?.value || "",
      channel_width: width?.value || "",
      mode: mode?.value || "",
      password: "",
      available: Boolean(ssid?.value || enable?.value),
    };
  });
  const wan = {
    ip: pick(profile.wanIp)?.value || cpe.last_inform_raw && "" || "",
    status: pick(profile.wanStatus)?.value || "",
    gateway: pick(profile.gateway)?.value || "",
    dns: pick(profile.dns)?.value || "",
    path: pick(profile.wanIp)?.path || "",
  };
  wan.ip = pick(profile.wanIp)?.value || "";
  const lan = {
    ip: pick(profile.lanIp)?.value || "",
    mac: pick(profile.mac)?.value || "",
    path: pick(profile.lanIp)?.path || "",
  };
  const uptime = pick(profile.uptime);
  const firmware = pick(profile.firmware);
  const hardware = pick(profile.hardware);
  const hosts = pick(profile.hosts);
  return {
    profile: { id: profile.id, label: profile.label, tree: profile.tree },
    online: cpe.status === "online",
    last_inform: cpe.last_inform,
    source: doc && Object.keys(doc).length > 2 ? "nbi" : "cache",
    wifi,
    wan,
    lan,
    uptime: uptime?.value || "",
    firmware: firmware?.value || cpe.model && "" || "",
    hardware: hardware?.value || "",
    software: firmware?.value || "",
    hosts: hosts?.value || "",
    clients_available: Boolean(hosts?.value),
  };
}

export async function readAcsOptical(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  opts: { fetch?: NbiFetch } = {},
) {
  const cpe = await loadCpe(sql, tenantId, cpeId);
  const profile = profileFor(cpe);
  const cfg = await loadAcsConfig(sql, tenantId);
  let doc: Record<string, unknown> | null = null;
  if (nbiOrigin(cfg) && cpe.acs_device_id) {
    try {
      doc = await nbiGetDevice(cfg, cpe.acs_device_id, opts.fetch ?? fetch);
    } catch {
      doc = null;
    }
  }
  if (!doc) doc = parseDoc(cpe.last_inform_raw);
  const metrics = profile.optical.map((metric) => {
    const hit = firstPathValue(doc || {}, metric.paths, nestedParam);
    if (!hit) {
      return {
        key: metric.key,
        label: metric.label,
        unit: metric.unit,
        value: "",
        path: metric.paths[0] || "",
        available: false,
      };
    }
    return {
      key: metric.key,
      label: metric.label,
      unit: metric.unit,
      value: scaleOptical(hit.value, metric.scale),
      path: hit.path,
      available: true,
    };
  });
  const available = metrics.some((m) => m.available);
  const snapshot = {
    rx: metrics.find((m) => m.key === "rx")?.value || "",
    tx: metrics.find((m) => m.key === "tx")?.value || "",
    temperature: metrics.find((m) => m.key === "temperature")?.value || "",
    voltage: metrics.find((m) => m.key === "voltage")?.value || "",
    bias: metrics.find((m) => m.key === "bias")?.value || "",
    los: metrics.find((m) => m.key === "los")?.value || "",
    pon: metrics.find((m) => m.key === "pon")?.value || "",
    available,
  };
  if (available) {
    await sql`update cpe_devices set optical_snapshot = ${JSON.stringify(snapshot)}, last_optical_at = now()
      where id = ${cpe.id} and tenant_id = ${tenantId}`;
  }
  return {
    available,
    message: available ? "" : "Optical information is not exposed by this device.",
    updated_at: available ? new Date().toISOString() : cpe.last_optical_at,
    last_inform: cpe.last_inform,
    metrics,
    profile: profile.id,
  };
}

export async function applyAcsWifi(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  input: {
    band?: string;
    ssid?: string;
    password?: string;
    security?: string;
    enabled?: boolean;
    channel?: string;
    channelWidth?: string;
    mode?: string;
    confirm: boolean;
  },
  opts: { actor?: AcsActor; fetch?: NbiFetch } = {},
) {
  if (!input.confirm) throw new Error("Review the Wi-Fi changes before applying");
  if (input.password && !wifiPasswordValid(input.password, input.security || "wpa2")) {
    throw new Error("Wi-Fi password must be 8–63 characters for this security mode");
  }
  const cpe = await loadCpe(sql, tenantId, cpeId);
  const profile = profileFor(cpe);
  if (!profile.wifi.length) throw new Error(unsupportedActionMessage());
  const queued = await runAcsDeviceAction(
    sql,
    tenantId,
    cpeId,
    "setWifi",
    {
      band: input.band || profile.wifi[0]?.id,
      ssid: input.ssid,
      password: input.password,
      security: input.security,
      enabled: input.enabled,
      channel: input.channel,
      channelWidth: input.channelWidth,
      mode: input.mode,
    },
    { actor: opts.actor, fetch: opts.fetch },
  );
  const verified = await verifyWifi(sql, tenantId, cpeId, queued.id, { ssid: input.ssid || "" }, opts.fetch);
  if (input.ssid && verified.verified) {
    await sql`update cpe_devices set ssid = ${input.ssid}, last_wifi_at = now(),
      wifi_snapshot = ${JSON.stringify({ ssid: input.ssid, band: input.band || "", security: input.security || "", password_set: Boolean(input.password) })}
      where id = ${cpeId} and tenant_id = ${tenantId}`;
  }
  return { ...queued, ...verified };
}

async function verifyWifi(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  taskId: string,
  expected: { ssid: string },
  fetchImpl?: NbiFetch,
) {
  const cpe = await loadCpe(sql, tenantId, cpeId);
  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg) || !cpe.acs_device_id) {
    await markTask(sql, tenantId, taskId, { phase: "waiting_for_inform", result: "waiting_for_inform" });
    return { verified: false, phase: "waiting_for_inform" as const, actual: "" };
  }
  let doc: Record<string, unknown> | null = null;
  try {
    doc = await nbiGetDevice(cfg, cpe.acs_device_id, fetchImpl ?? fetch);
  } catch {
    doc = null;
  }
  if (!doc) {
    await markTask(sql, tenantId, taskId, { phase: "verification_pending", result: "readback_unavailable" });
    return { verified: false, phase: "verification_pending" as const, actual: "" };
  }
  const profile = profileFor(cpe);
  const ssidHit = firstPathValue(doc, profile.wifi.flatMap((b) => b.ssid), nestedParam);
  const actual = ssidHit?.value || "";
  if (expected.ssid && actual && actual === expected.ssid) {
    await markTask(sql, tenantId, taskId, {
      status: "sent",
      phase: "verified",
      verified: true,
      verifiedValue: actual,
      result: "verified",
    });
    return { verified: true, phase: "verified" as const, actual };
  }
  await markTask(sql, tenantId, taskId, {
    phase: "verification_pending",
    result: actual ? `ssid=${actual}` : "ssid_unconfirmed",
    verifiedValue: actual,
  });
  return { verified: false, phase: "verification_pending" as const, actual };
}

export async function requestAcsInform(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  opts: { actor?: AcsActor; fetch?: NbiFetch } = {},
) {
  return runAcsDeviceAction(sql, tenantId, cpeId, "requestInform", {}, { actor: opts.actor, fetch: opts.fetch });
}

export async function refreshAcsDevice(
  sql: Sql,
  tenantId: string,
  cpeId: string,
  opts: { fetch?: NbiFetch } = {},
) {
  const cfg = await loadAcsConfig(sql, tenantId);
  if (nbiOrigin(cfg)) {
    await syncAcsDevices(sql, tenantId, opts.fetch ?? fetch);
  }
  const cpe = await loadCpe(sql, tenantId, cpeId);
  return { id: cpe.id, status: cpe.status, last_inform: cpe.last_inform, source: nbiOrigin(cfg) ? "nbi" : "local" };
}

export type { AcsParameterProfile };

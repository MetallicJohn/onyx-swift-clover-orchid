import { nid } from "../utils.ts";
import { enqueueAgentCommand, pickRouter } from "./agent.ts";
import { nbiOrigin, nbiPostTask, type NbiFetch } from "./acs-nbi.ts";
import { loadAcsConfig } from "./acs.ts";
import {
  allocatePppoeUsername,
  generatePppoePassword,
  radiusPasswordHint,
  revealRadiusPassword,
  storeRadiusPassword,
  suggestPppoeUsername,
} from "./pppoe-credentials.ts";
import { isOverlayOrNasIp, pppoeGetParameterNames, pppoeSetParameterValues, selectWanPppoeProfile } from "./pppoe-profiles.ts";
import { syncRadiusAccount } from "./radius.ts";
import { authenticateRadius } from "./radius-rest.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type StepStatus = "Passed" | "Failed" | "Blocked" | "Not Tested" | "Not Supported";

export type ProvisionStep = {
  key: string;
  label: string;
  expected: string;
  actual: string;
  status: StepStatus;
  error: string;
  at: string;
};

export type ProvisionOverall =
  | "pending"
  | "queued"
  | "device_offline"
  | "applying"
  | "applied"
  | "verification_pending"
  | "verified"
  | "failed"
  | "retry_required";

export type ProvisionRow = {
  id: string;
  service_id: string;
  customer_id: string;
  cpe_id: string | null;
  router_id: string | null;
  username: string;
  password_hint: string;
  radius_status: string;
  acs_status: string;
  acs_task_id: string;
  session_status: string;
  queue_status: string;
  framed_ip: string;
  overall: ProvisionOverall;
  last_error: string;
  steps: ProvisionStep[];
  updated_at: string;
};

function nowIso() {
  return new Date().toISOString();
}

function parseSteps(raw: string): ProvisionStep[] {
  try {
    const v = JSON.parse(raw || "[]") as ProvisionStep[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function upsertStep(steps: ProvisionStep[], next: Omit<ProvisionStep, "at"> & { at?: string }) {
  const row: ProvisionStep = { ...next, at: next.at || nowIso() };
  const i = steps.findIndex((s) => s.key === row.key);
  if (i >= 0) steps[i] = row;
  else steps.push(row);
  return steps;
}

function overallFrom(steps: ProvisionStep[], acsOffline: boolean): ProvisionOverall {
  if (steps.some((s) => s.status === "Failed")) {
    const failed = steps.filter((s) => s.status === "Failed");
    if (failed.some((s) => /timeout|offline|unreachable/i.test(`${s.error} ${s.actual}`))) return "retry_required";
    return "failed";
  }
  const radius = steps.find((s) => s.key === "radius");
  const acs = steps.find((s) => s.key === "acs");
  const session = steps.find((s) => s.key === "session");
  const queue = steps.find((s) => s.key === "queue");
  if (radius?.status !== "Passed") return "pending";
  if (acs?.status === "Blocked" && session?.status === "Passed" && queue?.status === "Passed") return "verified";
  if (acsOffline) return "device_offline";
  if (acs?.status === "Passed" && session?.status !== "Passed") return "verification_pending";
  if (acs?.status === "Passed" && session?.status === "Passed" && queue?.status === "Passed") return "verified";
  if (acs?.status === "Passed") return "applied";
  if (session?.status === "Passed") return "verification_pending";
  return "queued";
}

async function loadRow(sql: Sql, tenantId: string, serviceId: string) {
  const [row] = await sql<{
    id: string;
    service_id: string;
    customer_id: string;
    cpe_id: string | null;
    router_id: string | null;
    username: string;
    password_hint: string;
    radius_status: string;
    acs_status: string;
    acs_task_id: string;
    session_status: string;
    queue_status: string;
    framed_ip: string;
    overall: string;
    last_error: string;
    steps: string;
    updated_at: string;
  }>`select id, service_id, customer_id, cpe_id, router_id, username, password_hint, radius_status, acs_status,
            acs_task_id, session_status, queue_status, framed_ip, overall, last_error, steps, updated_at::text as updated_at
     from service_provisioning where tenant_id = ${tenantId} and service_id = ${serviceId}`;
  if (!row) return null;
  return { ...row, overall: row.overall as ProvisionOverall, steps: parseSteps(row.steps) } satisfies ProvisionRow;
}

async function saveRow(sql: Sql, tenantId: string, row: ProvisionRow) {
  const overall = overallFrom(row.steps, row.overall === "device_offline" || row.acs_status === "device_offline");
  row.overall = overall;
  await sql`update service_provisioning set
    cpe_id = ${row.cpe_id}, router_id = ${row.router_id}, username = ${row.username},
    password_hint = ${row.password_hint}, radius_status = ${row.radius_status}, acs_status = ${row.acs_status},
    acs_task_id = ${row.acs_task_id}, session_status = ${row.session_status}, queue_status = ${row.queue_status},
    framed_ip = ${row.framed_ip}, overall = ${row.overall}, last_error = ${row.last_error},
    steps = ${JSON.stringify(row.steps)}, updated_at = now()
    where id = ${row.id} and tenant_id = ${tenantId}`;
  return row;
}

export async function getProvisioning(sql: Sql, tenantId: string, serviceId: string) {
  return loadRow(sql, tenantId, serviceId);
}

export async function listProvisioning(sql: Sql, tenantId: string) {
  const rows = await sql<{
    service_id: string;
    overall: string;
    radius_status: string;
    acs_status: string;
    session_status: string;
    queue_status: string;
    framed_ip: string;
    username: string;
    password_hint: string;
    last_error: string;
    cpe_id: string | null;
    updated_at: string;
  }>`select service_id, overall, radius_status, acs_status, session_status, queue_status, framed_ip, username,
            password_hint, last_error, cpe_id, updated_at::text as updated_at
     from service_provisioning where tenant_id = ${tenantId}`;
  return rows;
}

async function serviceContext(sql: Sql, tenantId: string, serviceId: string) {
  const [svc] = await sql<{
    id: string;
    customer_id: string;
    access_method: string;
    username: string | null;
    static_ip: string | null;
    status: string;
    package_name: string;
    download_mbps: number;
    upload_mbps: number;
    customer_name: string;
    phone: string;
    account_number: string;
  }>`select s.id, s.customer_id, s.access_method, s.username, s.static_ip, s.status,
            p.name as package_name, p.download_mbps, p.upload_mbps,
            c.name as customer_name, c.phone, coalesce(c.account_number,'') as account_number
     from services s
     join packages p on p.id = s.package_id
     join customers c on c.id = s.customer_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId} and s.deleted_at is null`;
  return svc ?? null;
}

export async function startPppoeProvision(
  sql: Sql,
  tenantId: string,
  opts: {
    serviceId: string;
    cpeId?: string | null;
    manualUsername?: string;
    rotate?: boolean;
    fetch?: NbiFetch;
  },
) {
  const svc = await serviceContext(sql, tenantId, opts.serviceId);
  if (!svc) throw new Error("Service not found");
  if (svc.access_method !== "pppoe") throw new Error("Not a PPPoE service");

  let row = await loadRow(sql, tenantId, svc.id);
  if (!row) {
    const id = nid("prv");
    await sql`insert into service_provisioning (id, tenant_id, service_id, customer_id, cpe_id)
      values (${id}, ${tenantId}, ${svc.id}, ${svc.customer_id}, ${opts.cpeId || null})`;
    row = await loadRow(sql, tenantId, svc.id);
  }
  if (!row) throw new Error("Could not start provisioning");
  if (opts.cpeId) row.cpe_id = opts.cpeId;

  const [existingRad] = await sql<{ username: string; password: string }>`
    select username, password from radius_accounts where tenant_id = ${tenantId} and service_id = ${svc.id}`;
  const keepExisting = Boolean(existingRad) && !opts.rotate;
  const preferred =
    (opts.manualUsername || "").trim() ||
    svc.username ||
    existingRad?.username ||
    suggestPppoeUsername({
      accountNumber: svc.account_number,
      phone: svc.phone,
      name: svc.customer_name,
      serviceId: svc.id,
    });
  const username = keepExisting && existingRad?.username ? existingRad.username : await allocatePppoeUsername(sql, tenantId, svc.id, preferred);
  const password = keepExisting && existingRad ? revealRadiusPassword(existingRad.password) : generatePppoePassword();
  if (!keepExisting && existingRad && !opts.rotate && opts.manualUsername && opts.manualUsername !== existingRad.username) {
    throw new Error("Existing PPPoE credentials were not overwritten. Rotate to change them.");
  }

  upsertStep(row.steps, {
    key: "credentials",
    label: "PPPoE credentials",
    expected: "Unique username and a generated password linked to this service",
    actual: keepExisting ? `Kept ${username}` : `Issued ${username}`,
    status: "Passed",
    error: "",
  });

  await sql`update services set username = ${username}, status = case when status = 'terminated' then status else 'pending' end
    where id = ${svc.id} and tenant_id = ${tenantId}`;

  const sealed = storeRadiusPassword(password);
  const radius = await syncRadiusAccount(sql, tenantId, {
    id: svc.id,
    access_method: "pppoe",
    username,
    static_ip: svc.static_ip,
    status: "pending",
    package_name: svc.package_name,
    download_mbps: svc.download_mbps,
    upload_mbps: svc.upload_mbps,
    password: sealed,
  });
  await sql`update radius_accounts set password = ${sealed} where tenant_id = ${tenantId} and service_id = ${svc.id}`;

  const auth = await authenticateRadius(sql, tenantId, { username: radius.username, password });
  upsertStep(row.steps, {
    key: "radius",
    label: "RADIUS account",
    expected: "FreeRADIUS can authenticate this username",
    actual: auth.ok ? "Access-Accept (application RADIUS)" : `Reject: ${auth.reason}`,
    status: auth.ok ? "Passed" : "Failed",
    error: auth.ok ? "" : auth.reason,
  });
  row.username = radius.username;
  row.password_hint = radiusPasswordHint(sealed);
  row.radius_status = auth.ok ? "verified" : "failed";
  if (!auth.ok) row.last_error = `RADIUS ${auth.reason}`;

  await enqueueAgentCommand(sql, tenantId, "pppoe.upsert", {
    service_id: svc.id,
    username,
    password,
    status: "pending",
    package: svc.package_name,
    download_mbps: svc.download_mbps,
    upload_mbps: svc.upload_mbps,
  });
  upsertStep(row.steps, {
    key: "nas-secret",
    label: "MikroTik PPP secret",
    expected: "NAS has the PPPoE secret for this username",
    actual: "Queued on the connected router agent",
    status: "Passed",
    error: "",
  });

  if (row.cpe_id) {
    await pushPppoeToCpe(sql, tenantId, row, { username, password, fetch: opts.fetch });
  } else {
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: "CPE WAN receives username/password",
      actual: "No CPE selected — credentials are RADIUS-only until a router is linked",
      status: "Blocked",
      error: "",
    });
    row.acs_status = "skipped";
  }

  upsertStep(row.steps, {
    key: "session",
    label: "PPPoE session",
    expected: "Accounting Start with a customer framed IP",
    actual: row.session_status === "verified" ? `Session ${row.framed_ip}` : "Waiting for RADIUS accounting",
    status: row.session_status === "verified" ? "Passed" : "Not Tested",
    error: "",
  });
  upsertStep(row.steps, {
    key: "queue",
    label: "Easy Queue",
    expected: "Simple queue target = customer framed IP/32, not the AP overlay",
    actual: row.queue_status === "verified" ? `Queue ${row.framed_ip}/32` : "Waiting for session IP",
    status: row.queue_status === "verified" ? "Passed" : "Not Tested",
    error: "",
  });

  await saveRow(sql, tenantId, row);
  return { ...row, password: keepExisting && !opts.rotate ? "" : password };
}

async function pushPppoeToCpe(
  sql: Sql,
  tenantId: string,
  row: ProvisionRow,
  opts: { username: string; password: string; fetch?: NbiFetch },
) {
  const [cpe] = await sql<{
    id: string;
    serial: string;
    product_class: string;
    acs_device_id: string;
    manufacturer_oui: string;
    last_inform_raw: string;
    status: string;
    last_inform: string | null;
    customer_id: string | null;
  }>`select id, serial, product_class, acs_device_id, manufacturer_oui, last_inform_raw, status,
            last_inform::text as last_inform, customer_id
     from cpe_devices where id = ${row.cpe_id} and tenant_id = ${tenantId}`;
  if (!cpe) {
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: "Task on the customer CPE",
      actual: "CPE not found for this ISP",
      status: "Failed",
      error: "CPE not found",
    });
    row.acs_status = "failed";
    row.last_error = "CPE not found";
    return;
  }
  if (cpe.customer_id && cpe.customer_id !== row.customer_id) {
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: "CPE belongs to this customer",
      actual: "CPE is linked to a different customer",
      status: "Failed",
      error: "CPE customer mismatch",
    });
    row.acs_status = "failed";
    row.last_error = "CPE customer mismatch";
    return;
  }
  await sql`update cpe_devices set customer_id = ${row.customer_id}, service_id = ${row.service_id}
    where id = ${cpe.id} and tenant_id = ${tenantId}`;

  const cfg = await loadAcsConfig(sql, tenantId);
  if (!nbiOrigin(cfg)) {
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: "Private NBI setParameterValues",
      actual: "NBI URL is not configured",
      status: "Blocked",
      error: "GenieACS NBI is not set",
    });
    row.acs_status = "blocked";
    row.overall = "queued";
    return;
  }

  const profile = selectWanPppoeProfile(cpe.product_class, cpe.last_inform_raw);
  const deviceId = cpe.acs_device_id || `${cpe.manufacturer_oui}-${cpe.product_class}-${cpe.serial}`;
  const body = pppoeSetParameterValues(profile, opts.username, opts.password);
  const taskId = nid("acs");
  await sql`insert into acs_tasks (id, tenant_id, cpe_id, kind, payload, status)
    values (${taskId}, ${tenantId}, ${cpe.id}, ${"setPppoe"}, ${JSON.stringify({ profile: profile.id, username: opts.username })}, 'queued')`;
  try {
    const posted = await nbiPostTask(cfg, deviceId, body, opts.fetch ?? fetch);
    if (!posted.ok) {
      const offline = posted.status === 0 || posted.status === 504 || posted.status === 408;
      await sql`update acs_tasks set status = ${offline ? "queued" : "error"}, result = ${`nbi_${posted.status}`}, dispatched_at = now()
        where id = ${taskId}`;
      upsertStep(row.steps, {
        key: "acs",
        label: "GenieACS WAN PPPoE",
        expected: "NBI applies WAN PPPoE and we read the username back",
        actual: offline ? `Device offline (NBI ${posted.status})` : `NBI HTTP ${posted.status}`,
        status: offline ? "Blocked" : "Failed",
        error: `nbi_${posted.status}`,
      });
      row.acs_status = offline ? "device_offline" : "failed";
      row.overall = offline ? "device_offline" : "failed";
      row.last_error = offline ? "Router provisioning pending — device offline" : `GenieACS NBI ${posted.status}`;
      row.acs_task_id = posted.taskId || taskId;
      return;
    }
    await sql`update acs_tasks set status = 'sent', acs_task_id = ${posted.taskId}, result = 'sent', dispatched_at = now()
      where id = ${taskId}`;
    row.acs_task_id = posted.taskId || taskId;
    row.acs_status = "applied";
    const verified = await verifyCpeUsername(cfg, deviceId, profile, opts.username, opts.fetch);
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: `Set ${profile.username} then read it back`,
      actual: verified.ok ? `Read back ${verified.value} via ${profile.id}` : verified.reason,
      status: verified.ok ? "Passed" : "Not Tested",
      error: verified.ok ? "" : verified.reason,
    });
    if (!verified.ok) {
      row.acs_status = "verification_pending";
      row.overall = "verification_pending";
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await sql`update acs_tasks set result = ${message} where id = ${taskId}`;
    upsertStep(row.steps, {
      key: "acs",
      label: "GenieACS WAN PPPoE",
      expected: "NBI reachable",
      actual: message,
      status: "Failed",
      error: message,
    });
    row.acs_status = "failed";
    row.last_error = message;
    row.overall = "retry_required";
  }
}

async function verifyCpeUsername(
  cfg: Awaited<ReturnType<typeof loadAcsConfig>>,
  deviceId: string,
  profile: ReturnType<typeof selectWanPppoeProfile>,
  username: string,
  fetchImpl?: NbiFetch,
) {
  try {
    const posted = await nbiPostTask(cfg, deviceId, pppoeGetParameterNames(profile), fetchImpl ?? fetch);
    const blob = JSON.stringify(posted.json || posted.text || "");
    if (!posted.ok) return { ok: false, reason: `Read-back HTTP ${posted.status} — not marking verified`, value: "" };
    if (blob.includes(username)) return { ok: true, reason: "", value: username };
    return { ok: false, reason: "NBI accepted the write; parameter read-back did not include the username", value: "" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), value: "" };
  }
}

export async function notePppoeSession(
  sql: Sql,
  tenantId: string,
  input: { username: string; framedIp?: string; nasIp?: string; acctStatus?: string },
) {
  const [svc] = await sql<{ id: string; package_name: string; download_mbps: number; upload_mbps: number; status: string }>`
    select s.id, p.name as package_name, p.download_mbps, p.upload_mbps, s.status
    from radius_accounts a
    join services s on s.id = a.service_id
    join packages p on p.id = s.package_id
    where a.tenant_id = ${tenantId} and a.username = ${input.username}
    limit 1`;
  if (!svc) return;
  const row = await loadRow(sql, tenantId, svc.id);
  if (!row) return;
  const ip = (input.framedIp || "").trim();
  if (input.acctStatus === "stop") {
    upsertStep(row.steps, {
      key: "session",
      label: "PPPoE session",
      expected: "Session still up",
      actual: "Accounting Stop",
      status: "Not Tested",
      error: "",
    });
    row.session_status = "stopped";
    if (row.framed_ip) await enqueueQueue(sql, tenantId, row, svc, "remove");
    await saveRow(sql, tenantId, row);
    return;
  }
  if (ip && isOverlayOrNasIp(ip)) {
    upsertStep(row.steps, {
      key: "queue",
      label: "Easy Queue",
      expected: "Customer framed IP/32",
      actual: `Ignored ${ip} (overlay/NAS address)`,
      status: "Failed",
      error: "Would have queued the AP management IP",
    });
    row.last_error = "Framed IP looks like the overlay, not the customer";
    await saveRow(sql, tenantId, row);
    return;
  }
  if (ip) row.framed_ip = ip;
  upsertStep(row.steps, {
    key: "session",
    label: "PPPoE session",
    expected: "Accounting Start linked to this customer",
    actual: ip ? `Session ${ip} NAS ${input.nasIp || ""}` : "Start without framed IP",
    status: ip ? "Passed" : "Not Tested",
    error: "",
  });
  row.session_status = ip ? "verified" : "pending";
  if (svc.status === "pending") {
    await sql`update services set status = 'active' where id = ${svc.id} and tenant_id = ${tenantId}`;
  }
  if (ip) await enqueueQueue(sql, tenantId, row, svc, "upsert");
  await saveRow(sql, tenantId, row);
}

async function enqueueQueue(
  sql: Sql,
  tenantId: string,
  row: ProvisionRow,
  svc: { id: string; package_name: string; download_mbps: number; upload_mbps: number },
  action: "upsert" | "remove",
) {
  const rid = row.router_id || (await pickRouter(sql, tenantId));
  row.router_id = rid;
  const qname = `pppoe-${row.username}`.slice(0, 32);
  await enqueueAgentCommand(
    sql,
    tenantId,
    action === "remove" ? "queue.remove" : "queue.upsert",
    {
      username: row.username,
      static_ip: row.framed_ip,
      qname,
      package: svc.package_name,
      download_mbps: svc.download_mbps,
      upload_mbps: svc.upload_mbps,
      service_id: svc.id,
    },
    rid,
  );
  upsertStep(row.steps, {
    key: "queue",
    label: "Easy Queue",
    expected: `${row.framed_ip}/32 at ${svc.download_mbps}M/${svc.upload_mbps}M`,
    actual: action === "remove" ? `Remove ${qname}` : `Queued ${qname} target ${row.framed_ip}/32`,
    status: "Passed",
    error: "",
  });
  row.queue_status = action === "remove" ? "removed" : "verified";
}

export async function retryPppoeProvision(sql: Sql, tenantId: string, serviceId: string, fetchImpl?: NbiFetch) {
  return startPppoeProvision(sql, tenantId, { serviceId, rotate: false, fetch: fetchImpl });
}

export async function rotatePppoeCredentials(sql: Sql, tenantId: string, serviceId: string, fetchImpl?: NbiFetch) {
  const row = await loadRow(sql, tenantId, serviceId);
  return startPppoeProvision(sql, tenantId, { serviceId, cpeId: row?.cpe_id, rotate: true, fetch: fetchImpl });
}

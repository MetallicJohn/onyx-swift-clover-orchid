import { randomBytes } from "node:crypto";
import { nid } from "../utils.ts";
import {
  allocateAcsPort,
  buildAcsUrl,
  ensureTenantAcsPort,
  loadAcsPlatformSettings,
  resolveAcsPublicHost,
  withAcsPortLock,
} from "./acs-ports.ts";
import { hint, open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type AcsIspCredentials = {
  tenant_id: string;
  enabled: boolean;
  public_host: string;
  dns_host: string;
  cwmp_port: number | null;
  cwmp_url: string;
  alt_url: string;
  username: string;
  password: string;
  password_hint: string;
  connreq_user: string;
  connreq_password: string;
  connreq_password_hint: string;
  inform_interval: number;
  generated_at: string | null;
  password_rotated_at: string | null;
  last_verified_at: string | null;
  last_verify_ok: boolean | null;
  last_verify_error: string;
  created_at: string | null;
  updated_at: string | null;
};

export function acsUsernameFor(slug: string) {
  const s = (slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24);
  return `tenant_${s || "isp"}`;
}

export function acsConnreqUserFor(slug: string) {
  const s = (slug || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 22);
  return `cr_${s || "isp"}`;
}

export function newAcsSecret() {
  return randomBytes(16).toString("hex");
}

export function defaultCwmpUrl(publicBase: string, port?: number | null) {
  const raw = (publicBase || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return buildAcsUrl(u.hostname, port ?? null);
  } catch {
    return "";
  }
}

function clampInform(n: unknown) {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v)) return 300;
  return Math.min(86400, Math.max(30, v));
}

type Row = {
  tenant_id: string;
  enabled: boolean;
  cwmp_url: string;
  public_host: string;
  cwmp_port: number | null;
  username: string;
  password_ref: string;
  connreq_user: string;
  connreq_pass_ref: string;
  inform_interval: number;
  generated_at: string | null;
  password_rotated_at: string | null;
  last_verified_at: string | null;
  last_verify_ok: boolean | null;
  last_verify_error: string;
  created_at: string | null;
  updated_at: string | null;
};

function asPublic(
  row: Row | undefined,
  extras: { dnsHost?: string; resolvedHost?: string; secrets?: boolean },
): AcsIspCredentials | null {
  if (!row) return null;
  const host = row.public_host || extras.resolvedHost || "";
  const url = buildAcsUrl(host, row.cwmp_port) || row.cwmp_url || "";
  const alt = extras.dnsHost && row.cwmp_port ? buildAcsUrl(extras.dnsHost, row.cwmp_port) : "";
  const password = extras.secrets ? open(row.password_ref || "") : "";
  const connreq = extras.secrets ? open(row.connreq_pass_ref || "") : "";
  return {
    tenant_id: row.tenant_id,
    enabled: row.enabled !== false,
    public_host: host,
    dns_host: extras.dnsHost || "",
    cwmp_port: row.cwmp_port,
    cwmp_url: url,
    alt_url: alt && alt !== url ? alt : "",
    username: row.username || "",
    password,
    password_hint: hint(row.password_ref || ""),
    connreq_user: row.connreq_user || "",
    connreq_password: connreq,
    connreq_password_hint: hint(row.connreq_pass_ref || ""),
    inform_interval: clampInform(row.inform_interval),
    generated_at: row.generated_at,
    password_rotated_at: row.password_rotated_at,
    last_verified_at: row.last_verified_at,
    last_verify_ok: row.last_verify_ok,
    last_verify_error: row.last_verify_error || "",
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readRow(sql: Sql, tenantId: string) {
  const [row] = await sql<Row>`
    select tenant_id, enabled, cwmp_url, public_host, cwmp_port, username, password_ref, connreq_user, connreq_pass_ref,
           inform_interval, generated_at::text as generated_at, password_rotated_at::text as password_rotated_at,
           last_verified_at::text as last_verified_at, last_verify_ok, last_verify_error,
           created_at::text as created_at, updated_at::text as updated_at
    from acs_isp_credentials where tenant_id = ${tenantId}`;
  return row;
}

async function extrasFor(sql: Sql, row?: Row, publicBase = "") {
  const plat = await loadAcsPlatformSettings(sql);
  const resolved = row?.public_host || (await resolveAcsPublicHost(sql, publicBase));
  return { dnsHost: plat.acs_dns_host, resolvedHost: resolved };
}

export async function loadAcsCredentials(sql: Sql, tenantId: string, opts: { secrets?: boolean; publicBase?: string } = {}) {
  const row = await readRow(sql, tenantId);
  if (!row) return null;
  return asPublic(row, { ...(await extrasFor(sql, row, opts.publicBase)), secrets: Boolean(opts.secrets) });
}

async function writeAudit(sql: Sql, tenantId: string, userId: string, action: string, details: Record<string, unknown> = {}) {
  const payload = JSON.stringify(details);
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, 'acs_credentials', ${tenantId}, ${payload})`;
}

export async function generateAcsCredentials(
  sql: Sql,
  opts: { tenantId: string; slug: string; publicBase?: string; userId?: string; rotate?: boolean },
): Promise<AcsIspCredentials> {
  return withAcsPortLock(sql, opts.tenantId, async () => {
    const existing = await readRow(sql, opts.tenantId);
    if (existing?.username && existing.password_ref && !opts.rotate) {
      if (!existing.cwmp_port) {
        await ensureTenantAcsPort(sql, { tenantId: opts.tenantId, slug: opts.slug, publicBase: opts.publicBase });
      }
      const loaded = await loadAcsCredentials(sql, opts.tenantId, { secrets: true, publicBase: opts.publicBase });
      if (loaded) return loaded;
    }
    await ensureTenantAcsPort(sql, { tenantId: opts.tenantId, slug: opts.slug, publicBase: opts.publicBase });
    const host = await resolveAcsPublicHost(sql, opts.publicBase || "");
    const username = existing?.username || acsUsernameFor(opts.slug);
    const connreqUser =
      existing?.connreq_user && existing.connreq_user !== existing.username
        ? existing.connreq_user
        : acsConnreqUserFor(opts.slug);
    const password = newAcsSecret();
    const connreqPass = newAcsSecret();
    const inform = clampInform(existing?.inform_interval ?? 300);
    const passRef = seal(password);
    const crRef = seal(connreqPass);
    const url = buildAcsUrl(host || existing?.public_host || "", existing?.cwmp_port ?? null);
    await sql`
      insert into acs_isp_credentials
        (tenant_id, enabled, cwmp_url, public_host, username, password_ref, connreq_user, connreq_pass_ref,
         inform_interval, generated_at, password_rotated_at, updated_at)
      values (
        ${opts.tenantId}, true, ${url}, ${host}, ${username}, ${passRef}, ${connreqUser}, ${crRef},
        ${inform}, now(), now(), now()
      )
      on conflict (tenant_id) do update set
        username = case when acs_isp_credentials.username <> '' then acs_isp_credentials.username else excluded.username end,
        connreq_user = case when acs_isp_credentials.connreq_user <> '' and acs_isp_credentials.connreq_user <> acs_isp_credentials.username
          then acs_isp_credentials.connreq_user else excluded.connreq_user end,
        password_ref = excluded.password_ref,
        connreq_pass_ref = excluded.connreq_pass_ref,
        public_host = case when acs_isp_credentials.public_host <> '' then acs_isp_credentials.public_host else excluded.public_host end,
        cwmp_url = case when excluded.cwmp_url <> '' then excluded.cwmp_url else acs_isp_credentials.cwmp_url end,
        generated_at = coalesce(acs_isp_credentials.generated_at, now()),
        password_rotated_at = now(),
        enabled = true,
        updated_at = now()`;
    if (opts.userId) {
      await writeAudit(sql, opts.tenantId, opts.userId, opts.rotate ? "acs.credentials_rotated" : "acs.credentials_generated", {
        username,
        rotate: Boolean(opts.rotate),
      });
    }
    const next = await loadAcsCredentials(sql, opts.tenantId, { secrets: true, publicBase: opts.publicBase });
    if (!next) throw new Error("Could not generate ACS credentials");
    return next;
  });
}

export async function saveAcsCredentialSettings(
  sql: Sql,
  tenantId: string,
  patch: { enabled?: boolean; inform_interval?: number; userId?: string },
) {
  const existing = await loadAcsCredentials(sql, tenantId);
  if (!existing) throw new Error("Generate ACS credentials first.");
  const inform = patch.inform_interval !== undefined ? clampInform(patch.inform_interval) : existing.inform_interval;
  const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled;
  await sql`update acs_isp_credentials
    set inform_interval = ${inform}, enabled = ${enabled}, updated_at = now()
    where tenant_id = ${tenantId}`;
  if (patch.userId) {
    await writeAudit(sql, tenantId, patch.userId, "acs.credentials_updated", { enabled, inform_interval: inform });
  }
  return loadAcsCredentials(sql, tenantId);
}

export async function revealAcsSecrets(sql: Sql, tenantId: string, userId: string) {
  const row = await loadAcsCredentials(sql, tenantId, { secrets: true });
  if (!row?.password) throw new Error("Generate ACS credentials first.");
  await writeAudit(sql, tenantId, userId, "acs.credentials_revealed", { username: row.username });
  return row;
}

export async function recordAcsVerify(
  sql: Sql,
  tenantId: string,
  result: { ok: boolean; error?: string },
  userId?: string,
) {
  const err = result.ok ? "" : (result.error || "GenieACS NBI is not reachable").slice(0, 240);
  await sql`update acs_isp_credentials
    set last_verified_at = now(), last_verify_ok = ${result.ok}, last_verify_error = ${err}, updated_at = now()
    where tenant_id = ${tenantId}`;
  if (userId) {
    await writeAudit(sql, tenantId, userId, "acs.connection_tested", { ok: result.ok, error: err });
  }
  return loadAcsCredentials(sql, tenantId);
}

export async function assignTenantAcsPort(
  sql: Sql,
  opts: { tenantId: string; port?: number; confirmChange?: boolean; actorUserId: string; publicBase?: string },
) {
  return withAcsPortLock(sql, opts.tenantId, async () => {
    const before = await readRow(sql, opts.tenantId);
    const port = await allocateAcsPort(sql, opts.tenantId, {
      preferred: opts.port,
      confirmChange: opts.confirmChange,
      actorUserId: opts.actorUserId,
    });
    const host = (before?.public_host || (await resolveAcsPublicHost(sql, opts.publicBase || ""))).trim();
    const url = buildAcsUrl(host, port);
    await sql`update acs_isp_credentials
      set cwmp_url = ${url}, public_host = case when public_host = '' then ${host} else public_host end, updated_at = now()
      where tenant_id = ${opts.tenantId}`;
    await writeAudit(sql, opts.tenantId, opts.actorUserId, "acs.port_assigned", {
      port,
      previous: before?.cwmp_port ?? null,
    });
    return loadAcsCredentials(sql, opts.tenantId, { publicBase: opts.publicBase });
  });
}

export function completeAcsConfigText(
  creds: Pick<AcsIspCredentials, "cwmp_url" | "username" | "password" | "connreq_user" | "connreq_password" | "inform_interval" | "cwmp_port" | "public_host">,
) {
  return [
    `ACS URL: ${creds.cwmp_url || ""}`,
    `Username: ${creds.username || ""}`,
    `Password: ${creds.password || ""}`,
    `Connection-request username: ${creds.connreq_user || ""}`,
    `Connection-request password: ${creds.connreq_password || ""}`,
    `Periodic inform: ${clampInform(creds.inform_interval)} seconds`,
    creds.public_host ? `VPS host: ${creds.public_host}` : "",
    creds.cwmp_port ? `TR-069 port: ${creds.cwmp_port}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function oltSnippets(
  creds: Pick<
    AcsIspCredentials,
    "cwmp_url" | "username" | "password" | "connreq_user" | "connreq_password" | "inform_interval"
  >,
) {
  const url = creds.cwmp_url || "http://ACS_HOST:PORT/";
  const user = creds.username || "tenant_isp";
  const pass = creds.password || "********";
  const crUser = creds.connreq_user || "";
  const crPass = creds.connreq_password || "********";
  const interval = clampInform(creds.inform_interval);
  const huawei = `# Huawei MA5800 / MA5608T — TR-069 profile, then bind to the ONT
ont wan-tr069-profile add profile-id 10 profile-name "${user}"
ont wan-tr069-profile modify 10
 acs-url ${url}
 acs-username ${user}
 acs-password ${pass}
 connection-request-username ${crUser}
 connection-request-password ${crPass}
 periodic-inform enable
 periodic-inform-interval ${interval}
#
# ont wan-tr069-profile 1 1 profile-id 10
`;
  const zte = `# ZTE C300 / C600 — GPON ONT TR-069 management
pon
 ont-srvprofile gpon profile-id 10 profile-name ${user}
  tr069-mgmt 1
   acs-url ${url}
   username ${user}
   password ${pass}
   connection-request-username ${crUser}
   connection-request-password ${crPass}
   periodic-inform interval ${interval}
  !
 !
!
`;
  const fiberhome = `# Fiberhome AN5516 / AN6000 — WAN TR-069
cd wan
set tr069 1
set tr069 acs-url ${url}
set tr069 username ${user}
set tr069 password ${pass}
set tr069 inform-interval ${interval}
apply
`;
  const params = `InternetGatewayDevice.ManagementServer.URL=${url}
InternetGatewayDevice.ManagementServer.Username=${user}
InternetGatewayDevice.ManagementServer.Password=${pass}
InternetGatewayDevice.ManagementServer.PeriodicInformEnable=true
InternetGatewayDevice.ManagementServer.PeriodicInformInterval=${interval}
InternetGatewayDevice.ManagementServer.ConnectionRequestUsername=${crUser}
InternetGatewayDevice.ManagementServer.ConnectionRequestPassword=${crPass}
Device.ManagementServer.URL=${url}
Device.ManagementServer.Username=${user}
Device.ManagementServer.Password=${pass}`;
  return { huawei, zte, fiberhome, params };
}

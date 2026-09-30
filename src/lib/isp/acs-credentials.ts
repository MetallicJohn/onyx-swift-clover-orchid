import { randomBytes } from "node:crypto";
import { nid } from "../utils.ts";
import {
  allocateAcsPort,
  buildAcsUrl,
  ACS_CREDENTIAL_LENGTH_DEFAULT,
  ACS_CREDENTIAL_LENGTH_MAX,
  clampAcsCredentialLength,
  ensureTenantAcsPort,
  loadAcsPlatformSettings,
  resolveAcsCredentialLength,
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
  credential_length: number;
  credentials_fit: boolean;
  created_at: string | null;
  updated_at: string | null;
};

const ACS_ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789";

export function acsNameToken(source: string) {
  return (source || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function randomAcsChars(n: number) {
  if (n <= 0) return "";
  const buf = randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i += 1) out += ACS_ALPHABET[buf[i]! % ACS_ALPHABET.length]!;
  return out;
}

/** Whole ISP name when it fits, otherwise the leading part. A tail is only added to avoid a collision. */
export function acsUsernameFor(slug: string, length = ACS_CREDENTIAL_LENGTH_DEFAULT, tail = "") {
  const len = clampAcsCredentialLength(length);
  const name = acsNameToken(slug) || "isp";
  const salt = acsNameToken(tail);
  if (!salt) return name.slice(0, len);
  const tailLen = Math.min(Math.max(salt.length, 2), len - 1);
  const useTail = salt.slice(0, tailLen);
  return `${name.slice(0, len - useTail.length)}${useTail}`.slice(0, len);
}

/** Connection-request username stays alphanumeric, within the same length, and different from the ACS username. */
export function acsConnreqUserFor(slug: string, length = ACS_CREDENTIAL_LENGTH_DEFAULT, acsUser = "", tail = "") {
  const len = clampAcsCredentialLength(length);
  const name = acsNameToken(slug) || "isp";
  const salt = acsNameToken(tail);
  const acs = acsNameToken(acsUser);
  if (!salt) {
    let id = `c${name}`.slice(0, len);
    if (id === acs) id = `${name}c`.slice(0, len);
    if (id === acs) id = `c${name.slice(0, Math.max(0, len - 2))}x`.slice(0, len);
    return id;
  }
  const tailLen = Math.min(salt.length, Math.max(1, len - 2));
  const useTail = salt.slice(0, tailLen);
  const head = name.slice(0, Math.max(0, len - 1 - useTail.length));
  let id = `c${head}${useTail}`.slice(0, len);
  if (id === acs) id = `x${id.slice(1)}`.slice(0, len);
  return id;
}

/** Random ACS secret of the configured length. A short ISP mark is included when at least 6 random characters remain. */
export function newAcsSecret(length = ACS_CREDENTIAL_LENGTH_DEFAULT, isp = "") {
  const len = clampAcsCredentialLength(length);
  const name = acsNameToken(isp);
  const markLen = name && len >= 10 ? Math.min(4, name.length, len - 6) : 0;
  return `${name.slice(0, markLen)}${randomAcsChars(len - markLen)}`.slice(0, len);
}

export function defaultCwmpUrl(publicBase: string, port?: number | null, scheme: "http" | "https" = "http") {
  const raw = (publicBase || "").trim();
  if (!raw) return "";
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return buildAcsUrl(u.hostname, port ?? null, scheme);
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
  credential_length: number | null;
  created_at: string | null;
  updated_at: string | null;
};

function asPublic(
  row: Row | undefined,
  extras: { dnsHost?: string; resolvedHost?: string; secrets?: boolean; scheme?: "http" | "https"; credentialLength?: number },
): AcsIspCredentials | null {
  if (!row) return null;
  const host = row.public_host || extras.resolvedHost || "";
  const scheme = extras.scheme || "http";
  const url = buildAcsUrl(host, row.cwmp_port, scheme) || row.cwmp_url || "";
  const alt = extras.dnsHost && row.cwmp_port ? buildAcsUrl(extras.dnsHost, row.cwmp_port, scheme) : "";
  const password = extras.secrets ? open(row.password_ref || "") : "";
  const connreq = extras.secrets ? open(row.connreq_pass_ref || "") : "";
  const length = resolveAcsCredentialLength(row.credential_length, extras.credentialLength ?? ACS_CREDENTIAL_LENGTH_DEFAULT);
  const actualPassword = open(row.password_ref || "");
  const usernameOk = nameFits(row.username || "", length);
  const connreqOk = nameFits(row.connreq_user || "", length);
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
    credential_length: length,
    credentials_fit:
      actualPassword.length === length &&
      actualPassword.length <= ACS_CREDENTIAL_LENGTH_MAX &&
      usernameOk &&
      connreqOk &&
      (row.username || "") !== (row.connreq_user || ""),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function readRow(sql: Sql, tenantId: string) {
  const [row] = await sql<Row>`
    select tenant_id, enabled, cwmp_url, public_host, cwmp_port, username, password_ref, connreq_user, connreq_pass_ref,
           inform_interval, generated_at::text as generated_at, password_rotated_at::text as password_rotated_at,
           last_verified_at::text as last_verified_at, last_verify_ok, last_verify_error, credential_length,
           created_at::text as created_at, updated_at::text as updated_at
    from acs_isp_credentials where tenant_id = ${tenantId}`;
  return row;
}

async function extrasFor(sql: Sql, row?: Row, publicBase = "") {
  const plat = await loadAcsPlatformSettings(sql);
  const resolved = row?.public_host || (await resolveAcsPublicHost(sql, publicBase));
  return { dnsHost: plat.acs_dns_host, resolvedHost: resolved, scheme: plat.acs_tls, credentialLength: plat.acs_credential_length };
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

function nameFits(value: string, length: number) {
  return Boolean(value) && value.length <= length && value.length <= ACS_CREDENTIAL_LENGTH_MAX && /^[a-z0-9]+$/.test(value);
}

async function takenAcsNames(sql: Sql, tenantId: string) {
  const rows = await sql<{ username: string; connreq_user: string }>`
    select username, connreq_user from acs_isp_credentials where tenant_id <> ${tenantId}`;
  const taken = new Set<string>();
  for (const row of rows) {
    if (row.username) taken.add(row.username.toLowerCase());
    if (row.connreq_user) taken.add(row.connreq_user.toLowerCase());
  }
  return taken;
}

async function allocateAcsNames(
  sql: Sql,
  tenantId: string,
  slug: string,
  length: number,
  existing?: Row,
) {
  const currentUser = existing?.username || "";
  const currentCr = existing?.connreq_user || "";
  if (nameFits(currentUser, length) && nameFits(currentCr, length) && currentUser !== currentCr) {
    return { username: currentUser, connreq: currentCr };
  }
  const taken = await takenAcsNames(sql, tenantId);
  for (let i = 0; i < 20; i += 1) {
    const tail = i === 0 ? "" : randomAcsChars(3);
    const username = acsUsernameFor(slug, length, tail);
    const crTail = i === 0 ? "" : randomAcsChars(2);
    let connreq = acsConnreqUserFor(slug, length, username, crTail);
    if (connreq === username) connreq = acsConnreqUserFor(slug, length, username, randomAcsChars(3));
    if (!username || !connreq || username === connreq) continue;
    if (taken.has(username) || taken.has(connreq)) continue;
    return { username, connreq };
  }
  throw new Error("Could not allocate a unique ACS username");
}

async function allocateAcsSecrets(sql: Sql, tenantId: string, slug: string, length: number) {
  const rows = await sql<{ password_ref: string; connreq_pass_ref: string }>`
    select password_ref, connreq_pass_ref from acs_isp_credentials where tenant_id <> ${tenantId}`;
  const used = new Set<string>();
  for (const row of rows) {
    const password = open(row.password_ref || "");
    const connreq = open(row.connreq_pass_ref || "");
    if (password) used.add(password);
    if (connreq) used.add(connreq);
  }
  for (let i = 0; i < 8; i += 1) {
    const password = newAcsSecret(length, slug);
    const connreq = newAcsSecret(length, slug);
    if (password === connreq || password.length !== length || connreq.length !== length) continue;
    if (used.has(password) || used.has(connreq)) continue;
    return { password, connreq };
  }
  throw new Error("Could not allocate a unique ACS password");
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
    const plat = await loadAcsPlatformSettings(sql);
    const length = resolveAcsCredentialLength(existing?.credential_length, plat.acs_credential_length);
    const names = await allocateAcsNames(sql, opts.tenantId, opts.slug, length, existing);
    const secrets = await allocateAcsSecrets(sql, opts.tenantId, opts.slug, length);
    const username = names.username;
    const connreqUser = names.connreq;
    const password = secrets.password;
    const connreqPass = secrets.connreq;
    const inform = clampInform(existing?.inform_interval ?? 300);
    const passRef = seal(password);
    const crRef = seal(connreqPass);
    const url = buildAcsUrl(host || existing?.public_host || "", existing?.cwmp_port ?? null, plat.acs_tls);
    await sql`
      insert into acs_isp_credentials
        (tenant_id, enabled, cwmp_url, public_host, username, password_ref, connreq_user, connreq_pass_ref,
         inform_interval, credential_length, generated_at, password_rotated_at, updated_at)
      values (
        ${opts.tenantId}, true, ${url}, ${host}, ${username}, ${passRef}, ${connreqUser}, ${crRef},
        ${inform}, ${length}, now(), now(), now()
      )
      on conflict (tenant_id) do update set
        username = excluded.username,
        connreq_user = excluded.connreq_user,
        password_ref = excluded.password_ref,
        connreq_pass_ref = excluded.connreq_pass_ref,
        credential_length = excluded.credential_length,
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
  patch: { enabled?: boolean; inform_interval?: number; credential_length?: number; userId?: string },
) {
  const existing = await loadAcsCredentials(sql, tenantId);
  if (!existing) throw new Error("Generate ACS credentials first.");
  const inform = patch.inform_interval !== undefined ? clampInform(patch.inform_interval) : existing.inform_interval;
  const enabled = patch.enabled !== undefined ? Boolean(patch.enabled) : existing.enabled;
  let length = existing.credential_length;
  if (patch.credential_length !== undefined) {
    const requested = Math.floor(Number(patch.credential_length));
    if (clampAcsCredentialLength(patch.credential_length) !== requested) {
      throw new Error(`ACS credential length must be between 8 and ${ACS_CREDENTIAL_LENGTH_MAX} characters`);
    }
    length = requested;
    await sql`update acs_isp_credentials
      set inform_interval = ${inform}, enabled = ${enabled}, credential_length = ${length}, updated_at = now()
      where tenant_id = ${tenantId}`;
  } else {
    await sql`update acs_isp_credentials
      set inform_interval = ${inform}, enabled = ${enabled}, updated_at = now()
      where tenant_id = ${tenantId}`;
  }
  if (patch.userId) {
    await writeAudit(sql, tenantId, patch.userId, "acs.credentials_updated", {
      enabled,
      inform_interval: inform,
      credential_length: length,
    });
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
    const plat = await loadAcsPlatformSettings(sql);
    const url = buildAcsUrl(host, port, plat.acs_tls);
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
  const tenda = `# Tenda OLT — TR-069 profile. Username and password are at most 24 characters.
ACS URL: ${url}
ACS username: ${user}
ACS password: ${pass}
Connection-request username: ${crUser}
Connection-request password: ${crPass}
Inform interval: ${interval}
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
  return { huawei, zte, fiberhome, tenda, params };
}

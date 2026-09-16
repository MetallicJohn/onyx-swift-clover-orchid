import { createHash, randomBytes } from "node:crypto";
import { APP_NAME, ROS_BOOTSTRAP_FILE } from "../brand.ts";
import { nid } from "../utils.ts";
import { agentPullUrl, enqueueAgentCommand } from "./agent.ts";
import { parseV4Cidr } from "./ipam.ts";
import { routerReachability, validateRosScript } from "./mikrotik-ops.ts";
import { applyRls } from "./rls.ts";
import { enrollRosScript, poolPushRosScript, rosQuote, type RosPool } from "./routeros.ts";
import { ensureTenantHub, syncRouterWgPeer, wgEnrollContext } from "./wireguard.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const PROVISION_TOKEN_PREFIX = "prv_";
export const DEFAULT_TOKEN_TTL_HOURS = 72;
const MAX_TOKEN_TTL_HOURS = 720;
const MIN_TOKEN_TTL_HOURS = 1;

export type TenantProvisioningSettings = {
  tenant_id: string;
  enabled: boolean;
  token_ttl_hours: number;
  require_https: boolean;
  allow_pool_push: boolean;
};

export type RouterRecord = {
  id: string;
  tenant_id: string;
  name: string;
  identity: string;
  location: string;
  role: string;
  model: string;
  ros_version: string;
  site_pop: string;
  management_ip: string;
  wg_status: string;
  last_seen: string | null;
  cpu_pct: number;
  uptime_hours: number;
  enroll_token: string;
  wg_public: string;
  wg_address: string;
  wg_private_ref: string;
  agent_version: string;
  provisioning_status: string;
  provision_token_hash: string;
  provision_token_hint: string;
  provision_token_expires_at: string | null;
  provision_token_revoked_at: string | null;
  provisioned_at: string | null;
  config_version: number;
};

export type PublicRouter = {
  id: string;
  tenant_id: string;
  name: string;
  identity: string;
  location: string;
  role: string;
  model: string;
  ros_version: string;
  site_pop: string;
  management_ip: string;
  wg_status: string;
  wg_public: string;
  wg_address: string;
  last_seen: string | null;
  cpu_pct: number;
  uptime_hours: number;
  agent_version: string;
  provisioning_status: string;
  provision_token_hint: string;
  provision_token_expires_at: string | null;
  provisioned_at: string | null;
  config_version: number;
  reachability: string;
  online: boolean;
  pool_count: number;
};

export type ProvisionEvent = {
  id: string;
  event: string;
  actor_user_id: string;
  detail: string;
  created_at: string;
};

export type ConfigVersionRow = {
  id: string;
  version: number;
  kind: string;
  checksum: string;
  generated_by: string;
  created_at: string;
  script?: string;
};

export function generateProvisionToken() {
  return `${PROVISION_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashProvisionToken(token: string) {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

export function provisionTokenHint(token: string) {
  const t = token.trim();
  if (t.length < 4) return "••••";
  return t.slice(-4);
}

export function ipPoolRanges(cidr: string) {
  const { parts, prefix } = parseV4Cidr(cidr);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  const base = ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
  const network = (base & (0xffffffff << hostBits)) >>> 0;
  const skip = size > 16 ? 10 : size > 2 ? 1 : 0;
  const start = network + skip;
  const end = network + size - (size > 2 ? 2 : 1);
  const toIp = (n: number) =>
    [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
  if (start > end) return `${toIp(network + 1)}-${toIp(network + 1)}`;
  return `${toIp(start)}-${toIp(end)}`;
}

export function httpsPublicBase(base: string, requireHttps = true) {
  let root = (base || "").trim().replace(/\/$/, "");
  if (!root) return "";
  if (requireHttps && root.startsWith("http://")) root = `https://${root.slice(7)}`;
  if (requireHttps && !/^https:\/\//i.test(root) && !/^http:\/\//i.test(root)) {
    root = `https://${root}`;
  }
  return root;
}

export function bootstrapFetchUrl(base: string, token: string, requireHttps = true) {
  const root = httpsPublicBase(base, requireHttps) || "https://YOUR-PUBLIC-URL";
  return `${root}/api/vpn/routers/${encodeURIComponent(token)}/bootstrap.rsc`;
}

export function bootstrapPasteScript(opts: { url: string; identity?: string }) {
  const url = opts.url;
  return `# ${APP_NAME} bootstrap — RouterOS v7
# Paste in New Terminal. Certificate validation is required.
# 1. Confirm internet
# 2. Download this router's configuration over HTTPS
# 3. Import ${ROS_BOOTSTRAP_FILE}
${opts.identity ? `# identity: ${opts.identity}` : ""}

:log info ${rosQuote(`${APP_NAME} bootstrap starting`)};
:local pings 0;
:do { :set pings [/ping 1.1.1.1 count=3] } on-error={ :set pings 0 };
:if ($pings = 0) do={
  :do { :set pings [/ping 8.8.8.8 count=3] } on-error={ :set pings 0 };
};
:if ($pings = 0) do={
  :log error ${rosQuote(`${APP_NAME}: no internet — bootstrap aborted`)};
} else={
  :do {
    /tool fetch url=${rosQuote(url)} mode=https check-certificate=yes http-method=get dst-path=${rosQuote(ROS_BOOTSTRAP_FILE)};
    :delay 2s;
    :if ([:len [/file find where name=${rosQuote(ROS_BOOTSTRAP_FILE)}]] > 0) do={
      /import file-name=${rosQuote(ROS_BOOTSTRAP_FILE)};
      :log info ${rosQuote(`${APP_NAME} bootstrap imported`)};
    } else={
      :log error ${rosQuote(`${APP_NAME}: bootstrap file missing after fetch`)};
    }
  } on-error={
    :log error ${rosQuote(`${APP_NAME}: HTTPS fetch failed — check certificate and URL`)};
  }
}
`;
}

export function assertReleaseableScript(script: string) {
  const issues = validateRosScript(script);
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length) {
    throw new Error(`RouterOS configuration rejected: ${errors.map((e) => e.message).join("; ")}`);
  }
  if (/check-certificate\s*=\s*no/i.test(script)) {
    throw new Error("Generated script must not disable certificate validation");
  }
  return issues;
}

export function publicOnlineStatus(lastSeen: string | null, wgStatus: string, now = Date.now()) {
  const reachability = routerReachability(lastSeen, now, wgStatus);
  return { reachability, online: reachability === "connected" };
}

export function toPublicRouter(row: RouterRecord, now = Date.now()): PublicRouter {
  const { reachability, online } = publicOnlineStatus(row.last_seen, row.wg_status, now);
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    identity: row.identity,
    location: row.location,
    role: row.role,
    model: row.model,
    ros_version: row.ros_version,
    site_pop: row.site_pop || row.location,
    management_ip: row.management_ip,
    wg_status: row.wg_status,
    wg_public: row.wg_public,
    wg_address: row.wg_address,
    last_seen: row.last_seen,
    cpu_pct: row.cpu_pct,
    uptime_hours: row.uptime_hours,
    agent_version: row.agent_version,
    provisioning_status: row.provisioning_status,
    provision_token_hint: row.provision_token_hint,
    provision_token_expires_at: row.provision_token_expires_at,
    provisioned_at: row.provisioned_at,
    config_version: row.config_version,
    reachability,
    online,
    pool_count: Number((row as RouterRecord & { pool_count?: number }).pool_count || 0),
  };
}

function clampTtl(hours: number) {
  const n = Math.round(Number(hours) || DEFAULT_TOKEN_TTL_HOURS);
  return Math.min(MAX_TOKEN_TTL_HOURS, Math.max(MIN_TOKEN_TTL_HOURS, n));
}

export async function ensureTenantProvisioning(
  sql: Sql,
  tenantId: string,
): Promise<TenantProvisioningSettings> {
  const [row] = await sql<TenantProvisioningSettings>`
    select tenant_id, enabled, token_ttl_hours, require_https, allow_pool_push
    from tenant_router_provisioning where tenant_id = ${tenantId}`;
  if (row) {
    return {
      ...row,
      token_ttl_hours: clampTtl(row.token_ttl_hours),
    };
  }
  await sql`insert into tenant_router_provisioning (tenant_id)
    values (${tenantId})
    on conflict (tenant_id) do nothing`;
  const [created] = await sql<TenantProvisioningSettings>`
    select tenant_id, enabled, token_ttl_hours, require_https, allow_pool_push
    from tenant_router_provisioning where tenant_id = ${tenantId}`;
  return (
    created ?? {
      tenant_id: tenantId,
      enabled: true,
      token_ttl_hours: DEFAULT_TOKEN_TTL_HOURS,
      require_https: true,
      allow_pool_push: true,
    }
  );
}

export async function saveTenantProvisioning(
  sql: Sql,
  tenantId: string,
  patch: Partial<Omit<TenantProvisioningSettings, "tenant_id">>,
) {
  await ensureTenantProvisioning(sql, tenantId);
  const ttl =
    patch.token_ttl_hours != null ? clampTtl(patch.token_ttl_hours) : null;
  await sql`update tenant_router_provisioning set
    enabled = coalesce(${patch.enabled ?? null}, enabled),
    token_ttl_hours = coalesce(${ttl}, token_ttl_hours),
    require_https = coalesce(${patch.require_https ?? null}, require_https),
    allow_pool_push = coalesce(${patch.allow_pool_push ?? null}, allow_pool_push),
    updated_at = now()
    where tenant_id = ${tenantId}`;
  return ensureTenantProvisioning(sql, tenantId);
}

export async function loadRouter(sql: Sql, tenantId: string, id: string) {
  const [row] = await sql<RouterRecord>`
    select id, tenant_id, name, identity, location, role,
      coalesce(model,'') as model, coalesce(ros_version,'') as ros_version,
      coalesce(site_pop,'') as site_pop, coalesce(management_ip,'') as management_ip,
      wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours,
      enroll_token, wg_public, wg_address, wg_private_ref, coalesce(agent_version,'') as agent_version,
      coalesce(provisioning_status,'pending') as provisioning_status,
      coalesce(provision_token_hash,'') as provision_token_hash,
      coalesce(provision_token_hint,'') as provision_token_hint,
      provision_token_expires_at::text as provision_token_expires_at,
      provision_token_revoked_at::text as provision_token_revoked_at,
      provisioned_at::text as provisioned_at,
      coalesce(config_version,0)::int as config_version
    from routers where id = ${id} and tenant_id = ${tenantId}`;
  if (!row) throw new Error("Router not found");
  return row;
}

export { loadRouter as getRouter };

export async function listTenantRouters(sql: Sql, tenantId: string) {
  const rows = await sql<RouterRecord>`
    select id, tenant_id, name, identity, location, role,
      coalesce(model,'') as model, coalesce(ros_version,'') as ros_version,
      coalesce(site_pop,'') as site_pop, coalesce(management_ip,'') as management_ip,
      wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours,
      enroll_token, wg_public, wg_address, wg_private_ref, coalesce(agent_version,'') as agent_version,
      coalesce(provisioning_status,'pending') as provisioning_status,
      coalesce(provision_token_hash,'') as provision_token_hash,
      coalesce(provision_token_hint,'') as provision_token_hint,
      provision_token_expires_at::text as provision_token_expires_at,
      provision_token_revoked_at::text as provision_token_revoked_at,
      provisioned_at::text as provisioned_at,
      coalesce(config_version,0)::int as config_version
    from routers where tenant_id = ${tenantId} order by name`;
  const counts = await sql<{ router_id: string; n: number }>`
    select router_id, count(*)::int as n
    from router_pool_assignments
    where tenant_id = ${tenantId}
    group by router_id`;
  const byRouter = new Map(counts.map((c) => [c.router_id, Number(c.n)]));
  return rows.map((r) => {
    const pub = toPublicRouter(r);
    return { ...pub, pool_count: byRouter.get(r.id) || 0 };
  });
}

export async function recordProvisionEvent(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    event: string;
    actorUserId?: string;
    detail?: string | Record<string, unknown>;
  },
) {
  const detail =
    typeof opts.detail === "string" ? opts.detail : JSON.stringify(opts.detail || {});
  await sql`insert into router_provision_events (id, tenant_id, router_id, event, actor_user_id, detail)
    values (${nid("rpe")}, ${opts.tenantId}, ${opts.routerId}, ${opts.event}, ${opts.actorUserId || ""}, ${detail.slice(0, 4000)})`;
}

async function assignedPools(sql: Sql, tenantId: string, routerId: string): Promise<RosPool[]> {
  const rows = await sql<{ name: string; cidr: string }>`
    select p.name, p.cidr
    from router_pool_assignments a
    join ip_pools p on p.id = a.pool_id
    where a.tenant_id = ${tenantId} and a.router_id = ${routerId}
    order by p.name`;
  return rows.map((p) => ({ name: p.name, ranges: ipPoolRanges(p.cidr) }));
}

export async function listAssignedPools(sql: Sql, tenantId: string, routerId: string) {
  return sql<{ id: string; name: string; cidr: string }>`
    select p.id, p.name, p.cidr
    from router_pool_assignments a
    join ip_pools p on p.id = a.pool_id
    where a.tenant_id = ${tenantId} and a.router_id = ${routerId}
    order by p.name`;
}

export async function listAvailablePools(sql: Sql, tenantId: string) {
  return sql<{ id: string; name: string; cidr: string }>`
    select id, name, cidr from ip_pools where tenant_id = ${tenantId} order by name`;
}

export async function createIpPool(
  sql: Sql,
  opts: { tenantId: string; name: string; cidr: string; actorUserId?: string },
) {
  const name = opts.name.trim();
  const cidr = opts.cidr.trim();
  if (!name) throw new Error("Pool name is required");
  parseV4Cidr(cidr);
  const [dupName] = await sql<{ id: string }>`
    select id from ip_pools where tenant_id = ${opts.tenantId} and lower(name) = ${name.toLowerCase()}`;
  if (dupName) throw new Error("A pool with that name already exists");
  const [dupCidr] = await sql<{ id: string }>`
    select id from ip_pools where tenant_id = ${opts.tenantId} and cidr = ${cidr}`;
  if (dupCidr) throw new Error("A pool with that CIDR already exists");
  const id = nid("pool");
  await sql`insert into ip_pools (id, tenant_id, name, cidr, next_host)
    values (${id}, ${opts.tenantId}, ${name}, ${cidr}, 10)`;
  return { id, name, cidr, ranges: ipPoolRanges(cidr) };
}

export async function deleteIpPool(sql: Sql, opts: { tenantId: string; poolId: string }) {
  const [row] = await sql<{ id: string }>`
    select id from ip_pools where id = ${opts.poolId} and tenant_id = ${opts.tenantId}`;
  if (!row) throw new Error("IP pool not found");
  await sql`delete from ip_pools where id = ${row.id} and tenant_id = ${opts.tenantId}`;
  return { ok: true, id: row.id };
}

async function publicBaseUrl(sql: Sql, tenantId: string) {
  const [t] = await sql<{ public_base_url: string }>`
    select public_base_url from tenants where id = ${tenantId}`;
  return t?.public_base_url || "";
}

export async function generateRouterConfig(
  sql: Sql,
  tenantId: string,
  router: RouterRecord,
  kind: "enroll" | "bootstrap" | "pools" | "reconfigure",
  generatedBy = "",
) {
  const settings = await ensureTenantProvisioning(sql, tenantId);
  const base = await publicBaseUrl(sql, tenantId);
  const ctx = await wgEnrollContext(sql, tenantId, {
    id: router.id,
    name: router.name,
    identity: router.identity,
    token: router.enroll_token,
    wg_public: router.wg_public,
    wg_private_ref: router.wg_private_ref,
    wg_address: router.wg_address || "10.200.0.2/32",
    pullUrl: agentPullUrl(httpsPublicBase(base, settings.require_https), router.enroll_token),
  });
  const enroll = enrollRosScript(ctx);
  const pools = await assignedPools(sql, tenantId, router.id);
  const poolBlock = settings.allow_pool_push ? poolPushRosScript(pools) : "";
  const script = `# ${APP_NAME} ${kind} configuration — RouterOS v7
# Generated from validated templates. Do not paste arbitrary commands.
# router ${router.identity || router.name} · overlay ${router.wg_address}

${enroll}

${poolBlock}
`.trim() + "\n";
  assertReleaseableScript(script);
  const checksum = createHash("sha256").update(script).digest("hex");
  const version = (router.config_version || 0) + 1;
  await sql`insert into router_config_versions
    (id, tenant_id, router_id, version, kind, script, checksum, generated_by)
    values (${nid("rcv")}, ${tenantId}, ${router.id}, ${version}, ${kind}, ${script}, ${checksum}, ${generatedBy})`;
  await sql`update routers set config_version = ${version} where id = ${router.id} and tenant_id = ${tenantId}`;
  return { script, version, checksum, kind };
}

export async function issueProvisioningToken(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  const settings = await ensureTenantProvisioning(sql, opts.tenantId);
  if (!settings.enabled) throw new Error("Router provisioning is disabled for this ISP");
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  let token = generateProvisionToken();
  let hash = hashProvisionToken(token);
  for (let i = 0; i < 5; i += 1) {
    const [clash] = await sql<{ id: string }>`
      select id from routers where provision_token_hash = ${hash} and id <> ${router.id}`;
    if (!clash) break;
    token = generateProvisionToken();
    hash = hashProvisionToken(token);
  }
  const expires = new Date(Date.now() + settings.token_ttl_hours * 3600_000).toISOString();
  await sql`update routers set
    provision_token_hash = ${hash},
    provision_token_hint = ${provisionTokenHint(token)},
    provision_token_expires_at = ${expires},
    provision_token_revoked_at = null,
    provisioning_status = 'awaiting_bootstrap'
    where id = ${router.id} and tenant_id = ${opts.tenantId}`;
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "token_issued",
    actorUserId: opts.actorUserId,
    detail: { hint: provisionTokenHint(token), expires_at: expires },
  });
  const next = await loadRouter(sql, opts.tenantId, router.id);
  const base = await publicBaseUrl(sql, opts.tenantId);
  const url = bootstrapFetchUrl(base, token, settings.require_https);
  const bootstrap = bootstrapPasteScript({ url, identity: next.identity || next.name });
  assertReleaseableScript(bootstrap);
  await generateRouterConfig(sql, opts.tenantId, next, "bootstrap", opts.actorUserId || "");
  return {
    token,
    hint: provisionTokenHint(token),
    expires_at: expires,
    ttl_hours: settings.token_ttl_hours,
    bootstrap,
    fetch_url: url,
    router: toPublicRouter(await loadRouter(sql, opts.tenantId, router.id)),
  };
}

export async function revokeProvisioningToken(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  await sql`update routers set
    provision_token_hash = '',
    provision_token_revoked_at = now(),
    provisioning_status = case
      when provisioning_status in ('provisioned','bootstrapping') then provisioning_status
      else 'revoked'
    end
    where id = ${router.id} and tenant_id = ${opts.tenantId}`;
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "token_revoked",
    actorUserId: opts.actorUserId,
    detail: { hint: router.provision_token_hint },
  });
  return toPublicRouter(await loadRouter(sql, opts.tenantId, router.id));
}

export async function lookupRouterByProvisionToken(sql: Sql, token: string) {
  const raw = token.trim();
  if (!raw || !raw.startsWith(PROVISION_TOKEN_PREFIX)) return { error: "invalid" as const };
  await applyRls(sql, { bypass: true });
  const hash = hashProvisionToken(raw);
  const [row] = await sql<RouterRecord>`
    select id, tenant_id, name, identity, location, role,
      coalesce(model,'') as model, coalesce(ros_version,'') as ros_version,
      coalesce(site_pop,'') as site_pop, coalesce(management_ip,'') as management_ip,
      wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours,
      enroll_token, wg_public, wg_address, wg_private_ref, coalesce(agent_version,'') as agent_version,
      coalesce(provisioning_status,'pending') as provisioning_status,
      coalesce(provision_token_hash,'') as provision_token_hash,
      coalesce(provision_token_hint,'') as provision_token_hint,
      provision_token_expires_at::text as provision_token_expires_at,
      provision_token_revoked_at::text as provision_token_revoked_at,
      provisioned_at::text as provisioned_at,
      coalesce(config_version,0)::int as config_version
    from routers where provision_token_hash = ${hash}`;
  if (!row) return { error: "invalid" as const };
  await applyRls(sql, { tenantId: row.tenant_id, bypass: false });
  if (row.provision_token_revoked_at) return { error: "revoked" as const, router: row };
  if (row.provision_token_expires_at && Date.parse(row.provision_token_expires_at) < Date.now()) {
    await sql`update routers set provisioning_status = case
      when provisioning_status in ('provisioned','bootstrapping') then provisioning_status
      else 'expired'
    end where id = ${row.id}`;
    return { error: "expired" as const, router: row };
  }
  return { error: null, router: row };
}

export async function serveBootstrapRsc(sql: Sql, token: string) {
  const found = await lookupRouterByProvisionToken(sql, token);
  if (found.error === "invalid") return { status: 404 as const, body: "# unknown token\n" };
  if (found.error === "revoked") return { status: 403 as const, body: "# token revoked\n" };
  if (found.error === "expired") return { status: 410 as const, body: "# token expired\n" };
  const router = found.router!;
  const settings = await ensureTenantProvisioning(sql, router.tenant_id);
  if (!settings.enabled) return { status: 403 as const, body: "# provisioning disabled\n" };
  const generated = await generateRouterConfig(sql, router.tenant_id, router, "bootstrap", "bootstrap.fetch");
  await sql`update routers set
    provisioning_status = 'bootstrapping',
    provisioned_at = coalesce(provisioned_at, now())
    where id = ${router.id}`;
  await recordProvisionEvent(sql, {
    tenantId: router.tenant_id,
    routerId: router.id,
    event: "bootstrap_fetched",
    detail: { version: generated.version, checksum: generated.checksum },
  });
  return { status: 200 as const, body: generated.script, router };
}

export async function routerStatus(sql: Sql, tenantId: string, id: string) {
  const row = await loadRouter(sql, tenantId, id);
  const publicRow = toPublicRouter(row);
  const settings = await ensureTenantProvisioning(sql, tenantId);
  const tokenLive = Boolean(
    row.provision_token_hash &&
      !row.provision_token_revoked_at &&
      row.provision_token_expires_at &&
      Date.parse(row.provision_token_expires_at) > Date.now(),
  );
  return {
    ...publicRow,
    token: {
      hint: row.provision_token_hint || "",
      expires_at: row.provision_token_expires_at,
      revoked: Boolean(row.provision_token_revoked_at),
      live: tokenLive,
    },
    hub: await ensureTenantHub(sql, tenantId).then((h) => ({
      public_key: h.publicKey,
      endpoint_host: h.endpointHost,
      listen_port: h.listenPort,
      address: h.address,
      ready: h.ready,
    })),
    provisioning_enabled: settings.enabled,
    allow_pool_push: settings.allow_pool_push,
  };
}

export async function configurationHistory(
  sql: Sql,
  tenantId: string,
  routerId: string,
  opts?: { includeScript?: boolean; limit?: number },
) {
  await loadRouter(sql, tenantId, routerId);
  const limit = Math.min(50, Math.max(1, opts?.limit ?? 20));
  if (opts?.includeScript) {
    return sql<ConfigVersionRow>`
      select id, version, kind, checksum, generated_by, created_at::text as created_at, script
      from router_config_versions
      where tenant_id = ${tenantId} and router_id = ${routerId}
      order by version desc
      limit ${limit}`;
  }
  return sql<ConfigVersionRow>`
    select id, version, kind, checksum, generated_by, created_at::text as created_at
    from router_config_versions
    where tenant_id = ${tenantId} and router_id = ${routerId}
    order by version desc
    limit ${limit}`;
}

export async function listProvisionEvents(
  sql: Sql,
  tenantId: string,
  routerId: string,
  limit = 40,
) {
  await loadRouter(sql, tenantId, routerId);
  return sql<ProvisionEvent>`
    select id, event, actor_user_id, detail, created_at::text as created_at
    from router_provision_events
    where tenant_id = ${tenantId} and router_id = ${routerId}
    order by created_at desc
    limit ${Math.min(100, Math.max(1, limit))}`;
}

export async function setRouterPools(
  sql: Sql,
  opts: { tenantId: string; routerId: string; poolIds: string[]; actorUserId?: string; push?: boolean },
) {
  const settings = await ensureTenantProvisioning(sql, opts.tenantId);
  if (opts.push && !settings.allow_pool_push) throw new Error("IP pool push is disabled for this ISP");
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  const wanted = [...new Set(opts.poolIds.filter(Boolean))];
  const known = await sql<{ id: string }>`select id from ip_pools where tenant_id = ${opts.tenantId}`;
  const knownIds = new Set(known.map((p) => p.id));
  const valid = wanted.filter((id) => knownIds.has(id));
  if (valid.length !== wanted.length) throw new Error("Unknown IP pool");
  await sql`delete from router_pool_assignments where tenant_id = ${opts.tenantId} and router_id = ${router.id}`;
  for (const poolId of valid) {
    await sql`insert into router_pool_assignments (id, tenant_id, router_id, pool_id)
      values (${nid("rpa")}, ${opts.tenantId}, ${router.id}, ${poolId})`;
  }
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "pools_assigned",
    actorUserId: opts.actorUserId,
    detail: { pool_ids: valid },
  });
  const pools = await assignedPools(sql, opts.tenantId, router.id);
  let commandId: string | null = null;
  if (opts.push) {
    const generated = await generateRouterConfig(
      sql,
      opts.tenantId,
      await loadRouter(sql, opts.tenantId, router.id),
      "pools",
      opts.actorUserId || "",
    );
    commandId = await enqueueAgentCommand(
      sql,
      opts.tenantId,
      "pool.push",
      { pools },
      router.id,
      opts.actorUserId || "",
    );
    await recordProvisionEvent(sql, {
      tenantId: opts.tenantId,
      routerId: router.id,
      event: "pool_push",
      actorUserId: opts.actorUserId,
      detail: { version: generated.version, command_id: commandId },
    });
  }
  return { pools, command_id: commandId };
}

export async function reconfigureRouter(
  sql: Sql,
  opts: { tenantId: string; routerId: string; actorUserId?: string },
) {
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  const generated = await generateRouterConfig(sql, opts.tenantId, router, "reconfigure", opts.actorUserId || "");
  const pools = await assignedPools(sql, opts.tenantId, router.id);
  const commandId = await enqueueAgentCommand(
    sql,
    opts.tenantId,
    "pool.push",
    { pools },
    router.id,
    opts.actorUserId || "",
  );
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "reconfigure",
    actorUserId: opts.actorUserId,
    detail: { version: generated.version, command_id: commandId },
  });
  const issued = await issueProvisioningToken(sql, opts);
  return { ...issued, version: generated.version, command_id: commandId };
}

export async function deleteRouter(sql: Sql, opts: { tenantId: string; routerId: string; actorUserId?: string }) {
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "deleted",
    actorUserId: opts.actorUserId,
    detail: { name: router.name },
  });
  await sql`delete from routers where id = ${router.id} and tenant_id = ${opts.tenantId}`;
  return { ok: true, id: router.id };
}

export async function updateRouterFields(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    actorUserId?: string;
    fields: {
      name?: string;
      identity?: string;
      location?: string;
      role?: string;
      model?: string;
      ros_version?: string;
      site_pop?: string;
      management_ip?: string;
    };
  },
) {
  const router = await loadRouter(sql, opts.tenantId, opts.routerId);
  const name = (opts.fields.name ?? router.name).trim();
  if (!name) throw new Error("Name is required");
  const identity = (opts.fields.identity ?? router.identity).trim() || name.toLowerCase();
  const site = (opts.fields.site_pop ?? opts.fields.location ?? router.site_pop).trim();
  const location = (opts.fields.location ?? site ?? router.location).trim();
  await sql`update routers set
    name = ${name},
    identity = ${identity},
    location = ${location},
    site_pop = ${site},
    role = ${opts.fields.role?.trim() || router.role},
    model = ${opts.fields.model ?? router.model},
    ros_version = ${opts.fields.ros_version ?? router.ros_version},
    management_ip = ${opts.fields.management_ip ?? router.management_ip}
    where id = ${router.id} and tenant_id = ${opts.tenantId}`;
  if (router.wg_public) {
    await syncRouterWgPeer(sql, opts.tenantId, {
      id: router.id,
      wg_public: router.wg_public,
      wg_private_ref: router.wg_private_ref,
      wg_address: router.wg_address,
    });
  }
  await recordProvisionEvent(sql, {
    tenantId: opts.tenantId,
    routerId: router.id,
    event: "updated",
    actorUserId: opts.actorUserId,
    detail: { name },
  });
  return toPublicRouter(await loadRouter(sql, opts.tenantId, router.id));
}

export function configContainsSecrets(payload: unknown) {
  const text = JSON.stringify(payload);
  return /wg_private|private_key|provision_token_hash|enc:v1:/i.test(text);
}

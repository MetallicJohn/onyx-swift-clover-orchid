import { randomBytes, timingSafeEqual } from "node:crypto";
import { nid } from "../utils.ts";
import { recordAccounting } from "./access-policy.ts";
import { applyRls } from "./rls.ts";
import { mikrotikProfileName } from "./pcq.ts";
import {
  attrValue,
  octetsFromAvps,
  parseAcctStatus,
  radiusUsername,
  renderFreeRadiusRestMod,
  renderFreeRadiusSite,
  renderMikrotikRadiusSnippet,
  renderRadiusClientsConf,
  restAttr,
} from "./radius-format.ts";
import { hint, open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type RadiusDecision = {
  ok: boolean;
  result: "accept" | "reject";
  reason: string;
  username: string;
  http: number;
  body: Record<string, unknown>;
};

function safeEq(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function newNasSecret() {
  return randomBytes(16).toString("hex");
}

export async function ensureRadiusNasSecret(sql: Sql, tenantId: string) {
  const [row] = await sql<{ radius_nas_secret: string }>`select radius_nas_secret from tenants where id = ${tenantId}`;
  const existing = open(row?.radius_nas_secret || "");
  if (existing) return existing;
  const secret = newNasSecret();
  await sql`update tenants set radius_nas_secret = ${seal(secret)} where id = ${tenantId}`;
  return secret;
}

export function defaultNasClients(secret: string, routers: Array<{ name: string; ip: string; secret: string }>) {
  const shared = secret || "change-me-on-the-router";
  const base = [
    { name: "wg-overlay", ip: "10.200.0.0/16", secret: shared },
    { name: "rfc1918-10", ip: "10.0.0.0/8", secret: shared },
    { name: "rfc1918-172", ip: "172.16.0.0/12", secret: shared },
  ];
  const extra = routers
    .filter((r) => r.ip)
    .map((r) => ({ name: r.name, ip: r.ip, secret: r.secret || shared }));
  return [...base, ...extra];
}

export function internalRadiusBaseUrl(publicBase = "") {
  const fromEnv = (process.env.GRIDLINE_INTERNAL_URL || "").trim().replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const pub = (publicBase || "").trim().replace(/\/+$/, "");
  return pub || "http://web:3000";
}

export function radiusVpsEnv(opts: { slug: string; apiKey: string; nasSecret: string }) {
  return [
    `GRIDLINE_URL=http://web:3000`,
    `GRIDLINE_SLUG=${opts.slug || "your-isp"}`,
    `RADIUS_API_KEY=${opts.apiKey || "frk_replace_me"}`,
    `RADIUS_NAS_SECRET=${opts.nasSecret || ""}`,
  ].join("\n");
}

export function newRadiusApiKey() {
  return `frk_${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function presentedRadiusKey(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  if (auth.toLowerCase().startsWith("basic ")) {
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    return (idx >= 0 ? decoded.slice(idx + 1) : decoded).trim();
  }
  return (request.headers.get("x-radius-key") || "").trim();
}

export async function ensureRadiusApiKey(sql: Sql, tenantId: string) {
  const [row] = await sql<{ radius_api_key: string }>`
    select radius_api_key from tenants where id = ${tenantId}`;
  if (row?.radius_api_key) {
    return { key: "", hint: hint(row.radius_api_key), created: false };
  }
  const key = newRadiusApiKey();
  await sql`update tenants set radius_api_key = ${seal(key)} where id = ${tenantId}`;
  return { key, hint: hint(seal(key)), created: true };
}

export async function rotateRadiusApiKey(sql: Sql, tenantId: string) {
  const key = newRadiusApiKey();
  await sql`update tenants set radius_api_key = ${seal(key)} where id = ${tenantId}`;
  return { key, hint: hint(seal(key)) };
}

export async function resolveRadiusTenant(sql: Sql, slug: string, presented: string) {
  await applyRls(sql, { bypass: true });
  const [t] = await sql<{ id: string; name: string; slug: string; radius_api_key: string; public_base_url: string }>`
    select id, name, slug, radius_api_key, public_base_url from tenants where slug = ${slug}`;
  if (!t) return { error: 404 as const, message: "unknown tenant" };
  const stored = open(t.radius_api_key);
  if (!stored || !presented || !safeEq(stored, presented)) {
    return { error: 401 as const, message: "unauthorized" };
  }
  await applyRls(sql, { tenantId: t.id, bypass: false });
  return { tenant: t };
}

async function logAuth(
  sql: Sql,
  tenantId: string,
  username: string,
  nasIp: string,
  result: string,
  reason: string,
) {
  try {
    await sql`insert into radius_auth_events (id, tenant_id, username, nas_ip, result, reason)
      values (${nid("rae")}, ${tenantId}, ${username.slice(0, 80)}, ${nasIp.slice(0, 64)}, ${result}, ${reason.slice(0, 80)})`;
  } catch {
    /* log must not fail auth */
  }
}

function rejectBody(message: string): Record<string, unknown> {
  return {
    "control:Auth-Type": restAttr("Reject"),
    "Reply-Message": restAttr(message),
  };
}

function acceptBody(opts: {
  password: string;
  framedIp: string;
  group: string;
  sessionTimeout: number;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    "control:Cleartext-Password": restAttr(opts.password),
    "Mikrotik-Group": restAttr(opts.group || "isp-pkg"),
    "Acct-Interim-Interval": restAttr(300),
  };
  if (opts.framedIp) body["Framed-IP-Address"] = restAttr(opts.framedIp);
  if (opts.sessionTimeout > 0) body["Session-Timeout"] = restAttr(opts.sessionTimeout);
  return body;
}

function accessUntilMs(periodEnd: string | null, graceDays: number, grantExpiresAt: string | null | undefined) {
  const paid = periodEnd ? Date.parse(periodEnd) : NaN;
  const pkg = Number.isFinite(paid) ? paid + Math.max(0, graceDays) * 86400_000 : 0;
  const granted = grantExpiresAt ? Date.parse(grantExpiresAt) : NaN;
  return Math.max(pkg, Number.isFinite(granted) ? granted : 0);
}

function sessionTimeoutSec(
  periodEnd: string | null,
  graceDays: number,
  grantExpiresAt?: string | null,
  now = Date.now(),
) {
  const hard = accessUntilMs(periodEnd, graceDays, grantExpiresAt);
  if (!hard) return 0;
  return Math.max(0, Math.floor((hard - now) / 1000));
}

export async function authorizeRadius(
  sql: Sql,
  tenantId: string,
  input: { username: string; nasIp?: string; password?: string; log?: boolean },
): Promise<RadiusDecision> {
  const username = radiusUsername(input.username);
  const nasIp = (input.nasIp || "").trim();
  const doLog = input.log !== false;
  if (!username) {
    return { ok: false, result: "reject", reason: "missing-username", username: "", http: 200, body: rejectBody("username required") };
  }
  const [row] = await sql<{
    username: string;
    password: string;
    enabled: boolean;
    framed_ip: string;
    group_name: string;
    status: string;
    period_end: string | null;
    bundle_used_mb: number;
    bundle_mb: number;
    grace_days: number;
    grant_expires_at: string | null;
    package_name: string;
  }>`select a.username, a.password, a.enabled, a.framed_ip, a.group_name,
            s.status, s.period_end::text as period_end, s.bundle_used_mb, p.bundle_mb, p.grace_days,
            g.expires_at::text as grant_expires_at, p.name as package_name
     from radius_accounts a
     join services s on s.id = a.service_id
     join packages p on p.id = s.package_id
     left join service_grace_periods g
       on g.service_id = s.id and g.tenant_id = a.tenant_id and g.status = 'active'
     where a.tenant_id = ${tenantId} and a.username = ${username}
     limit 1`;
  if (!row) {
    if (doLog) await logAuth(sql, tenantId, username, nasIp, "reject", "unknown");
    return { ok: false, result: "reject", reason: "unknown", username, http: 200, body: rejectBody("unknown user") };
  }
  let reason = "";
  if (!row.enabled || row.status === "suspended" || row.status === "terminated") reason = "suspended";
  else if (row.bundle_mb > 0 && row.bundle_used_mb >= row.bundle_mb) reason = "bundle";
  else if (accessUntilMs(row.period_end, row.grace_days, row.grant_expires_at) > 0
    && accessUntilMs(row.period_end, row.grace_days, row.grant_expires_at) <= Date.now()) {
    reason = "expired";
  }
  if (reason) {
    if (doLog) await logAuth(sql, tenantId, username, nasIp, "reject", reason);
    return { ok: false, result: "reject", reason, username, http: 200, body: rejectBody(reason) };
  }
  if (doLog) await logAuth(sql, tenantId, username, nasIp, "accept", "ok");
  return {
    ok: true,
    result: "accept",
    reason: "ok",
    username,
    http: 200,
    body: acceptBody({
      password: row.password,
      framedIp: row.framed_ip,
      group: mikrotikProfileName(row.package_name || row.group_name),
      sessionTimeout: sessionTimeoutSec(row.period_end, row.grace_days, row.grant_expires_at),
    }),
  };
}

export async function authenticateRadius(
  sql: Sql,
  tenantId: string,
  input: { username: string; password: string; nasIp?: string },
): Promise<RadiusDecision> {
  const decision = await authorizeRadius(sql, tenantId, { ...input, log: false });
  if (!decision.ok) {
    await logAuth(sql, tenantId, decision.username || radiusUsername(input.username), input.nasIp || "", "reject", decision.reason);
    return decision;
  }
  const [row] = await sql<{ password: string }>`
    select password from radius_accounts where tenant_id = ${tenantId} and username = ${decision.username}`;
  const presented = input.password || "";
  if (!row || !presented || !safeEq(row.password, presented)) {
    await logAuth(sql, tenantId, decision.username, input.nasIp || "", "reject", "bad-password");
    return {
      ok: false,
      result: "reject",
      reason: "bad-password",
      username: decision.username,
      http: 200,
      body: rejectBody("bad password"),
    };
  }
  await logAuth(sql, tenantId, decision.username, input.nasIp || "", "accept", "ok");
  return decision;
}

export function accountingInputFromBody(body: unknown) {
  const username = radiusUsername(attrValue(body, "User-Name"));
  const sessionId = attrValue(body, "Acct-Session-Id") || attrValue(body, "Acct-Unique-Session-Id");
  const status = parseAcctStatus(attrValue(body, "Acct-Status-Type"));
  return {
    username,
    bytes_in: octetsFromAvps(body, "Input"),
    bytes_out: octetsFromAvps(body, "Output"),
    nas_ip: attrValue(body, "NAS-IP-Address"),
    framed_ip: attrValue(body, "Framed-IP-Address"),
    session_id: sessionId,
    acct_status: status,
  };
}

export async function applyRadiusAccounting(sql: Sql, tenantId: string, body: unknown) {
  const input = accountingInputFromBody(body);
  return recordAccounting(sql, tenantId, input);
}

export function radiusConfigBundle(opts: {
  baseUrl: string;
  slug: string;
  apiKey: string;
  nas: Array<{ name: string; ip: string; secret: string }>;
  radiusHost?: string;
}) {
  const base = (opts.baseUrl || "http://web:3000").replace(/\/+$/, "");
  const revealed = opts.apiKey && !opts.apiKey.startsWith("••••");
  const nas = opts.nas;
  return {
    rest: renderFreeRadiusRestMod({
      baseUrl: base,
      slug: opts.slug,
      apiKey: revealed ? opts.apiKey : "frk_replace_me",
    }),
    site: renderFreeRadiusSite(),
    clients: renderRadiusClientsConf(nas),
    mikrotik: renderMikrotikRadiusSnippet({
      radiusHost: opts.radiusHost || "10.200.0.1",
      secret: nas.find((c) => c.secret)?.secret || "change-me-on-the-router",
    }),
  };
}

export async function bootstrapRadius(
  sql: Sql,
  tenantId: string,
  opts: { slug: string; apiKey: string; publicBase?: string; radiusHost?: string },
) {
  const nasSecret = await ensureRadiusNasSecret(sql, tenantId);
  const routers = await sql<{ name: string; nas_ip: string; radius_secret: string }>`
    select name, nas_ip, radius_secret from routers where tenant_id = ${tenantId} order by name`;
  const nas = defaultNasClients(
    nasSecret,
    routers.map((r) => ({
      name: r.name,
      ip: r.nas_ip,
      secret: open(r.radius_secret) || nasSecret,
    })),
  );
  const bundle = radiusConfigBundle({
    baseUrl: internalRadiusBaseUrl(opts.publicBase || ""),
    slug: opts.slug,
    apiKey: opts.apiKey,
    nas,
    radiusHost: opts.radiusHost,
  });
  return { ok: true as const, slug: opts.slug, nas_secret: nasSecret, ...bundle };
}

export async function handleRadiusHttp(
  sql: Sql,
  slug: string,
  action: string,
  presented: string,
  body: unknown,
) {
  const resolved = await resolveRadiusTenant(sql, slug, presented);
  if ("error" in resolved) {
    return { status: resolved.error, json: { ok: false, error: resolved.message } };
  }
  const tenantId = resolved.tenant.id;
  const kind = action.trim().toLowerCase();
  if (kind === "bootstrap") {
    const pack = await bootstrapRadius(sql, tenantId, {
      slug: resolved.tenant.slug,
      apiKey: presented,
      publicBase: resolved.tenant.public_base_url,
    });
    return { status: 200, json: pack };
  }
  if (kind === "authorize") {
    const decision = await authorizeRadius(sql, tenantId, {
      username: attrValue(body, "User-Name"),
      nasIp: attrValue(body, "NAS-IP-Address"),
    });
    return { status: decision.http, json: decision.body };
  }
  if (kind === "authenticate") {
    const decision = await authenticateRadius(sql, tenantId, {
      username: attrValue(body, "User-Name"),
      password: attrValue(body, "User-Password"),
      nasIp: attrValue(body, "NAS-IP-Address"),
    });
    return { status: decision.http, json: decision.body };
  }
  if (kind === "accounting") {
    try {
      const result = await applyRadiusAccounting(sql, tenantId, body);
      return { status: 200, json: { ok: true, ...result } };
    } catch (e) {
      return { status: 400, json: { ok: false, error: e instanceof Error ? e.message : "failed" } };
    }
  }
  return { status: 404, json: { ok: false, error: "unknown radius action" } };
}

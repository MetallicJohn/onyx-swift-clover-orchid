import { createHmac, timingSafeEqual } from "node:crypto";
import { nbiOrigin, nbiRequest, type AcsNbiConfig, type NbiFetch } from "./acs-nbi.ts";
import { buildAcsUrl, loadAcsPlatformSettings, type AcsPlatformSettings } from "./acs-ports.ts";
import { open, seal } from "./secrets.ts";
import { rateLimit } from "./rate-limit.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const CWMP_AUTH_DIGEST = 'AUTH(USERNAME, EXT("ispsolutions", "passwordFor", USERNAME))';
export const CWMP_AUTH_OPEN = "true";
export const CWMP_CONNECTION_REQUEST_AUTH = "AUTH(username, password)";
export const LOCK_URL_PROVISION = "ispsolutions-lock-url";
export const LOCK_URL_PRESET = "ispsolutions-lock-url";

export function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function authorizedAcsEdge(request: Request) {
  const token = (process.env.ACS_EDGE_TOKEN || "").trim();
  if (!token) return false;
  const header = request.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ")
    ? header.slice(7).trim()
    : (request.headers.get("x-acs-edge-token") || "").trim();
  return presented.length > 0 && safeEqual(presented, token);
}

export function cwmpAuthExpression(requireCpeAuth: boolean) {
  return requireCpeAuth ? CWMP_AUTH_DIGEST : CWMP_AUTH_OPEN;
}

export function hs256Jwt(payload: Record<string, unknown>, secret: string) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function dummyWork() {
  open(seal("ispsolutions-acs-auth-dummy"));
}

function platformNbi(): AcsNbiConfig {
  return {
    nbiUrl: (process.env.GENIEACS_NBI_URL || "").trim(),
    user: (process.env.GENIEACS_NBI_USER || process.env.GENIEACS_NBI_USERNAME || "").trim(),
    pass: (process.env.GENIEACS_NBI_PASS || process.env.GENIEACS_NBI_PASSWORD || "").trim(),
    oui: "",
  };
}

export const LOCK_URL_SCRIPT = `const now = Date.now();
const igdUser = declare("InternetGatewayDevice.ManagementServer.Username", {value: 1});
const devUser = declare("Device.ManagementServer.Username", {value: 1});
const username = String((igdUser.value && igdUser.value[0]) || (devUser.value && devUser.value[0]) || "");
const url = ext("ispsolutions", "acsUrlFor", username);
if (url) {
  declare("InternetGatewayDevice.ManagementServer.URL", {value: now}).value = [now, url];
  declare("Device.ManagementServer.URL", {value: now}).value = [now, url];
}
const crUser = ext("ispsolutions", "connreqUserFor", username);
const crPass = ext("ispsolutions", "connreqPasswordFor", username);
if (crUser && crPass) {
  declare("InternetGatewayDevice.ManagementServer.ConnectionRequestUsername", {value: now}).value = [now, crUser];
  declare("InternetGatewayDevice.ManagementServer.ConnectionRequestPassword", {value: now}).value = [now, crPass];
  declare("Device.ManagementServer.ConnectionRequestUsername", {value: now}).value = [now, crUser];
  declare("Device.ManagementServer.ConnectionRequestPassword", {value: now}).value = [now, crPass];
}
`;

export type AcsAuthKind = "password" | "profile";

export type AcsAuthResult =
  | { ok: true; password: string; url?: string; connreq_user?: string; connreq_password?: string }
  | { ok: false };

export async function lookupAcsAuth(
  sql: Sql,
  username: string,
  kind: AcsAuthKind = "password",
): Promise<AcsAuthResult> {
  const user = (username || "").trim();
  if (!user || user.length > 80) {
    dummyWork();
    return { ok: false };
  }
  const [row] = await sql<{
    password_ref: string;
    connreq_user: string;
    connreq_pass_ref: string;
    public_host: string;
    cwmp_port: number | null;
    cwmp_url: string;
    enabled: boolean;
  }>`select password_ref, connreq_user, connreq_pass_ref, public_host, cwmp_port, cwmp_url, enabled
     from acs_isp_credentials where username = ${user}`;
  if (!row || row.enabled === false) {
    dummyWork();
    return { ok: false };
  }
  const password = open(row.password_ref || "");
  if (!password) {
    dummyWork();
    return { ok: false };
  }
  if (kind === "password") return { ok: true, password };
  const plat = await loadAcsPlatformSettings(sql);
  const host = row.public_host || plat.acs_public_host;
  const url = buildAcsUrl(host, row.cwmp_port, plat.acs_tls) || row.cwmp_url || "";
  return {
    ok: true,
    password,
    url,
    connreq_user: row.connreq_user || "",
    connreq_password: open(row.connreq_pass_ref || ""),
  };
}

export async function handleAcsAuthRequest(sql: Sql, request: Request): Promise<Response> {
  if (!authorizedAcsEdge(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  let body: { username?: string; kind?: string } = {};
  try {
    body = (await request.json()) as { username?: string; kind?: string };
  } catch {
    return Response.json({ ok: false, error: "invalid json" }, { status: 400 });
  }
  const username = (body.username || "").trim();
  const kind: AcsAuthKind = body.kind === "profile" ? "profile" : "password";
  const global = rateLimit("acs-auth:*", 2000, 60_000);
  const perUser = rateLimit(`acs-auth:${username || "none"}`, 180, 60_000);
  if (!global.ok || !perUser.ok) {
    return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
  }
  const plat = await loadAcsPlatformSettings(sql);
  if (!plat.acs_require_cpe_auth && kind === "password") {
    const found = await lookupAcsAuth(sql, username, "password");
    if (found.ok) return Response.json(found);
    dummyWork();
    return Response.json({ ok: false });
  }
  const found = await lookupAcsAuth(sql, username, kind);
  if (!found.ok) return Response.json({ ok: false });
  if (kind === "password") return Response.json({ ok: true, password: found.password });
  return Response.json({
    ok: true,
    url: found.url || "",
    connreq_user: found.connreq_user || "",
    connreq_password: found.connreq_password || "",
  });
}

export type AcsSecurityChecklistItem = {
  id: string;
  ok: boolean;
  label: string;
  detail: string;
};

export function acsSecurityChecklist(opts: {
  scheme: "http" | "https";
  require_cpe_auth: boolean;
  lock_url: boolean;
  connreq_distinct: boolean;
  has_credentials: boolean;
}): { items: AcsSecurityChecklistItem[]; scheme: "http" | "https"; require_cpe_auth: boolean; lock_url: boolean } {
  const items: AcsSecurityChecklistItem[] = [
    {
      id: "digest",
      ok: opts.require_cpe_auth && opts.has_credentials,
      label: "CPE digest login",
      detail: opts.require_cpe_auth
        ? "ONUs must present this ISP's ACS username and password before a session is accepted."
        : "Lab mode: the ACS will accept informs without this ISP's password. Turn this back on before production.",
    },
    {
      id: "scheme",
      ok: opts.scheme === "https",
      label: "ACS URL scheme",
      detail:
        opts.scheme === "https"
          ? "Issued ACS URLs use HTTPS. Terminate TLS on the TR-069 edge with a certificate for this host."
          : "Issued ACS URLs use HTTP. Existing OLT profiles keep working. Switch to HTTPS in System settings when a certificate is ready.",
    },
    {
      id: "lock",
      ok: opts.lock_url,
      label: "ACS URL lock",
      detail: opts.lock_url
        ? "On every inform the ACS writes this ISP's URL back onto the ONU so it cannot be redirected."
        : "URL lock is off. An ONU whose ACS URL is changed will stay on the new ACS.",
    },
    {
      id: "connreq",
      ok: opts.connreq_distinct,
      label: "Connection-request login",
      detail: opts.connreq_distinct
        ? "The ACS uses a separate username when it calls the ONU. This is not the ACS login."
        : "Generate credentials so connection-request login is distinct from ACS login.",
    },
    {
      id: "nbi",
      ok: true,
      label: "Northbound API",
      detail: "The console's GenieACS API stays on the private network. ONUs never see it.",
    },
  ];
  return {
    items,
    scheme: opts.scheme,
    require_cpe_auth: opts.require_cpe_auth,
    lock_url: opts.lock_url,
  };
}

export function acsSecurityFromPlatform(
  plat: Pick<AcsPlatformSettings, "acs_tls" | "acs_require_cpe_auth" | "acs_lock_url">,
  creds: { username?: string; connreq_user?: string } | null,
) {
  const username = (creds?.username || "").trim();
  const connreq = (creds?.connreq_user || "").trim();
  return acsSecurityChecklist({
    scheme: plat.acs_tls,
    require_cpe_auth: plat.acs_require_cpe_auth,
    lock_url: plat.acs_lock_url,
    connreq_distinct: Boolean(username && connreq && connreq !== username),
    has_credentials: Boolean(username),
  });
}

function uiOriginFromNbi(nbiUrl: string) {
  try {
    const u = new URL(nbiUrl.includes("://") ? nbiUrl : `http://${nbiUrl}`);
    u.port = "3000";
    u.pathname = "";
    u.search = "";
    u.hash = "";
    return u.origin;
  } catch {
    return "";
  }
}

async function putCwmpConfig(
  cfg: AcsNbiConfig,
  name: string,
  expression: string,
  fetchImpl: NbiFetch,
) {
  const body = JSON.stringify(expression);
  const nbi = await nbiRequest(cfg, `/config/${encodeURIComponent(name)}`, { method: "PUT", body }, fetchImpl);
  if (nbi.ok) return { ok: true as const, via: "nbi" as const, status: nbi.status };
  const ui = uiOriginFromNbi(cfg.nbiUrl);
  const secret = (process.env.GENIEACS_UI_JWT_SECRET || "").trim();
  if (!ui || !secret) return { ok: false as const, via: "nbi" as const, status: nbi.status };
  const token = hs256Jwt({ username: "admin" }, secret);
  const res = await fetchImpl(`${ui}/api/config/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body,
  });
  return { ok: res.ok, via: "ui" as const, status: res.status };
}

export async function applyGenieAcsSecurity(
  sql: Sql,
  opts: { fetchImpl?: NbiFetch; nbi?: AcsNbiConfig } = {},
) {
  const cfg = opts.nbi && nbiOrigin(opts.nbi) ? opts.nbi : platformNbi();
  const fetchImpl = opts.fetchImpl ?? fetch;
  if (!nbiOrigin(cfg)) return { ok: false, error: "GenieACS NBI URL is not set", steps: [] as string[] };
  const plat = await loadAcsPlatformSettings(sql);
  const steps: string[] = [];
  const provision = await nbiRequest(
    cfg,
    `/provisions/${LOCK_URL_PROVISION}`,
    { method: "PUT", headers: { "content-type": "application/javascript" }, body: LOCK_URL_SCRIPT },
    fetchImpl,
  );
  if (provision.ok) steps.push("provision");
  if (plat.acs_lock_url) {
    const preset = await nbiRequest(
      cfg,
      `/presets/${LOCK_URL_PRESET}`,
      {
        method: "PUT",
        body: JSON.stringify({
          weight: 1,
          precondition: "true",
          configurations: [{ type: "provision", name: LOCK_URL_PROVISION }],
        }),
      },
      fetchImpl,
    );
    if (preset.ok) steps.push("preset");
  } else {
    const dropped = await nbiRequest(cfg, `/presets/${LOCK_URL_PRESET}`, { method: "DELETE" }, fetchImpl);
    if (dropped.ok || dropped.status === 404) steps.push("preset-off");
  }
  const auth = await putCwmpConfig(cfg, "cwmp.auth", cwmpAuthExpression(plat.acs_require_cpe_auth), fetchImpl);
  if (auth.ok) steps.push("cwmp.auth");
  const cr = await putCwmpConfig(cfg, "cwmp.connectionRequestAuth", CWMP_CONNECTION_REQUEST_AUTH, fetchImpl);
  if (cr.ok) steps.push("cwmp.connectionRequestAuth");
  const ok = steps.includes("provision") && (plat.acs_lock_url ? steps.includes("preset") : true);
  return {
    ok,
    steps,
    auth: auth.ok,
    error: ok ? "" : "GenieACS did not accept the full security config. Digest auth still applies on the VPS from the ACS sidecar.",
  };
}

export async function rewriteAcsUrls(sql: Sql) {
  const plat = await loadAcsPlatformSettings(sql);
  const rows = await sql<{ tenant_id: string; public_host: string; cwmp_port: number | null }>`
    select tenant_id, public_host, cwmp_port from acs_isp_credentials where cwmp_port is not null`;
  let n = 0;
  for (const row of rows) {
    const url = buildAcsUrl(row.public_host || plat.acs_public_host, row.cwmp_port, plat.acs_tls);
    if (!url) continue;
    await sql`update acs_isp_credentials set cwmp_url = ${url}, updated_at = now() where tenant_id = ${row.tenant_id}`;
    n += 1;
  }
  return n;
}

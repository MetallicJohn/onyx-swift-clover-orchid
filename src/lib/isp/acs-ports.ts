import { applyRls } from "./rls.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

/** Never allocated as a tenant TR-069 port, even if the configured range includes them. */
export const ACS_RESERVED_PORTS = new Set([
  22, 80, 443, 3000, 5432, 6379, 7547, 7557, 7567, 8080, 8081, 27017, 1812, 1813, 51820,
]);

export const ACS_PORT_RANGE_DEFAULT = { start: 7551, end: 7999 };

export type AcsPlatformSettings = {
  acs_public_host: string;
  acs_dns_host: string;
  acs_port_start: number;
  acs_port_end: number;
};

export function normalizeAcsHost(raw: string) {
  const v = (raw || "").trim().replace(/^https?:\/\//i, "").split("/")[0]?.split(":")[0] || "";
  if (!v) return "";
  if (v.length > 253) throw new Error("ACS host is too long");
  const ipv4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  const name = /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (!ipv4.test(v) && !name.test(v)) throw new Error("Enter a hostname or IPv4 address for the ACS");
  if (ipv4.test(v) && v.split(".").some((o) => Number(o) > 255)) throw new Error("Invalid ACS IPv4 address");
  return v;
}

export function parsePortRange(startRaw: unknown, endRaw: unknown) {
  const start = Math.floor(Number(startRaw));
  const end = Math.floor(Number(endRaw));
  if (!Number.isFinite(start) || !Number.isFinite(end)) throw new Error("TR-069 port range must be numbers");
  if (start < 1024 || end > 65535) throw new Error("TR-069 ports must be between 1024 and 65535");
  if (start > end) throw new Error("TR-069 range start must be less than or equal to the end");
  if (end - start > 4096) throw new Error("TR-069 port range is too wide");
  return { start, end };
}

export function assertAllocatablePort(port: number, range: { start: number; end: number }) {
  const p = Math.floor(Number(port));
  if (!Number.isFinite(p) || p !== Number(port)) throw new Error("Port must be an integer");
  if (p < range.start || p > range.end) {
    throw new Error(`Port ${p} is outside the allowed TR-069 range ${range.start}–${range.end}`);
  }
  if (ACS_RESERVED_PORTS.has(p)) throw new Error(`Port ${p} is reserved for platform services`);
  return p;
}

export function buildAcsUrl(host: string, port: number | null | undefined) {
  const h = normalizeAcsHost(host);
  const p = Math.floor(Number(port));
  if (!h || !Number.isFinite(p) || p <= 0) return "";
  return `http://${h}:${p}/`;
}

export async function loadAcsPlatformSettings(sql: Sql): Promise<AcsPlatformSettings> {
  const rows = await sql<{ key: string; value: string }>`
    select key, value from platform_settings
    where key in ('acs_public_host', 'acs_dns_host', 'acs_port_start', 'acs_port_end')`;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const range = parsePortRange(map.acs_port_start || ACS_PORT_RANGE_DEFAULT.start, map.acs_port_end || ACS_PORT_RANGE_DEFAULT.end);
  return {
    acs_public_host: (map.acs_public_host || "").trim(),
    acs_dns_host: (map.acs_dns_host || "").trim(),
    acs_port_start: range.start,
    acs_port_end: range.end,
  };
}

export async function resolveAcsPublicHost(sql: Sql, fallbackBase = "") {
  const cfg = await loadAcsPlatformSettings(sql);
  if (cfg.acs_public_host) return normalizeAcsHost(cfg.acs_public_host);
  const envHost = (process.env.ACS_PUBLIC_HOST || process.env.GRIDLINE_DOMAIN || "").trim();
  if (envHost) return normalizeAcsHost(envHost);
  if (fallbackBase) {
    try {
      const u = new URL(fallbackBase.includes("://") ? fallbackBase : `https://${fallbackBase}`);
      if (u.hostname) return u.hostname;
    } catch {
      /* ignore */
    }
  }
  return "";
}

async function usedPorts(sql: Sql) {
  const rows = await sql<{ port: number }>`select cwmp_port as port from acs_isp_credentials where cwmp_port is not null`;
  return new Set(rows.map((r) => r.port));
}

function rangeOf(cfg: AcsPlatformSettings | { start: number; end: number }) {
  if ("start" in cfg) return { start: cfg.start, end: cfg.end };
  return { start: cfg.acs_port_start, end: cfg.acs_port_end };
}

export async function nextAcsPort(sql: Sql, range?: { start: number; end: number }) {
  const cfg = rangeOf(range || (await loadAcsPlatformSettings(sql)));
  const taken = await usedPorts(sql);
  for (let p = cfg.start; p <= cfg.end; p++) {
    if (ACS_RESERVED_PORTS.has(p)) continue;
    if (!taken.has(p)) return p;
  }
  throw new Error("No TR-069 ports left in the configured range. Widen the range or free a reserved port.");
}

function isUniqueViolation(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /unique|duplicate/i.test(msg);
}

export async function allocateAcsPort(
  sql: Sql,
  tenantId: string,
  opts: { preferred?: number; confirmChange?: boolean; actorUserId?: string } = {},
) {
  const settings = await loadAcsPlatformSettings(sql);
  const range = rangeOf(settings);
  const [existing] = await sql<{ cwmp_port: number | null }>`
    select cwmp_port from acs_isp_credentials where tenant_id = ${tenantId}`;
  if (opts.preferred == null && existing?.cwmp_port) return existing.cwmp_port;
  const desired = opts.preferred != null ? assertAllocatablePort(opts.preferred, range) : await nextAcsPort(sql, range);
  if (existing?.cwmp_port === desired) return desired;

  const [conflict] = await sql<{ tenant_id: string }>`
    select tenant_id from acs_isp_credentials where cwmp_port = ${desired} and tenant_id <> ${tenantId}`;
  if (conflict) throw new Error(`Port ${desired} is already assigned to another ISP`);

  if (opts.preferred != null && existing?.cwmp_port && existing.cwmp_port !== opts.preferred && !opts.confirmChange) {
    throw new Error("ACS_PORT_CHANGE_CONFIRM");
  }

  for (let attempt = 0; attempt < 8; attempt++) {
    const port = opts.preferred != null ? desired : attempt === 0 ? desired : await nextAcsPort(sql, range);
    try {
      await sql`
        insert into acs_isp_credentials (tenant_id, cwmp_port, updated_at)
        values (${tenantId}, ${port}, now())
        on conflict (tenant_id) do update set cwmp_port = excluded.cwmp_port, updated_at = now()`;
      return port;
    } catch (err) {
      if (opts.preferred != null || !isUniqueViolation(err) || attempt === 7) throw err;
    }
  }
  throw new Error("Could not allocate a TR-069 port");
}

export async function withAcsPortLock<T>(sql: Sql, tenantId: string, fn: () => Promise<T>): Promise<T> {
  await applyRls(sql, { bypass: true });
  try {
    return await fn();
  } finally {
    await applyRls(sql, { tenantId, bypass: false });
  }
}

export async function ensureTenantAcsPort(sql: Sql, opts: { tenantId: string; slug?: string; publicBase?: string }) {
  const port = await allocateAcsPort(sql, opts.tenantId);
  const host = await resolveAcsPublicHost(sql, opts.publicBase || "");
  if (host) {
    await sql`update acs_isp_credentials
      set public_host = case when public_host = '' then ${host} else public_host end, updated_at = now()
      where tenant_id = ${opts.tenantId}`;
  }
  return port;
}

export async function listAcsPortMap(sql: Sql) {
  const rows = await sql<{
    tenant_id: string;
    slug: string;
    cwmp_port: number;
    username: string;
    enabled: boolean;
  }>`select c.tenant_id, t.slug, c.cwmp_port, c.username, c.enabled
     from acs_isp_credentials c
     join tenants t on t.id = c.tenant_id
     where c.cwmp_port is not null and c.enabled = true
     order by c.cwmp_port`;
  return rows;
}

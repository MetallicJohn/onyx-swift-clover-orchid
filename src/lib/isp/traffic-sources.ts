/**
 * Telemetry source adapters. RADIUS accounting is authoritative for session
 * bytes. RouterOS REST is a batched router-level supplement. SNMP and NetFlow
 * are stubs until configured — they never invent values.
 */

export type SourceStatus = "ok" | "not_configured" | "error";

export type SourceProbe = {
  source: "radius" | "routeros" | "snmp" | "netflow";
  configured: boolean;
  status: SourceStatus;
  detail?: string;
};

export const SOURCE_RANK: Record<string, number> = {
  radius: 0,
  "radius-accounting": 0,
  routeros: 1,
  "router_api": 1,
  snmp: 2,
  netflow: 3,
};

export function pickAuthoritativeSource(available: string[], priority: string[]) {
  const have = new Set(available.map((s) => s.toLowerCase()));
  for (const p of priority) {
    if (have.has(p)) return p;
    if (p === "radius" && (have.has("radius-accounting") || have.has("radius"))) return "radius";
    if (p === "routeros" && (have.has("routeros") || have.has("router_api"))) return "routeros";
  }
  return available[0] || "";
}

export function snmpAdapter(): SourceProbe {
  return { source: "snmp", configured: false, status: "not_configured" };
}

export function netflowAdapter(): SourceProbe {
  return { source: "netflow", configured: false, status: "not_configured" };
}

export function radiusAdapter(sessionCount: number): SourceProbe {
  return {
    source: "radius",
    configured: true,
    status: "ok",
    detail: `${sessionCount} sessions`,
  };
}

export function routerosAdapter(opts: { attempted: number; ok: number; failed: number }): SourceProbe {
  if (opts.attempted === 0) return { source: "routeros", configured: false, status: "not_configured" };
  if (opts.ok === 0 && opts.failed > 0) {
    return { source: "routeros", configured: true, status: "error", detail: `${opts.failed} unreachable` };
  }
  return {
    source: "routeros",
    configured: true,
    status: opts.failed ? "ok" : "ok",
    detail: `${opts.ok}/${opts.attempted}`,
  };
}

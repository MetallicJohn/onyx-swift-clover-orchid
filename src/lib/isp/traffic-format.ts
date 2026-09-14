/**
 * Derive live rates from successive RADIUS accounting samples.
 * bytes_in  = Acct-Input-Octets  (from the subscriber = upload)
 * bytes_out = Acct-Output-Octets (to the subscriber = download)
 * Returns 0 when the window is invalid or counters reset.
 */
export function bytesToBps(prevBytes: number, nextBytes: number, prevMs: number, nextMs: number) {
  const dt = (nextMs - prevMs) / 1000;
  if (!Number.isFinite(dt) || dt <= 0) return 0;
  const db = nextBytes - prevBytes;
  if (!Number.isFinite(db) || db < 0) return 0;
  return (db * 8) / dt;
}

export function formatBps(bps: number | null | undefined) {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return "—";
  if (bps === 0) return "0 bps";
  if (bps < 1000) return `${Math.round(bps)} bps`;
  if (bps < 1_000_000) return `${(bps / 1000).toFixed(1)} kbps`;
  return `${(bps / 1_000_000).toFixed(2)} Mbps`;
}

/** Fill width against the package cap. 0 when the cap or rate is unknown. */
export function meterPercent(bps: number | null | undefined, mbpsCap: number) {
  if (bps == null || !Number.isFinite(bps) || bps <= 0 || !mbpsCap) return 0;
  return Math.min(100, (bps / (mbpsCap * 1_000_000)) * 100);
}

export const TRAFFIC_POLL_MS = 5000;
export const TRAFFIC_SOURCE_LABEL: Record<string, string> = {
  "radius-accounting": "RADIUS accounting",
  radius: "RADIUS accounting",
  "traffic-collector": "Traffic collector",
  routeros: "RouterOS",
  router_api: "RouterOS",
  snmp: "SNMP",
  netflow: "NetFlow",
  "agent-heartbeat": "Agent heartbeat",
};

export const TRAFFIC_FRESHNESS_LABEL: Record<string, string> = {
  live: "live",
  stale: "last updated (stale)",
  unavailable: "data unavailable",
};

export function trafficFreshness(collectedAt: string | null | undefined, intervalSec = 30) {
  if (!collectedAt) return "unavailable" as const;
  const t = Date.parse(collectedAt);
  if (Number.isNaN(t)) return "unavailable" as const;
  const age = Date.now() - t;
  if (age <= Math.max(5, intervalSec) * 3 * 1000) return "live" as const;
  if (age <= 15 * 60 * 1000) return "stale" as const;
  return "unavailable" as const;
}

export function formatDuration(sec: number | null | undefined) {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 48) return `${Math.floor(h / 24)}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${r}s`;
  return `${r}s`;
}

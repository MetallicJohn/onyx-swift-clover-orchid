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
};

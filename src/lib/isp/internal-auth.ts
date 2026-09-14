import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function presentedBearer(request: Request) {
  const header = request.headers.get("authorization") || "";
  if (header.toLowerCase().startsWith("bearer ")) return header.slice(7).trim();
  return (request.headers.get("x-internal-token") || request.headers.get("x-acs-edge-token") || "").trim();
}

/** Service-to-service auth for /api/internal/*. Never accept a client-sent URL as the token. */
export function authorizedInternal(request: Request) {
  const primary = (process.env.INTERNAL_SERVICE_TOKEN || "").trim();
  const edge = (process.env.ACS_EDGE_TOKEN || "").trim();
  const presented = presentedBearer(request);
  if (!presented) return false;
  if (primary && safeEqual(presented, primary)) return true;
  if (edge && safeEqual(presented, edge)) return true;
  return false;
}

export function requestIdOf(request?: Request | null) {
  const from = request?.headers.get("x-request-id") || request?.headers.get("x-correlation-id") || "";
  return from.trim() || `req_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function internalToken() {
  return (process.env.INTERNAL_SERVICE_TOKEN || process.env.ACS_EDGE_TOKEN || "").trim();
}

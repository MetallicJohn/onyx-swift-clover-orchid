import { hostnameOf, originOf } from "../isp/auth-origins";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export type SameSiteInput = {
  method: string;
  site: string | null;
  mode: string | null;
  dest: string | null;
  origin: string | null;
  referer: string | null;
  host: string | null;
  forwardedHost: string | null;
  authorization: string | null;
  url: string;
};

function hostsOf(input: SameSiteInput) {
  const fromUrl = (() => {
    try {
      return hostnameOf(new URL(input.url).host);
    } catch {
      return null;
    }
  })();
  return [hostnameOf(input.forwardedHost), hostnameOf(input.host), fromUrl].filter((h): h is string => Boolean(h));
}

function originMatches(input: SameSiteInput) {
  const origin = originOf(input.origin) || originOf(input.referer);
  const host = origin ? hostnameOf(origin) : null;
  if (!host) return false;
  return hostsOf(input).includes(host);
}

function bearerPresent(header: string | null) {
  return /^Bearer\s+\S{8,}/i.test((header || "").trim());
}

/**
 * Allow same-origin, `none`, and top-level GET navigations.
 * A missing Sec-Fetch-Site on a state-changing method is not trusted by itself:
 * the Origin/Referer host must match this request, or the caller must send a bearer token.
 */
export function evaluateSameSite(input: SameSiteInput): "allow" | "reject" {
  const site = (input.site || "").trim().toLowerCase();
  const method = (input.method || "GET").toUpperCase();
  if (site === "same-origin" || site === "none") return "allow";
  if (!site) {
    if (SAFE.has(method)) return "allow";
    if (bearerPresent(input.authorization) || originMatches(input)) return "allow";
    return "reject";
  }
  const dest = (input.dest || "").toLowerCase();
  const topLevelGet =
    (input.mode || "").toLowerCase() === "navigate" && method === "GET" && dest !== "object" && dest !== "embed";
  return topLevelGet ? "allow" : "reject";
}

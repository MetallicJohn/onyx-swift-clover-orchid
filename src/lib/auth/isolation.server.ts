import { getRequest } from "@tanstack/react-start/server";
import { evaluateSameSite } from "./same-site";

/**
 * Fetch-Metadata sibling isolation — **server-only** (`.server.ts` suffix).
 *
 * MUST keep the `.server` suffix: this file imports `@tanstack/react-start/server`
 * (`getRequest` → Node `AsyncLocalStorage`). If it is imported from a dual
 * client/server module under a non-`.server` name, Vite ships it to the browser
 * and the app dies with: `AsyncLocalStorage is not a constructor`.
 *
 * Apps deployed on `*.grok.me` are "same-site" to each other but MUTUALLY
 * UNTRUSTED, and a `SameSite=Lax` session cookie IS sent on same-site
 * subrequests — so without this, a malicious sibling could make a SCRIPTED
 * (fetch/XHR/form-POST) request to this app's server functions and ride this
 * app's session cookie.
 *
 * We allow same-origin requests, top-level GET navigations, and `Sec-Fetch-Site: none`.
 * A state-changing request that omits Sec-Fetch-Site is rejected unless its Origin
 * or Referer host matches this request, or it carries a bearer token (not a cookie).
 * Together with `__Host-` cookies and Better Auth's `trustedOrigins`, this
 * closes the sibling-tenant attack surface. Enforced at the `authMiddleware`
 * chokepoint (see `middleware.ts`).
 */
export class CrossSiteRequestError extends Error {
  readonly status = 403;
  constructor() {
    super("Forbidden: cross-site request blocked");
    this.name = "CrossSiteRequestError";
  }
}

/** Throw `CrossSiteRequestError` for a scripted cross-site/sibling request. */
export function assertSameSiteRequest(): void {
  const request = getRequest();
  if (!request) return; // no request context (e.g. build) — nothing to guard
  const h = request.headers;
  const decision = evaluateSameSite({
    method: request.method,
    site: h.get("sec-fetch-site"),
    mode: h.get("sec-fetch-mode"),
    dest: h.get("sec-fetch-dest"),
    origin: h.get("origin"),
    referer: h.get("referer"),
    host: h.get("host"),
    forwardedHost: h.get("x-forwarded-host"),
    authorization: h.get("authorization"),
    url: request.url,
  });
  if (decision === "reject") throw new CrossSiteRequestError();
}

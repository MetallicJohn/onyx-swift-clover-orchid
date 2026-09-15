import { hostnameOf } from "./auth-origins.ts";

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "portal",
  "login",
  "admin",
  "mail",
  "ftp",
  "staging",
  "dev",
  "console",
]);

export type PortalNetworkHint = {
  slug: string;
  public_base_url?: string | null;
};

/** Map a portal hostname to an ISP slug. Host / custom domain wins over a slug subdomain. */
export function slugFromPortalHost(host: string, tenants: PortalNetworkHint[]): string | null {
  const h = hostnameOf(host);
  if (!h) return null;
  for (const t of tenants) {
    const th = hostnameOf(t.public_base_url || "");
    if (!th) continue;
    if (th === h || `www.${th}` === h || th === `www.${h}`) return t.slug;
  }
  const labels = h.split(".");
  if (labels.length < 3) return null;
  const first = labels[0];
  if (!first || RESERVED_SUBDOMAINS.has(first)) return null;
  const hit = tenants.find((t) => t.slug.toLowerCase() === first);
  return hit?.slug ?? null;
}

export function portalSlugFromSearch(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return (params.get("slug") || params.get("isp") || "").trim();
}

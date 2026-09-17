import { hostnameOf } from "./auth-origins.ts";
import { RESERVED_SUBDOMAIN_LABELS, normalizeHostname } from "./domain-format.ts";

export type PortalNetworkHint = {
  slug: string;
  public_base_url?: string | null;
  hostnames?: string[];
};

/** Map a portal hostname to an ISP slug. Host / custom domain wins over a slug subdomain. */
export function slugFromPortalHost(host: string, tenants: PortalNetworkHint[]): string | null {
  const h = hostnameOf(host);
  if (!h) return null;
  for (const t of tenants) {
    const names = [
      hostnameOf(t.public_base_url || "") || "",
      ...(t.hostnames || []).map((n) => normalizeHostname(n)),
    ].filter(Boolean);
    for (const th of names) {
      if (th === h || `www.${th}` === h || th === `www.${h}`) return t.slug;
    }
  }
  const labels = h.split(".");
  if (labels.length < 3) return null;
  const first = labels[0];
  if (!first || RESERVED_SUBDOMAIN_LABELS.has(first)) return null;
  const hit = tenants.find((t) => t.slug.toLowerCase() === first);
  return hit?.slug ?? null;
}

export function portalSlugFromSearch(search: string) {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return (params.get("slug") || params.get("isp") || "").trim();
}

const KEY = "isp.portal.v1";
const SLUG_KEY = "isp.portal.slug";

export type StoredPortalSession = { token: string; slug: string };

export function readPortalSession(): StoredPortalSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPortalSession;
    if (typeof parsed.token === "string" && parsed.token.startsWith("prt_")) {
      return { token: parsed.token, slug: String(parsed.slug || "") };
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function writePortalSession(session: StoredPortalSession) {
  localStorage.setItem(KEY, JSON.stringify(session));
  if (session.slug) localStorage.setItem(SLUG_KEY, session.slug);
}

export function clearPortalSession() {
  localStorage.removeItem(KEY);
}

export function readPortalSlug() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(SLUG_KEY) || "";
}

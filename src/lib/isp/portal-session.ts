const KEY = "isp.portal.v1";
const SLUG_KEY = "isp.portal.slug";
const SESSION_EVENT = "isp-portal-session";
const PW_OFFER_KEY = "isp.portal.pw-offer";

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
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(PW_OFFER_KEY);
}

export function readPortalSlug() {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(SLUG_KEY) || "";
}

export function readPasswordOfferDismissed() {
  if (typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(PW_OFFER_KEY) === "1";
}

export function writePasswordOfferDismissed() {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(PW_OFFER_KEY, "1");
}

export function notifyPortalSession() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function onPortalSession(handler: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(SESSION_EVENT, handler);
  return () => window.removeEventListener(SESSION_EVENT, handler);
}

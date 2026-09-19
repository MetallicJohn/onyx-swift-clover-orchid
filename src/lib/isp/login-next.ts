/** Only exact in-app destinations. Rejects open redirects. */
const ALLOWED = new Set(["/app", "/platform", "/superadmin"]);

export function loginModeFromSearch(search: string): "in" | "up" {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return q.get("mode") === "up" ? "up" : "in";
}

export function loginDestination(search: string, mode: "in" | "up"): "/app" | "/platform" {
  if (mode === "up") return "/app";
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const next = q.get("next") || "";
  if (next === "/platform" || next === "/superadmin") return "/platform";
  return "/app";
}

export function isAllowedLoginNext(path: string) {
  return ALLOWED.has(path);
}

export function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase();
}

export function signInErrorMessage(err: unknown, appName = "ISP Solutions") {
  const raw = err instanceof Error ? err.message : "Sign-in failed";
  if (/invalid origin|missing_or_null_origin|forbidden/i.test(raw)) {
    return `This address is not allowed for sign-in. Open ${appName} at the public HTTPS URL (not the server IP, not www unless that is the saved URL).`;
  }
  if (/too many requests|rate limit/i.test(raw)) {
    return "Too many sign-in attempts from this network. Wait a minute and try again.";
  }
  if (/email and password is not enabled/i.test(raw)) {
    return "Email sign-in is not enabled on this deployment.";
  }
  if (/invalid email or password|invalid_email_or_password|unauthorized/i.test(raw)) {
    return "Email or password is wrong. Use the same HTTPS login page as signup, check Caps Lock, or use Forgot password. Google/X logins have no password until you set one.";
  }
  return raw;
}

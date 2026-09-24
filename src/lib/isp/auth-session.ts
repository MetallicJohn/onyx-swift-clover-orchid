/** Same key `src/lib/auth/client.ts` reads for live-preview bearer sessions. */
const BEARER_KEY = "grok-auth.bearer-token";

export type AuthResult = {
  data?: { token?: string | null } | null;
  error?: { message?: string | null } | null;
};

/**
 * Prefer the signed `set-auth-token` header (cookie value). Fall back to the
 * unsigned body token — Better Auth's bearer plugin will sign that.
 */
export function sessionTokenFromAuthResponse(
  result: AuthResult,
  headers?: Headers | null,
): string {
  const fromHeader = headers?.get("set-auth-token")?.trim() || "";
  const fromBody = result.data?.token?.trim() || "";
  return fromHeader || fromBody;
}

export function hasOperatorBearer(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.sessionStorage.getItem(BEARER_KEY)?.trim());
  } catch {
    return false;
  }
}

/** Keep the email/password session in the preview iframe (gate would otherwise replace it). */
export function rememberAuthSession(
  result: AuthResult,
  headers?: Headers | null,
) {
  if (typeof window === "undefined") return;
  const token = sessionTokenFromAuthResponse(result, headers);
  if (!token) return;
  try {
    window.sessionStorage.setItem(BEARER_KEY, token);
  } catch {
    /* storage unavailable */
  }
}

/**
 * Only a verified platform account may skip the login form.
 * A Better Auth cookie, bearer, or Grok gate session is not enough.
 */
export function loginPageAction(input: {
  isPending: boolean;
  hasUser: boolean;
  hasOperatorBearer: boolean;
  hasGateSession: boolean;
  platformOk?: boolean;
  platformPending?: boolean;
}): "wait" | "go_app" | "form" {
  if (input.isPending || input.platformPending) return "wait";
  if (input.platformOk) return "go_app";
  if (!input.hasUser) return "form";
  if (input.hasGateSession && !input.hasOperatorBearer) return "form";
  return "form";
}

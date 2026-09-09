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
 * Gate (Grok viewer) sessions must not hide ISP email login. Operator bearer
 * or a normal cookie session can skip the form.
 */
export function loginPageAction(input: {
  isPending: boolean;
  hasUser: boolean;
  hasOperatorBearer: boolean;
  hasGateSession: boolean;
}): "wait" | "go_app" | "form" {
  if (input.isPending) return "wait";
  if (!input.hasUser) return "form";
  if (input.hasOperatorBearer) return "go_app";
  if (input.hasGateSession) return "form";
  return "go_app";
}

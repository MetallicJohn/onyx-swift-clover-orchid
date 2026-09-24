import { findAuthUserByEmail, canonicalizeOperatorEmail, passwordVerifies } from "./accounts.ts";
import {
  ensureOperatorProfile,
  INVALID_LOGIN_MESSAGE,
  LOCKOUT_MESSAGE,
  recordOperatorLoginFailure,
} from "./operator-security.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const BLOCKED_STATUSES = new Set(["SUSPENDED", "DISABLED", "DELETED", "DEACTIVATED", "LOCKED"]);

export { INVALID_LOGIN_MESSAGE };

/** True when this platform user has a stored email/password credential. */
export async function hasPlatformCredential(sql: Sql, userId: string) {
  const [row] = await sql<{ id: string }>`
    select id from account
    where "userId" = ${userId}
      and "providerId" = 'credential'
      and password is not null
      and length(password) > 0
    limit 1`;
  return Boolean(row);
}

/**
 * Application sessions are valid only for an active platform credential account.
 * RouterOS, RADIUS, PPPoE, hotspot, and external IdP identities are not checked
 * and cannot satisfy this.
 */
export async function platformSessionAllowed(sql: Sql, userId: string): Promise<boolean> {
  if (!userId || userId === "dev-user") return false;
  const [user] = await sql<{ id: string }>`select id from "user" where id = ${userId}`;
  if (!user) return false;
  if (!(await hasPlatformCredential(sql, userId))) return false;
  await ensureOperatorProfile(sql, userId);
  const [row] = await sql<{ status: string; locked_until: string | null }>`
    select status, locked_until::text as locked_until
    from operator_profiles where user_id = ${userId}`;
  const status = String(row?.status || "").toUpperCase();
  if (BLOCKED_STATUSES.has(status)) return false;
  if (row?.locked_until && Date.parse(row.locked_until) > Date.now()) return false;
  return true;
}

export type PlatformLoginResult =
  | { ok: true; userId: string; email: string }
  | { ok: false; message: string };

/**
 * Authenticate a platform account. Unknown users, wrong passwords, disabled
 * accounts, and network credentials (RouterOS / RADIUS / PPPoE / hotspot /
 * portal) all return the same generic failure, except an already-locked
 * platform account which keeps the existing lockout message.
 * Never logs the password.
 */
export async function authenticatePlatformPassword(
  sql: Sql,
  identifier: string,
  password: string,
): Promise<PlatformLoginResult> {
  const canon = await canonicalizeOperatorEmail(sql, identifier);
  const email = canon.email;
  const user = await findAuthUserByEmail(sql, email);
  const passwordOk = Boolean(user) && (await passwordVerifies(sql, user?.email || email, password));
  if (!user || !passwordOk) {
    await recordOperatorLoginFailure(sql, email, "");
    return { ok: false, message: INVALID_LOGIN_MESSAGE };
  }

  await ensureOperatorProfile(sql, user.id);
  const [row] = await sql<{ status: string; locked_until: string | null }>`
    select status, locked_until::text as locked_until
    from operator_profiles where user_id = ${user.id}`;
  if (row?.locked_until && Date.parse(row.locked_until) > Date.now()) {
    return { ok: false, message: LOCKOUT_MESSAGE };
  }
  if (!(await platformSessionAllowed(sql, user.id))) {
    await recordOperatorLoginFailure(sql, email, "");
    return { ok: false, message: INVALID_LOGIN_MESSAGE };
  }
  return { ok: true, userId: user.id, email: user.email };
}

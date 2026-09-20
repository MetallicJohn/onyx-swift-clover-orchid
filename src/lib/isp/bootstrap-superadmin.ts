import { hashPassword } from "better-auth/crypto";
import {
  BOOTSTRAP_SUPERADMIN_EMAIL,
  BOOTSTRAP_SUPERADMIN_USERNAME,
} from "./bootstrap-login.ts";
import { findAuthUserByEmail } from "./accounts.ts";
import { ensureOperatorProfile } from "./operator-security.ts";
import { writePlatformAudit } from "./platform.ts";
import { applyRls } from "./rls.ts";

export { BOOTSTRAP_SUPERADMIN_EMAIL, BOOTSTRAP_SUPERADMIN_USERNAME, isBootstrapSuperadminLogin, resolveBootstrapLoginId } from "./bootstrap-login.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const BOOTSTRAP_USER_ID = "usr_platform_superadmin";
const BOOTSTRAP_NAME = "Superadmin";

function initialPassword() {
  return "SuperAdmin";
}

/**
 * Create the platform Superadmin on a truly empty install.
 * Idempotent: never recreates, never resets an existing password.
 */
export async function ensureBootstrapSuperadmin(sql: Sql): Promise<{ created: boolean }> {
  await applyRls(sql, { bypass: true });

  const [admins] = await sql<{ n: number }>`select count(*)::int as n from platform_admins`;
  if ((admins?.n ?? 0) > 0) return { created: false };

  const existing =
    (await findAuthUserByEmail(sql, BOOTSTRAP_SUPERADMIN_EMAIL)) ||
    (await findAuthUserByEmail(sql, BOOTSTRAP_SUPERADMIN_USERNAME));
  if (existing) {
    await sql`insert into platform_admins (user_id) values (${existing.id}) on conflict (user_id) do nothing`;
    await ensureOperatorProfile(sql, existing.id, { displayName: BOOTSTRAP_NAME, firstName: BOOTSTRAP_NAME });
    return { created: false };
  }

  const secret = initialPassword();
  const hashed = await hashPassword(secret);
  await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values (${BOOTSTRAP_USER_ID}, ${BOOTSTRAP_NAME}, ${BOOTSTRAP_SUPERADMIN_EMAIL}, true, now(), now())
    on conflict (email) do nothing`;
  const user = (await findAuthUserByEmail(sql, BOOTSTRAP_SUPERADMIN_EMAIL)) || { id: BOOTSTRAP_USER_ID, email: BOOTSTRAP_SUPERADMIN_EMAIL, name: BOOTSTRAP_NAME };

  const [cred] = await sql<{ id: string }>`
    select id from account where "userId" = ${user.id} and "providerId" = 'credential'`;
  if (!cred) {
    const accountId = crypto.randomUUID();
    await sql`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values (${accountId}, ${user.id}, 'credential', ${user.id}, ${hashed}, now(), now())`;
  }

  await sql`insert into platform_admins (user_id) values (${user.id}) on conflict (user_id) do nothing`;
  await ensureOperatorProfile(sql, user.id, { displayName: BOOTSTRAP_NAME, firstName: BOOTSTRAP_NAME });
  await sql`update operator_profiles
    set is_default_password = true, updated_at = now()
    where user_id = ${user.id} and password_changed_at is null`;
  await writePlatformAudit(sql, {
    actorUserId: user.id,
    actorEmail: BOOTSTRAP_SUPERADMIN_USERNAME,
    action: "PLATFORM_SUPERADMIN_CREATED",
    entityType: "user",
    entityId: user.id,
    metadata: { username: BOOTSTRAP_SUPERADMIN_USERNAME },
  });
  return { created: true };
}


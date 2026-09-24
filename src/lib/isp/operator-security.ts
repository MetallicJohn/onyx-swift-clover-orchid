import { findAuthUserByEmail, isPlatformAdmin, loadAuthUser } from "./accounts.ts";
import { isBootstrapSuperadminLogin } from "./bootstrap-login.ts";
import { normalizePhone } from "./phone.ts";
import { applyRls } from "./rls.ts";
import { writePlatformAudit } from "./platform.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const OPERATOR_STATUSES = ["ACTIVE", "SUSPENDED", "DISABLED", "PENDING_VERIFICATION"] as const;
export type OperatorStatus = (typeof OPERATOR_STATUSES)[number];

const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password12",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein1",
  "admin123",
  "welcome1",
  "ispsolutions",
  "changeme1",
  "superadmin",
]);

const LOCK_AFTER = 5;
const LOCK_MINUTES = 15;

export const INVALID_LOGIN_MESSAGE = "Invalid username or password";
export const LOCKOUT_MESSAGE = "Too many sign-in attempts from this network. Wait a minute and try again.";

export type OperatorProfile = {
  user_id: string;
  email: string;
  name: string;
  image: string | null;
  phone: string;
  first_name: string;
  last_name: string;
  display_name: string;
  status: OperatorStatus;
  email_verified_at: string | null;
  phone_verified_at: string | null;
  last_login_at: string | null;
  last_login_ip: string;
  password_changed_at: string | null;
  failed_login_attempts: number;
  locked_until: string | null;
  is_default_password: boolean;
  platform_admin: boolean;
  tenants: { id: string; name: string; role: string }[];
};

export function assertPasswordPolicy(password: string) {
  const next = String(password || "");
  if (next.length < 8) throw new Error("Password must be at least 8 characters");
  if (COMMON_PASSWORDS.has(next.toLowerCase())) throw new Error("Choose a less common password");
  return next;
}

export async function ensureOperatorProfile(
  sql: Sql,
  userId: string,
  seed: { phone?: string; firstName?: string; lastName?: string; displayName?: string } = {},
) {
  await applyRls(sql, { bypass: true });
  const [existing] = await sql<{ user_id: string }>`select user_id from operator_profiles where user_id = ${userId}`;
  if (existing) return;
  const user = await loadAuthUser(sql, userId);
  const parts = (user?.name || "").trim().split(/\s+/);
  const first = (seed.firstName || parts[0] || "").slice(0, 80);
  const last = (seed.lastName || parts.slice(1).join(" ") || "").slice(0, 80);
  const display = (seed.displayName || user?.name || "").slice(0, 120);
  const phone = seed.phone ? normalizePhone(seed.phone) : "";
  await sql`insert into operator_profiles
    (user_id, phone, first_name, last_name, display_name, status, email_verified_at)
    values (${userId}, ${phone}, ${first}, ${last}, ${display}, ${"ACTIVE"}, now())
    on conflict (user_id) do nothing`;
}

export async function loadOperatorProfile(sql: Sql, userId: string): Promise<OperatorProfile | null> {
  await applyRls(sql, { bypass: true });
  await ensureOperatorProfile(sql, userId);
  const [row] = await sql<{
    user_id: string;
    email: string;
    name: string;
    image: string | null;
    phone: string;
    first_name: string;
    last_name: string;
    display_name: string;
    status: OperatorStatus;
    email_verified_at: string | null;
    phone_verified_at: string | null;
    last_login_at: string | null;
    last_login_ip: string;
    password_changed_at: string | null;
    failed_login_attempts: number;
    locked_until: string | null;
    is_default_password: boolean;
  }>`select p.user_id, u.email, u.name, u.image,
           p.phone, p.first_name, p.last_name, p.display_name, p.status,
           p.email_verified_at::text, p.phone_verified_at::text, p.last_login_at::text,
           p.last_login_ip, p.password_changed_at::text, p.failed_login_attempts, p.locked_until::text,
           coalesce(p.is_default_password, false) as is_default_password
     from operator_profiles p
     join "user" u on u.id = p.user_id
     where p.user_id = ${userId}`;
  if (!row) return null;
  const tenants = await sql<{ id: string; name: string; role: string }>`
    select t.id, t.name, m.role from tenant_members m
    join tenants t on t.id = m.tenant_id
    where m.user_id = ${userId} order by t.name`;
  return { ...row, platform_admin: await isPlatformAdmin(sql, userId), tenants };
}

export async function findOperatorByIdentifier(sql: Sql, identifier: string) {
  await applyRls(sql, { bypass: true });
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  if (trimmed.includes("@") || isBootstrapSuperadminLogin(trimmed)) {
    const user = await findAuthUserByEmail(sql, trimmed);
    if (!user) return null;
    await ensureOperatorProfile(sql, user.id);
    return user;
  }
  const digits = normalizePhone(trimmed);
  const last9 = digits.slice(-9);
  if (last9.length < 9) return null;
  const [row] = await sql<{ id: string; name: string; email: string }>`
    select u.id, u.name, u.email from operator_profiles p
    join "user" u on u.id = p.user_id
    where right(regexp_replace(p.phone, '\\D', '', 'g'), 9) = ${last9}
    limit 1`;
  return row ?? null;
}

export async function assertOperatorCanSignIn(sql: Sql, email: string) {
  await applyRls(sql, { bypass: true });
  const user = await findAuthUserByEmail(sql, email);
  if (!user) return { email: email.trim().toLowerCase() };
  await ensureOperatorProfile(sql, user.id);
  const [row] = await sql<{ status: string; locked_until: string | null }>`
    select status, locked_until::text as locked_until from operator_profiles where user_id = ${user.id}`;
  if (row?.status === "SUSPENDED" || row?.status === "DISABLED") {
    throw new Error(INVALID_LOGIN_MESSAGE);
  }
  if (row?.locked_until && Date.parse(row.locked_until) > Date.now()) {
    throw new Error(LOCKOUT_MESSAGE);
  }
  return { email: user.email };
}

export async function recordOperatorLogin(sql: Sql, userId: string, ip = "") {
  await applyRls(sql, { bypass: true });
  await ensureOperatorProfile(sql, userId);
  const [was] = await sql<{ failed_login_attempts: number }>`
    select failed_login_attempts from operator_profiles where user_id = ${userId}`;
  await sql`update operator_profiles
    set last_login_at = now(), last_login_ip = ${ip.slice(0, 64)}, failed_login_attempts = 0,
        locked_until = null, updated_at = now()
    where user_id = ${userId}`;
  await writePlatformAudit(sql, {
    actorUserId: userId,
    action: "LOGIN_SUCCESS",
    entityType: "user",
    entityId: userId,
    metadata: { ip: ip.slice(0, 64) },
  });
  if ((was?.failed_login_attempts || 0) > 0) {
    await writePlatformAudit(sql, {
      actorUserId: userId,
      action: "ACCOUNT_UNLOCKED",
      entityType: "user",
      entityId: userId,
    });
  }
}

export async function recordOperatorLoginFailure(sql: Sql, email: string, ip = "") {
  await applyRls(sql, { bypass: true });
  const user = await findAuthUserByEmail(sql, email);
  await writePlatformAudit(sql, {
    actorUserId: user?.id || "",
    action: "LOGIN_FAILED",
    entityType: "user",
    entityId: user?.id || "",
    metadata: { ip: ip.slice(0, 64) },
  });
  if (!user) return;
  await ensureOperatorProfile(sql, user.id);
  const [row] = await sql<{ failed_login_attempts: number }>`
    update operator_profiles
      set failed_login_attempts = failed_login_attempts + 1, updated_at = now()
      where user_id = ${user.id}
      returning failed_login_attempts`;
  if ((row?.failed_login_attempts || 0) >= LOCK_AFTER) {
    await sql`update operator_profiles
      set locked_until = now() + (${LOCK_MINUTES} * interval '1 minute'), updated_at = now()
      where user_id = ${user.id}`;
    await writePlatformAudit(sql, {
      actorUserId: user.id,
      action: "ACCOUNT_LOCKED",
      entityType: "user",
      entityId: user.id,
      metadata: { minutes: LOCK_MINUTES },
    });
  }
}

export async function updateOwnProfile(
  sql: Sql,
  userId: string,
  patch: { first_name?: string; last_name?: string; display_name?: string; phone?: string; image?: string },
) {
  await applyRls(sql, { bypass: true });
  await ensureOperatorProfile(sql, userId);
  const first = patch.first_name != null ? patch.first_name.trim().slice(0, 80) : undefined;
  const last = patch.last_name != null ? patch.last_name.trim().slice(0, 80) : undefined;
  const display = patch.display_name != null ? patch.display_name.trim().slice(0, 120) : undefined;
  const phone = patch.phone != null ? (patch.phone.trim() ? normalizePhone(patch.phone) : "") : undefined;
  const current = await loadOperatorProfile(sql, userId);
  if (!current) throw new Error("Account not found");
  const nextFirst = first ?? current.first_name;
  const nextLast = last ?? current.last_name;
  const nextDisplay = display ?? current.display_name ?? `${nextFirst} ${nextLast}`.trim();
  const nextPhone = phone ?? current.phone;
  await sql`update operator_profiles
    set first_name = ${nextFirst}, last_name = ${nextLast}, display_name = ${nextDisplay},
        phone = ${nextPhone}, updated_at = now()
    where user_id = ${userId}`;
  const name = nextDisplay || `${nextFirst} ${nextLast}`.trim() || current.name;
  if (patch.image != null) {
    const image = patch.image.trim().slice(0, 500) || null;
    await sql`update "user" set name = ${name}, image = ${image}, "updatedAt" = now() where id = ${userId}`;
  } else {
    await sql`update "user" set name = ${name}, "updatedAt" = now() where id = ${userId}`;
  }
  return loadOperatorProfile(sql, userId);
}

export async function markPasswordChanged(sql: Sql, userId: string) {
  await applyRls(sql, { bypass: true });
  await ensureOperatorProfile(sql, userId);
  const [was] = await sql<{ is_default_password: boolean }>`
    select coalesce(is_default_password, false) as is_default_password from operator_profiles where user_id = ${userId}`;
  await sql`update operator_profiles
    set password_changed_at = now(), failed_login_attempts = 0, locked_until = null,
        is_default_password = false, updated_at = now()
    where user_id = ${userId}`;
  if (was?.is_default_password) {
    await writePlatformAudit(sql, {
      actorUserId: userId,
      action: "PLATFORM_SUPERADMIN_DEFAULT_PASSWORD_CHANGED",
      entityType: "user",
      entityId: userId,
    });
  }
}

export async function revokeUserSessions(sql: Sql, userId: string, actorUserId: string) {
  await applyRls(sql, { bypass: true });
  await sql`delete from session where "userId" = ${userId}`;
  await writePlatformAudit(sql, {
    actorUserId,
    action: "SESSION_REVOKED",
    entityType: "user",
    entityId: userId,
  });
  return { ok: true };
}

export async function setOperatorStatus(
  sql: Sql,
  actorUserId: string,
  userId: string,
  status: OperatorStatus,
) {
  if (!OPERATOR_STATUSES.includes(status)) throw new Error("Unknown status");
  await applyRls(sql, { bypass: true });
  await ensureOperatorProfile(sql, userId);
  await sql`update operator_profiles set status = ${status}, updated_at = now() where user_id = ${userId}`;
  if (status === "SUSPENDED" || status === "DISABLED") {
    await sql`delete from session where "userId" = ${userId}`;
    await writePlatformAudit(sql, {
      actorUserId,
      action: "USER_SUSPENDED",
      entityType: "user",
      entityId: userId,
      metadata: { status },
    });
  } else {
    await writePlatformAudit(sql, {
      actorUserId,
      action: "USER_REACTIVATED",
      entityType: "user",
      entityId: userId,
      metadata: { status },
    });
  }
  return loadOperatorProfile(sql, userId);
}

export async function writeLogoutAudit(sql: Sql, userId: string) {
  await writePlatformAudit(sql, {
    actorUserId: userId,
    action: "LOGOUT",
    entityType: "user",
    entityId: userId,
  });
}

export function splitName(name: string) {
  const parts = name.trim().split(/\s+/);
  return { first_name: parts[0] || "", last_name: parts.slice(1).join(" ") };
}

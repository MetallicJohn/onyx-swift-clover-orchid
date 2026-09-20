import { nid } from "../utils.ts";
import {
  createCredentialAccount,
  isPlatformAdmin,
  loadAuthUser,
  setCredentialPassword,
} from "./accounts.ts";
import { isTenantRole } from "./members.ts";
import {
  assertPasswordPolicy,
  ensureOperatorProfile,
  loadOperatorProfile,
  OPERATOR_STATUSES,
  revokeUserSessions,
  setOperatorStatus,
  type OperatorStatus,
} from "./operator-security.ts";
import { writePlatformAudit } from "./platform.ts";
import { applyRls } from "./rls.ts";
import { normalizePhone } from "./phone.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function listPlatformUsers(
  sql: Sql,
  actorUserId: string,
  opts: { q?: string; status?: string; page?: number; pageSize?: number } = {},
) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  await applyRls(sql, { bypass: true });
  const pageSize = Math.min(50, Math.max(10, opts.pageSize || 25));
  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * pageSize;
  const q = (opts.q || "").trim().toLowerCase();
  const status = (opts.status || "").trim().toUpperCase();
  const rows = await sql<{
    id: string;
    email: string;
    name: string;
    phone: string;
    status: string;
    last_login_at: string | null;
    platform_admin: boolean;
    tenant_count: number;
  }>`
    select u.id, u.email, u.name,
           coalesce(p.phone, '') as phone,
           coalesce(p.status, 'ACTIVE') as status,
           p.last_login_at::text as last_login_at,
           exists(select 1 from platform_admins a where a.user_id = u.id) as platform_admin,
           (select count(*)::int from tenant_members m where m.user_id = u.id) as tenant_count
    from "user" u
    left join operator_profiles p on p.user_id = u.id
    where (${q} = '' or lower(u.email) like ${"%" + q + "%"} or lower(u.name) like ${"%" + q + "%"} or p.phone like ${"%" + q + "%"})
      and (${status} = '' or coalesce(p.status, 'ACTIVE') = ${status})
    order by u."createdAt" desc
    limit ${pageSize} offset ${offset}`;
  const [n] = await sql<{ n: number }>`
    select count(*)::int as n from "user" u
    left join operator_profiles p on p.user_id = u.id
    where (${q} = '' or lower(u.email) like ${"%" + q + "%"} or lower(u.name) like ${"%" + q + "%"} or p.phone like ${"%" + q + "%"})
      and (${status} = '' or coalesce(p.status, 'ACTIVE') = ${status})`;
  return { users: rows, total: n?.n ?? 0, page, pageSize };
}

export async function getPlatformUser(sql: Sql, actorUserId: string, userId: string) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  const profile = await loadOperatorProfile(sql, userId);
  if (!profile) throw new Error("User not found");
  const sessions = await sql<{ id: string; created_at: string; expires_at: string; ip_address: string | null }>`
    select id, "createdAt"::text as created_at, "expiresAt"::text as expires_at, "ipAddress" as ip_address
    from session where "userId" = ${userId} order by "createdAt" desc limit 20`;
  const events = await sql<{ action: string; created_at: string; metadata: string }>`
    select action, created_at::text as created_at, metadata from platform_audit_log
    where entity_id = ${userId} or actor_user_id = ${userId}
    order by created_at desc limit 30`;
  return { profile, sessions, events };
}

export async function createPlatformUser(
  sql: Sql,
  actorUserId: string,
  opts: {
    email: string;
    name: string;
    password: string;
    phone?: string;
    tenant_id?: string;
    role?: string;
    platform_admin?: boolean;
  },
) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  assertPasswordPolicy(opts.password);
  const user = await createCredentialAccount(sql, {
    email: opts.email,
    password: opts.password,
    name: opts.name,
  });
  await ensureOperatorProfile(sql, user.id, { phone: opts.phone, displayName: opts.name });
  if (opts.phone) {
    const phone = normalizePhone(opts.phone);
    await sql`update operator_profiles set phone = ${phone}, updated_at = now() where user_id = ${user.id}`;
  }
  if (opts.tenant_id) {
    const role = opts.role && isTenantRole(opts.role) ? opts.role : "isp_admin";
    await sql`insert into tenant_members (id, tenant_id, user_id, role)
      values (${nid("mem")}, ${opts.tenant_id}, ${user.id}, ${role})
      on conflict (tenant_id, user_id) do update set role = ${role}`;
  }
  if (opts.platform_admin) {
    await sql`insert into platform_admins (user_id) values (${user.id}) on conflict (user_id) do nothing`;
  }
  await writePlatformAudit(sql, {
    actorUserId,
    action: "USER_CREATED",
    entityType: "user",
    entityId: user.id,
    tenantId: opts.tenant_id,
    metadata: { email: user.email, platform_admin: Boolean(opts.platform_admin) },
  });
  return loadOperatorProfile(sql, user.id);
}

export async function updatePlatformUser(
  sql: Sql,
  actorUserId: string,
  userId: string,
  patch: {
    first_name?: string;
    last_name?: string;
    display_name?: string;
    phone?: string;
    status?: string;
    platform_admin?: boolean;
    tenant_id?: string;
    role?: string;
  },
) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  if (userId === actorUserId && patch.platform_admin === false) {
    throw new Error("You cannot remove your own Superadmin access");
  }
  await ensureOperatorProfile(sql, userId);
  if (patch.first_name != null || patch.last_name != null || patch.display_name != null || patch.phone != null) {
    const { updateOwnProfile } = await import("./operator-security.ts");
    await updateOwnProfile(sql, userId, patch);
  }
  if (patch.status && OPERATOR_STATUSES.includes(patch.status as OperatorStatus)) {
    await setOperatorStatus(sql, actorUserId, userId, patch.status as OperatorStatus);
  }
  if (patch.platform_admin === true) {
    await sql`insert into platform_admins (user_id) values (${userId}) on conflict (user_id) do nothing`;
    await writePlatformAudit(sql, {
      actorUserId,
      action: "ROLE_CHANGED",
      entityType: "user",
      entityId: userId,
      metadata: { platform_admin: true },
    });
  }
  if (patch.platform_admin === false) {
    await sql`delete from platform_admins where user_id = ${userId}`;
    await writePlatformAudit(sql, {
      actorUserId,
      action: "ROLE_CHANGED",
      entityType: "user",
      entityId: userId,
      metadata: { platform_admin: false },
    });
  }
  if (patch.tenant_id && patch.role) {
    if (!isTenantRole(patch.role)) throw new Error("Unknown role");
    await sql`insert into tenant_members (id, tenant_id, user_id, role)
      values (${nid("mem")}, ${patch.tenant_id}, ${userId}, ${patch.role})
      on conflict (tenant_id, user_id) do update set role = ${patch.role}`;
    await writePlatformAudit(sql, {
      actorUserId,
      action: "ROLE_CHANGED",
      entityType: "user",
      entityId: userId,
      tenantId: patch.tenant_id,
      metadata: { role: patch.role },
    });
  }
  return loadOperatorProfile(sql, userId);
}

export async function forcePasswordReset(
  sql: Sql,
  actorUserId: string,
  userId: string,
  password: string,
) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  assertPasswordPolicy(password);
  const user = await loadAuthUser(sql, userId);
  if (!user) throw new Error("User not found");
  await setCredentialPassword(sql, user.email, password);
  const { markPasswordChanged } = await import("./operator-security.ts");
  await markPasswordChanged(sql, userId);
  await writePlatformAudit(sql, {
    actorUserId,
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "user",
    entityId: userId,
    metadata: { forced: true },
  });
  return { email: user.email };
}

export async function revokePlatformUserSessions(sql: Sql, actorUserId: string, userId: string) {
  if (!(await isPlatformAdmin(sql, actorUserId))) throw new Error("Forbidden");
  return revokeUserSessions(sql, userId, actorUserId);
}

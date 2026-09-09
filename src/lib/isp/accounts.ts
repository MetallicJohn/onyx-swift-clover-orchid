import { hashPassword, verifyPassword } from "better-auth/crypto";
import { nid, slugify } from "../utils.ts";
import { isTenantRole } from "./members.ts";
import { permissionsFor } from "./rbac.ts";
import { applyRls } from "./rls.ts";
import { resolveActiveTenant, setActiveTenant, type TenantContext } from "./tenant-context.ts";
import type { TenantRole } from "./types.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type AuthUser = { id: string; name: string; email: string };

export async function loadAuthUser(sql: Sql, userId: string): Promise<AuthUser | null> {
  const [row] = await sql<AuthUser>`
    select id, name, email from "user" where id = ${userId}`;
  return row ?? null;
}

export async function findAuthUserByEmail(sql: Sql, email: string): Promise<AuthUser | null> {
  const trimmed = email.trim().toLowerCase();
  const [row] = await sql<AuthUser>`
    select id, name, email from "user" where lower(email) = ${trimmed}`;
  return row ?? null;
}

/** Create (or attach) a Better Auth email/password credential. Does not start a session. */
export async function createCredentialAccount(
  sql: Sql,
  opts: { email: string; password: string; name: string },
): Promise<AuthUser & { created: boolean }> {
  const email = opts.email.trim().toLowerCase();
  const name = opts.name.trim() || email.split("@")[0] || "Operator";
  const password = opts.password;
  if (!email.includes("@")) throw new Error("Enter a valid email");
  if (password.length < 8) throw new Error("Password must be at least 8 characters");

  const existing = await findAuthUserByEmail(sql, email);
  const hashed = await hashPassword(password);

  if (existing) {
    const [cred] = await sql<{ id: string }>`
      select id from account where "userId" = ${existing.id} and "providerId" = 'credential'`;
    if (cred) throw new Error("An account with that email already exists. They can sign in.");
    const accountId = crypto.randomUUID();
    await sql`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values (${accountId}, ${existing.id}, 'credential', ${existing.id}, ${hashed}, now(), now())`;
    if (name && name !== existing.name) {
      await sql`update "user" set name = ${name}, "updatedAt" = now() where id = ${existing.id}`;
    }
    if (!(await passwordVerifies(sql, email, password))) {
      throw new Error("Could not store a sign-in password for that email");
    }
    return { id: existing.id, name: name || existing.name, email: existing.email, created: false };
  }

  const userId = crypto.randomUUID();
  const accountId = crypto.randomUUID();
  await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values (${userId}, ${name}, ${email}, true, now(), now())`;
  await sql`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    values (${accountId}, ${userId}, 'credential', ${userId}, ${hashed}, now(), now())`;
  if (!(await passwordVerifies(sql, email, password))) {
    throw new Error("Could not store a sign-in password for that email");
  }
  return { id: userId, name, email, created: true };
}

export async function passwordVerifies(sql: Sql, email: string, password: string) {
  const user = await findAuthUserByEmail(sql, email);
  if (!user) return false;
  const [cred] = await sql<{ password: string }>`
    select password from account where "userId" = ${user.id} and "providerId" = 'credential'`;
  if (!cred?.password) return false;
  return verifyPassword({ hash: cred.password, password });
}

export async function isPlatformAdmin(sql: Sql, userId: string) {
  const [row] = await sql<{ user_id: string }>`
    select user_id from platform_admins where user_id = ${userId}`;
  return Boolean(row);
}

export async function ensureFirstPlatformAdmin(sql: Sql, userId: string) {
  const [n] = await sql<{ n: number }>`select count(*)::int as n from platform_admins`;
  if ((n?.n ?? 0) > 0) return isPlatformAdmin(sql, userId);
  await sql`insert into platform_admins (user_id) values (${userId})
    on conflict (user_id) do nothing`;
  return true;
}

function toWorkspace(opts: {
  tenantId: string;
  name: string;
  slug: string;
  email: string;
  role: TenantRole;
}): TenantContext {
  return {
    tenantId: opts.tenantId,
    tenantName: opts.name,
    slug: opts.slug,
    status: "trial",
    currency: "KES",
    role: opts.role,
    supportEmail: opts.email,
    supportPhone: "",
    permissions: permissionsFor(opts.role),
  };
}

/** Create an ISP tenant for a user who has none. No-op when they already belong somewhere. */
export async function provisionTenant(
  sql: Sql,
  userId: string,
  opts: { ispName?: string | null; personName?: string | null; email?: string | null } = {},
): Promise<TenantContext> {
  await applyRls(sql, { bypass: true });
  const existing = await resolveActiveTenant(sql, userId);
  if (existing) return existing;

  const profile = await loadAuthUser(sql, userId);
  const person = (opts.personName || profile?.name || opts.email || profile?.email || "New ISP").trim();
  const email = (opts.email || profile?.email || "").trim();
  const ispName = (opts.ispName || "").trim() || `${person.split("@")[0]}'s Network`;
  const tenantId = nid("ten");
  const slug = `${slugify(ispName)}-${tenantId.slice(-6)}`;

  await sql`insert into tenants (id, name, slug, status, currency, timezone, support_email)
    values (${tenantId}, ${ispName}, ${slug}, 'trial', 'KES', 'Africa/Nairobi', ${email})`;
  await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${userId}, 'isp_owner')`;
  await setActiveTenant(sql, userId, tenantId);
  await ensureFirstPlatformAdmin(sql, userId);
  await applyRls(sql, { tenantId, bypass: false });
  return toWorkspace({ tenantId, name: ispName, slug, email, role: "isp_owner" });
}

export async function addStaffMember(
  sql: Sql,
  tenantId: string,
  opts: { email: string; role: string; name?: string; password?: string },
) {
  if (!isTenantRole(opts.role)) throw new Error("Unknown role");
  const email = opts.email.trim().toLowerCase();
  const password = (opts.password || "").trim();
  let user: AuthUser;

  if (password) {
    const created = await createCredentialAccount(sql, {
      email,
      password,
      name: opts.name || email.split("@")[0] || "Staff",
    });
    user = created;
  } else {
    const found = await findAuthUserByEmail(sql, email);
    if (!found) {
      throw new Error("Set a password to create their login, or they must sign up first.");
    }
    user = found;
  }

  const existing = await sql<{ id: string }>`
    select id from tenant_members where tenant_id = ${tenantId} and user_id = ${user.id}`;
  if (existing[0]) throw new Error("Already a member of this ISP");
  await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${user.id}, ${opts.role})`;
  return { user_id: user.id, email: user.email, name: user.name, role: opts.role as TenantRole };
}

export async function createIspWithOwner(
  sql: Sql,
  opts: { ispName: string; ownerName: string; ownerEmail: string; ownerPassword: string },
) {
  const ispName = opts.ispName.trim();
  if (!ispName) throw new Error("ISP name is required");
  const owner = await createCredentialAccount(sql, {
    email: opts.ownerEmail,
    password: opts.ownerPassword,
    name: opts.ownerName,
  });
  await applyRls(sql, { bypass: true });
  const already = await sql<{ id: string }>`
    select id from tenant_members where user_id = ${owner.id} limit 1`;
  if (already[0]) {
    throw new Error("That email already belongs to an ISP. Sign in instead, or pick another email.");
  }
  const tenantId = nid("ten");
  const slug = `${slugify(ispName)}-${tenantId.slice(-6)}`;
  await sql`insert into tenants (id, name, slug, status, currency, timezone, support_email)
    values (${tenantId}, ${ispName}, ${slug}, 'trial', 'KES', 'Africa/Nairobi', ${owner.email})`;
  await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${owner.id}, 'isp_owner')`;
  await setActiveTenant(sql, owner.id, tenantId);
  await ensureFirstPlatformAdmin(sql, owner.id);
  return {
    tenant_id: tenantId,
    tenant_name: ispName,
    slug,
    owner_email: owner.email,
    owner_id: owner.id,
  };
}

export async function listAllTenants(sql: Sql) {
  await applyRls(sql, { bypass: true });
  return sql<{
    id: string;
    name: string;
    slug: string;
    status: string;
    created_at: string;
    members: number;
  }>`
    select t.id, t.name, t.slug, t.status, t.created_at::text as created_at,
           (select count(*)::int from tenant_members m where m.tenant_id = t.id) as members
    from tenants t
    order by t.created_at desc`;
}

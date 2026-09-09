import { permissionsFor, type Permission } from "./rbac";
import type { TenantRole, Workspace } from "./types";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type TenantContext = Workspace & {
  role: TenantRole;
  permissions: Permission[];
};

export async function listMemberships(sql: Sql, userId: string) {
  return sql<{ tenant_id: string; name: string; slug: string; role: TenantRole; status: string; currency: string; support_email: string; support_phone: string }>`
    select t.id as tenant_id, t.name, t.slug, m.role, t.status, t.currency, t.support_email, t.support_phone
    from tenant_members m
    join tenants t on t.id = m.tenant_id
    where m.user_id = ${userId}
    order by t.name`;
}

async function membership(sql: Sql, userId: string, tenantId: string) {
  const [row] = await sql<{
    tenant_id: string;
    name: string;
    slug: string;
    role: TenantRole;
    status: string;
    currency: string;
    support_email: string;
    support_phone: string;
  }>`select t.id as tenant_id, t.name, t.slug, m.role, t.status, t.currency, t.support_email, t.support_phone
     from tenant_members m
     join tenants t on t.id = m.tenant_id
     where m.user_id = ${userId} and t.id = ${tenantId}`;
  return row ?? null;
}

function toWorkspace(row: {
  tenant_id: string;
  name: string;
  slug: string;
  role: TenantRole;
  status: string;
  currency: string;
  support_email: string;
  support_phone: string;
}): TenantContext {
  return {
    tenantId: row.tenant_id,
    tenantName: row.name,
    slug: row.slug,
    status: row.status,
    currency: row.currency,
    role: row.role,
    supportEmail: row.support_email,
    supportPhone: row.support_phone,
    permissions: permissionsFor(row.role),
  };
}

export async function setActiveTenant(sql: Sql, userId: string, tenantId: string) {
  const row = await membership(sql, userId, tenantId);
  if (!row) throw new Error("Not a member of that workspace");
  await sql`insert into user_active_tenant (user_id, tenant_id, updated_at)
    values (${userId}, ${tenantId}, now())
    on conflict (user_id) do update set tenant_id = ${tenantId}, updated_at = now()`;
  return toWorkspace(row);
}

export async function resolveActiveTenant(sql: Sql, userId: string): Promise<TenantContext | null> {
  const [active] = await sql<{ tenant_id: string }>`
    select tenant_id from user_active_tenant where user_id = ${userId}`;
  if (active?.tenant_id) {
    const row = await membership(sql, userId, active.tenant_id);
    if (row) return toWorkspace(row);
  }
  const members = await listMemberships(sql, userId);
  if (!members[0]) return null;
  await sql`insert into user_active_tenant (user_id, tenant_id, updated_at)
    values (${userId}, ${members[0].tenant_id}, now())
    on conflict (user_id) do update set tenant_id = ${members[0].tenant_id}, updated_at = now()`;
  return toWorkspace(members[0]);
}

import { APP_NAME } from "../brand.ts";
import { nid } from "../utils.ts";
import type { TenantRole } from "./types";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const ROLES: TenantRole[] = [
  "isp_owner",
  "isp_admin",
  "finance",
  "customer_care",
  "network_engineer",
  "technician",
];

export function isTenantRole(role: string): role is TenantRole {
  return ROLES.includes(role as TenantRole);
}

export async function addMemberByEmail(sql: Sql, tenantId: string, email: string, role: string) {
  if (!isTenantRole(role)) throw new Error("Unknown role");
  const trimmed = email.trim().toLowerCase();
  if (!trimmed.includes("@")) throw new Error("Enter an email");
  const [user] = await sql<{ id: string }>`select id from "user" where lower(email) = ${trimmed}`;
  if (!user) throw new Error(`They must sign in to ${APP_NAME} once before you can add them.`);
  const existing = await sql<{ id: string }>`
    select id from tenant_members where tenant_id = ${tenantId} and user_id = ${user.id}`;
  if (existing[0]) throw new Error("Already a member of this ISP");
  await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${user.id}, ${role})`;
  return { user_id: user.id, role };
}

export async function setMemberRole(sql: Sql, tenantId: string, userId: string, role: string) {
  if (!isTenantRole(role)) throw new Error("Unknown role");
  const [row] = await sql<{ role: string }>`
    select role from tenant_members where tenant_id = ${tenantId} and user_id = ${userId}`;
  if (!row) throw new Error("Member not found");
  if (row.role === "isp_owner" && role !== "isp_owner") {
    const owners = await sql<{ n: number }>`
      select count(*)::int as n from tenant_members where tenant_id = ${tenantId} and role = 'isp_owner'`;
    if ((owners[0]?.n ?? 0) <= 1) throw new Error("Keep at least one owner");
  }
  await sql`update tenant_members set role = ${role} where tenant_id = ${tenantId} and user_id = ${userId}`;
  return { ok: true };
}

export async function listBranches(sql: Sql, tenantId: string) {
  return sql<{ id: string; name: string; created_at: string }>`
    select id, name, created_at::text as created_at from tenant_branches
    where tenant_id = ${tenantId} order by name`;
}

export async function addBranch(sql: Sql, tenantId: string, name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Branch name required");
  const id = nid("brn");
  await sql`insert into tenant_branches (id, tenant_id, name) values (${id}, ${tenantId}, ${trimmed})`;
  return { id, name: trimmed };
}

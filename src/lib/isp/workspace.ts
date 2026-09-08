import { getSql } from "@/lib/db";
import { seedOpsForTenant } from "./access";
import { resolveActiveTenant } from "./tenant-context";

export async function requireWorkspace(userId: string) {
  const sql = await getSql();
  const ctx = await resolveActiveTenant(sql, userId);
  if (!ctx) throw new Error("No workspace");
  await seedOpsForTenant(sql, ctx.tenantId);
  return { sql, tenantId: ctx.tenantId, tenantName: ctx.tenantName, role: ctx.role };
}

export { requireWorkspace as requireWs };

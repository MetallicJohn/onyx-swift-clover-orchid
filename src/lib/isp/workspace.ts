import { getSql } from "../db.ts";
import { seedOpsForTenant } from "./access";
import { applyRls } from "./rls";
import { resolveActiveTenant } from "./tenant-context";

export async function requireWorkspace(userId: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const ctx = await resolveActiveTenant(sql, userId);
  if (!ctx) throw new Error("No workspace");
  await applyRls(sql, { tenantId: ctx.tenantId, bypass: false });
  await seedOpsForTenant(sql, ctx.tenantId);
  return { sql, tenantId: ctx.tenantId, tenantName: ctx.tenantName, role: ctx.role };
}

export { requireWorkspace as requireWs };

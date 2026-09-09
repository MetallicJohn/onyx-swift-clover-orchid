import { getSql } from "../db.ts";
import { seedOpsForTenant } from "./access";
import { provisionTenant } from "./accounts";
import { maybeRunAccessPolicy } from "./access-policy";
import { applyRls } from "./rls";
import { resolveActiveTenant } from "./tenant-context";

export async function requireWorkspace(userId: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const ctx = (await resolveActiveTenant(sql, userId)) ?? (await provisionTenant(sql, userId));
  await applyRls(sql, { tenantId: ctx.tenantId, bypass: false });
  await seedOpsForTenant(sql, ctx.tenantId);
  await maybeRunAccessPolicy(sql, ctx.tenantId, ctx.tenantName);
  return { sql, tenantId: ctx.tenantId, tenantName: ctx.tenantName, role: ctx.role };
}

export { requireWorkspace as requireWs };

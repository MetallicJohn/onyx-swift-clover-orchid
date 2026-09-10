import { getSql } from "../db.ts";
import { seedOpsForTenant } from "./access";
import { isPlatformAdmin, provisionTenant } from "./accounts";
import { maybeRunAccessPolicy } from "./access-policy";
import { applyRls } from "./rls";
import { resolveActiveTenant } from "./tenant-context";

export class PlatformOnlyError extends Error {
  code = "PLATFORM_ONLY" as const;
  constructor() {
    super("No ISP workspace. Open SaaS Management.");
  }
}

export async function requireWorkspace(userId: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  let ctx = await resolveActiveTenant(sql, userId);
  if (!ctx) {
    if (await isPlatformAdmin(sql, userId)) throw new PlatformOnlyError();
    ctx = await provisionTenant(sql, userId);
  }
  await applyRls(sql, { tenantId: ctx.tenantId, bypass: false });
  await seedOpsForTenant(sql, ctx.tenantId);
  await maybeRunAccessPolicy(sql, ctx.tenantId, ctx.tenantName);
  return { sql, tenantId: ctx.tenantId, tenantName: ctx.tenantName, role: ctx.role, workspace: ctx };
}

export { requireWorkspace as requireWs };
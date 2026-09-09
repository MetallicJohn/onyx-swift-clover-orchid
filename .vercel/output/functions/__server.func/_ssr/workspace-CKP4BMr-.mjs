import { b as applyRls, h as seedOpsForTenant } from "./access-1saCIo2_.mjs";
import { a as maybeRunAccessPolicy } from "./access-policy-BX1fKswR.mjs";
import { i as getSql } from "./db-Cj2MXHzY.mjs";
import { d as provisionTenant, f as resolveActiveTenant } from "./accounts-CrIvUMZR.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/workspace-CKP4BMr-.js
async function requireWorkspace(userId) {
	const sql = await getSql();
	await applyRls(sql, { bypass: true });
	const ctx = await resolveActiveTenant(sql, userId) ?? await provisionTenant(sql, userId);
	await applyRls(sql, {
		tenantId: ctx.tenantId,
		bypass: false
	});
	await seedOpsForTenant(sql, ctx.tenantId);
	await maybeRunAccessPolicy(sql, ctx.tenantId, ctx.tenantName);
	return {
		sql,
		tenantId: ctx.tenantId,
		tenantName: ctx.tenantName,
		role: ctx.role
	};
}
//#endregion
export { requireWorkspace as t };

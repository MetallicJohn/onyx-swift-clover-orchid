import { k as seedOpsForTenant, r as applyRls } from "./rls-stkZtAMF.mjs";
import { i as getSql } from "./db-BsfBburB.mjs";
import { n as resolveActiveTenant } from "./tenant-context-BsYaB9rN.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/workspace-CffEX4j5.js
async function requireWorkspace(userId) {
	const sql = await getSql();
	await applyRls(sql, { bypass: true });
	const ctx = await resolveActiveTenant(sql, userId);
	if (!ctx) throw new Error("No workspace");
	await applyRls(sql, {
		tenantId: ctx.tenantId,
		bypass: false
	});
	await seedOpsForTenant(sql, ctx.tenantId);
	return {
		sql,
		tenantId: ctx.tenantId,
		tenantName: ctx.tenantName,
		role: ctx.role
	};
}
//#endregion
export { requireWorkspace as t };

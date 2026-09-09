import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { c as enrollFields, n as agentScript, t as agentPullUrl } from "./access-1saCIo2_.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { t as requireWorkspace } from "./workspace-CKP4BMr-.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-routers-BxMg4SWG.js
async function loadRouter(sql, tenantId, id) {
	const [r] = await sql`
    select id, name, identity, location, role, enroll_token, wg_public, wg_address
    from routers where id = ${id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	return r;
}
async function scriptFor(sql, tenantId, r) {
	const [t] = await sql`select public_base_url from tenants where id = ${tenantId}`;
	return agentScript({
		name: r.name,
		identity: r.identity,
		token: r.enroll_token,
		wgPublic: r.wg_public,
		wgAddress: r.wg_address || "10.200.0.2/32",
		pullUrl: agentPullUrl(t?.public_base_url || "", r.enroll_token)
	});
}
var updateRouter_createServerFn_handler = createServerRpc({
	id: "88ab3927a37c1a5fb45d409fb855f48ce6963999678eb1a80ed60a8639a99c99",
	name: "updateRouter",
	filename: "src/lib/isp/server-routers.ts"
}, (opts) => updateRouter.__executeServer(opts));
var updateRouter = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(updateRouter_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	if (!data.name.trim()) throw new Error("Name is required");
	const r = await loadRouter(sql, tenantId, data.id);
	const identity = data.identity.trim() || data.name.trim().toLowerCase();
	await sql`update routers set
      name = ${data.name.trim()},
      location = ${data.location.trim()},
      identity = ${identity},
      role = ${data.role || r.role}
      where id = ${r.id} and tenant_id = ${tenantId}`;
	return {
		ok: true,
		script: await scriptFor(sql, tenantId, await loadRouter(sql, tenantId, r.id))
	};
});
var copyRouterScript_createServerFn_handler = createServerRpc({
	id: "13ab33f1cc1d5e511d9e4a1b9aa78f476539680d32af0bd48396cc83e93d6534",
	name: "copyRouterScript",
	filename: "src/lib/isp/server-routers.ts"
}, (opts) => copyRouterScript.__executeServer(opts));
var copyRouterScript = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(copyRouterScript_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const r = await loadRouter(sql, tenantId, data.id);
	if (data.rotate) {
		const enroll = enrollFields(r.name);
		await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_status = 'pending'
        where id = ${r.id} and tenant_id = ${tenantId}`;
		const next = await loadRouter(sql, tenantId, r.id);
		return {
			script: await scriptFor(sql, tenantId, next),
			token: next.enroll_token,
			rotated: true
		};
	}
	if (!r.enroll_token) {
		const enroll = enrollFields(r.name);
		await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}
        where id = ${r.id} and tenant_id = ${tenantId}`;
		const next = await loadRouter(sql, tenantId, r.id);
		return {
			script: await scriptFor(sql, tenantId, next),
			token: next.enroll_token,
			rotated: true
		};
	}
	return {
		script: await scriptFor(sql, tenantId, r),
		token: r.enroll_token,
		rotated: false
	};
});
//#endregion
export { copyRouterScript_createServerFn_handler, updateRouter_createServerFn_handler };

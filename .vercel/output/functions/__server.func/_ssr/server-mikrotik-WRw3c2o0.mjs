import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { t as authMiddleware } from "./middleware-BuXiR3_1.mjs";
import { a as curlForOps, i as compileRow, l as queueCompiledCommand, n as approveCommand, o as executeRestOps, r as compileMikrotik } from "./mikrotik-CpSXWGZs.mjs";
import { t as assertPermission } from "./tenant-context-BsYaB9rN.mjs";
import { t as requireWorkspace } from "./workspace-CffEX4j5.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-mikrotik-WRw3c2o0.js
function hint(secret) {
	if (!secret) return "";
	return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}
var getRouterApi_createServerFn_handler = createServerRpc({
	id: "2c7d38a323f7060a64084bb37c50743b4eacce5a84b2ef1d83801a66ed1bae2f",
	name: "getRouterApi",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => getRouterApi.__executeServer(opts));
var getRouterApi = createServerFn({ method: "GET" }).middleware([authMiddleware]).validator((d) => d).handler(getRouterApi_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [r] = await sql`select id, name, identity, enroll_token, api_user, api_password, api_port, api_host, wg_address
       from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	const [t] = await sql`select public_base_url from tenants where id = ${tenantId}`;
	const base = (t?.public_base_url || "").replace(/\/$/, "");
	return {
		id: r.id,
		name: r.name,
		identity: r.identity,
		api_user: r.api_user || "gridline",
		api_port: r.api_port || 443,
		api_host: r.api_host,
		wg_address: r.wg_address,
		api_password_set: Boolean(r.api_password),
		api_password_hint: hint(r.api_password),
		json_pull: base ? `${base}/api/agent/pull?token=${encodeURIComponent(r.enroll_token)}` : "",
		script_pull: base ? `${base}/api/agent/script?token=${encodeURIComponent(r.enroll_token)}` : ""
	};
});
var saveRouterApi_createServerFn_handler = createServerRpc({
	id: "17c9a3fe57a18486bd60f5036522922767e22f7d861f22899deb3a17576e1220",
	name: "saveRouterApi",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => saveRouterApi.__executeServer(opts));
var saveRouterApi = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(saveRouterApi_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [r] = await sql`
      select id, api_password from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	const password = !data.api_password || data.api_password.startsWith("••••") ? r.api_password : data.api_password;
	await sql`update routers set
      api_user = ${data.api_user.trim() || "gridline"},
      api_password = ${password},
      api_port = ${data.api_port || 443},
      api_host = ${data.api_host.trim()}
      where id = ${r.id}`;
	return { ok: true };
});
var queueRouterCommand_createServerFn_handler = createServerRpc({
	id: "3cd2cda27fc0b96acc2e818b8b8fa5942d8cdf01fcc5916eeaec565b1a53bcb2",
	name: "queueRouterCommand",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => queueRouterCommand.__executeServer(opts));
var queueRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(queueRouterCommand_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "routers.manage");
	const [r] = await sql`select id from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	return queueCompiledCommand(sql, tenantId, r.id, data.kind, data.payload, context.userId);
});
var approveRouterCommand_createServerFn_handler = createServerRpc({
	id: "ba96a44f28cb314113fd2de99355278a9e4682505f11c38fb1fbe6d5e019b2b2",
	name: "approveRouterCommand",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => approveRouterCommand.__executeServer(opts));
var approveRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(approveRouterCommand_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "routers.manage");
	return approveCommand(sql, tenantId, data.id, context.userId);
});
var previewRouterCommand_createServerFn_handler = createServerRpc({
	id: "3827f211bbd82335627e9c0710c0cf44850078235f38fff50f2902091fb86b86",
	name: "previewRouterCommand",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => previewRouterCommand.__executeServer(opts));
var previewRouterCommand = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(previewRouterCommand_createServerFn_handler, async ({ data }) => {
	const compiled = compileMikrotik(data.kind, data.payload);
	return {
		...compiled,
		curl: curlForOps(data.host || "https://10.200.0.2", data.user || "gridline", compiled.rest)
	};
});
var runRouterApi_createServerFn_handler = createServerRpc({
	id: "c8c89d4b52f204e1aa3c069694f76ae89143c716f7213999748c3c2ce819ba1d",
	name: "runRouterApi",
	filename: "src/lib/isp/server-mikrotik.ts"
}, (opts) => runRouterApi.__executeServer(opts));
var runRouterApi = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(runRouterApi_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "routers.manage");
	const [r] = await sql`select id, api_user, api_password, api_port, api_host, wg_address
       from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	let compiled = data.kind ? compileMikrotik(data.kind, data.payload || {}) : null;
	if (data.command_id) {
		const [cmd] = await sql`
        select id, kind, payload from agent_commands where id = ${data.command_id} and tenant_id = ${tenantId}`;
		if (!cmd) throw new Error("Command not found");
		compiled = compileRow(cmd.id, cmd.kind, cmd.payload);
	}
	if (!compiled) throw new Error("Nothing to run");
	const host = r.api_host || r.wg_address.replace(/\/\d+$/, "");
	if (!host || !r.api_password) {
		if (data.command_id) await sql`update agent_commands set status = 'acked', acked_at = now(), result = 'simulated REST (no api_host)'
          where id = ${data.command_id}`;
		return {
			simulated: true,
			rest: compiled.rest,
			note: "No API host — command compiled and marked simulated."
		};
	}
	const results = await executeRestOps(host, r.api_user || "gridline", r.api_password, r.api_port || 443, compiled.rest);
	if (data.command_id) await sql`update agent_commands set status = 'acked', acked_at = now(), result = ${JSON.stringify(results).slice(0, 2e3)}
        where id = ${data.command_id}`;
	return {
		simulated: false,
		results,
		rest: compiled.rest
	};
});
//#endregion
export { approveRouterCommand_createServerFn_handler, getRouterApi_createServerFn_handler, previewRouterCommand_createServerFn_handler, queueRouterCommand_createServerFn_handler, runRouterApi_createServerFn_handler, saveRouterApi_createServerFn_handler };

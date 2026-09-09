import { r as createServerFn } from "./_ssr/ssr.mjs";
import { t as createServerRpc } from "./_ssr/createServerRpc-CcvdN_gc.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/__root-D7KvvmCR.js
var fetchSessionUser_createServerFn_handler = createServerRpc({
	id: "2c4985e96c199268f7f639534cb5e8e31d6b19d43286bf77416413db60ffde26",
	name: "fetchSessionUser",
	filename: "src/routes/__root.tsx"
}, (opts) => fetchSessionUser.__executeServer(opts));
var fetchSessionUser = createServerFn({ method: "GET" }).handler(fetchSessionUser_createServerFn_handler, async () => {
	const { getRequest } = await import("./_ssr/ssr.mjs").then((n) => n.s).then((n) => n.t);
	const { GATE_IDENTITY_HEADER } = await import("./_ssr/gate-identity.server-LG3T69M-.mjs").then((n) => n.a).then((n) => n.a);
	const headers = getRequest()?.headers;
	if (headers?.get(GATE_IDENTITY_HEADER) && !headers.get("authorization")) return null;
	const { getSessionUser } = await import("./_ssr/verify.server-Cpjw8Pgg.mjs");
	const u = await getSessionUser();
	return u ? {
		id: u.id,
		email: u.email
	} : null;
});
//#endregion
export { fetchSessionUser_createServerFn_handler };

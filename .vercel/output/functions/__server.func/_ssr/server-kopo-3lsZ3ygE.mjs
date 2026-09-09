import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { M as nid, O as hint$1, R as seal } from "./access-1saCIo2_.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { i as loadKopo, t as kopoAccessToken } from "./kopokopo-DzVq-jg7.mjs";
import { t as requireWorkspace } from "./workspace-CKP4BMr-.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-kopo-3lsZ3ygE.js
var getKopokopo_createServerFn_handler = createServerRpc({
	id: "12b9094c5087afcc1d9bfae5c8dfdc7382133df3ef681bac797e668d052b8149",
	name: "getKopokopo",
	filename: "src/lib/isp/server-kopo.ts"
}, (opts) => getKopokopo.__executeServer(opts));
var getKopokopo = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getKopokopo_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [row] = await sql`select id, enabled, sandbox, client_id, client_secret, till_number
       from payment_providers where tenant_id = ${tenantId} and kind = 'kopokopo'`;
	if (!row) {
		await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
        values (${nid("prv")}, ${tenantId}, 'kopokopo', 'Kopo Kopo', true, true)`;
		return {
			enabled: true,
			sandbox: true,
			client_id: "",
			till_number: "",
			client_secret_set: false,
			client_secret_hint: ""
		};
	}
	const secret = row.client_secret;
	return {
		enabled: row.enabled,
		sandbox: row.sandbox,
		client_id: row.client_id,
		till_number: row.till_number,
		client_secret_set: Boolean(secret),
		client_secret_hint: hint$1(secret)
	};
});
var saveKopokopo_createServerFn_handler = createServerRpc({
	id: "f9b3f332043676708e8c1ab892b6e537af272e6db59123681b5b45ef00a5250a",
	name: "saveKopokopo",
	filename: "src/lib/isp/server-kopo.ts"
}, (opts) => saveKopokopo.__executeServer(opts));
var saveKopokopo = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(saveKopokopo_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [row] = await sql`
      select id, client_secret from payment_providers where tenant_id = ${tenantId} and kind = 'kopokopo'`;
	const secret = !data.client_secret || data.client_secret.startsWith("••••") ? row?.client_secret ?? "" : seal(data.client_secret);
	if (!row) await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number)
        values (${nid("prv")}, ${tenantId}, 'kopokopo', 'Kopo Kopo', ${data.enabled}, ${data.sandbox}, ${data.client_id.trim()}, ${secret}, ${data.till_number.trim()})`;
	else await sql`update payment_providers set
        enabled = ${data.enabled},
        sandbox = ${data.sandbox},
        client_id = ${data.client_id.trim()},
        client_secret = ${secret},
        till_number = ${data.till_number.trim()}
        where id = ${row.id}`;
	return { ok: true };
});
var testKopokopo_createServerFn_handler = createServerRpc({
	id: "478f5a2cbe7fb162522f17a4b64a839c3d313854f8d22bf41c1209c001869e42",
	name: "testKopokopo",
	filename: "src/lib/isp/server-kopo.ts"
}, (opts) => testKopokopo.__executeServer(opts));
var testKopokopo = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(testKopokopo_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const cfg = await loadKopo(sql, tenantId);
	if (!cfg?.client_id || !cfg.client_secret) throw new Error("Save client id and secret first");
	const token = await kopoAccessToken(cfg);
	return {
		ok: true,
		host: cfg.sandbox ? "sandbox.kopokopo.com" : "api.kopokopo.com",
		token_prefix: token.slice(0, 8)
	};
});
//#endregion
export { getKopokopo_createServerFn_handler, saveKopokopo_createServerFn_handler, testKopokopo_createServerFn_handler };

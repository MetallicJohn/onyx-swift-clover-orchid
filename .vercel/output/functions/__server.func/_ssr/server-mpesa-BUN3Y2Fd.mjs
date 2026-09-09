import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { O as seal, _ as hint$1, b as nid } from "./rls-stkZtAMF.mjs";
import { t as authMiddleware } from "./middleware-BuXiR3_1.mjs";
import { i as mpesaAccessToken, r as loadMpesa } from "./payments-D3oS_eip.mjs";
import { r as tenantPayUrls } from "./webhooks-DiK1NaUx.mjs";
import { t as requireWorkspace } from "./workspace-CffEX4j5.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-mpesa-BUN3Y2Fd.js
var getMpesa_createServerFn_handler = createServerRpc({
	id: "990333dbf23e6550cd986e3e5ef073cf9327280beb4569e280874e04d7d58e91",
	name: "getMpesa",
	filename: "src/lib/isp/server-mpesa.ts"
}, (opts) => getMpesa.__executeServer(opts));
var getMpesa = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getMpesa_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [row] = await sql`select enabled, sandbox, client_id, client_secret, till_number, passkey, stk_type
       from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`;
	if (!row) await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, stk_type)
        values (${nid("prv")}, ${tenantId}, 'mpesa', 'M-Pesa Daraja', true, true, 'paybill')`;
	const cfg = row ?? {
		enabled: true,
		sandbox: true,
		client_id: "",
		client_secret: "",
		till_number: "",
		passkey: "",
		stk_type: "paybill"
	};
	const urls = await tenantPayUrls(sql, tenantId);
	return {
		enabled: cfg.enabled,
		sandbox: cfg.sandbox,
		client_id: cfg.client_id,
		till_number: cfg.till_number,
		stk_type: cfg.stk_type || "paybill",
		client_secret_set: Boolean(cfg.client_secret),
		client_secret_hint: hint$1(cfg.client_secret),
		passkey_set: Boolean(cfg.passkey),
		passkey_hint: hint$1(cfg.passkey),
		public_base_url: urls.public_base_url,
		callback_url: urls.mpesa,
		kopokopo_callback_url: urls.kopokopo,
		slug: urls.slug
	};
});
var saveMpesa_createServerFn_handler = createServerRpc({
	id: "913200ff77f29304ee30fd95bdce91cf50202f8ad6a7cffc52bff073a94e9f25",
	name: "saveMpesa",
	filename: "src/lib/isp/server-mpesa.ts"
}, (opts) => saveMpesa.__executeServer(opts));
var saveMpesa = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(saveMpesa_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [row] = await sql`
      select id, client_secret, passkey from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`;
	const keep = (incoming, existing) => !incoming || incoming.startsWith("••••") ? existing : incoming;
	const secret = seal(keep(data.client_secret, row?.client_secret ?? ""));
	const passkey = seal(keep(data.passkey, row?.passkey ?? ""));
	const stk = data.stk_type === "till" ? "till" : "paybill";
	if (!row) await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number, passkey, stk_type)
        values (${nid("prv")}, ${tenantId}, 'mpesa', 'M-Pesa Daraja', ${data.enabled}, ${data.sandbox}, ${data.client_id.trim()}, ${secret}, ${data.till_number.trim()}, ${passkey}, ${stk})`;
	else await sql`update payment_providers set
        enabled = ${data.enabled},
        sandbox = ${data.sandbox},
        client_id = ${data.client_id.trim()},
        client_secret = ${secret},
        till_number = ${data.till_number.trim()},
        passkey = ${passkey},
        stk_type = ${stk}
        where id = ${row.id}`;
	return { ok: true };
});
var testMpesa_createServerFn_handler = createServerRpc({
	id: "f0d807a698d32edcb199283a08d28db6460e51f1ebcb7800b41f38cae22eb518",
	name: "testMpesa",
	filename: "src/lib/isp/server-mpesa.ts"
}, (opts) => testMpesa.__executeServer(opts));
var testMpesa = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(testMpesa_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const cfg = await loadMpesa(sql, tenantId);
	if (!cfg?.client_id || !cfg.client_secret) throw new Error("Save consumer key and secret first");
	const token = await mpesaAccessToken(cfg);
	return {
		ok: true,
		host: cfg.sandbox ? "sandbox.safaricom.co.ke" : "api.safaricom.co.ke",
		token_prefix: token.slice(0, 8)
	};
});
var savePublicBase_createServerFn_handler = createServerRpc({
	id: "5df8987459be47db7012716158196d8446f4c78c9e37c54fe59ac95f96aa6213",
	name: "savePublicBase",
	filename: "src/lib/isp/server-mpesa.ts"
}, (opts) => savePublicBase.__executeServer(opts));
var savePublicBase = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(savePublicBase_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const url = data.public_base_url.trim().replace(/\/$/, "");
	if (url && !/^https:\/\//i.test(url)) throw new Error("Public site URL must start with https://");
	await sql`update tenants set public_base_url = ${url} where id = ${tenantId}`;
	return tenantPayUrls(sql, tenantId);
});
//#endregion
export { getMpesa_createServerFn_handler, saveMpesa_createServerFn_handler, savePublicBase_createServerFn_handler, testMpesa_createServerFn_handler };

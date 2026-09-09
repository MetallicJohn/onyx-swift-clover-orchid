import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { D as getMessagingSettings, H as webfamBalance, L as saveMessagingSettings, M as nid, T as deliverWhatsapp, V as toPublic, b as applyRls, i as disconnectRadiusUser, m as renderFreeRadiusUsers, n as agentScript, p as publicRadiusAccount, w as deliverSms } from "./access-1saCIo2_.mjs";
import { c as revokeVoucher, i as generateVouchers, n as activateVoucher, r as expireDueVouchers } from "./access-policy-BX1fKswR.mjs";
import { i as getSql } from "./db-Cj2MXHzY.mjs";
import { a as assertPermission } from "./accounts-CrIvUMZR.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { t as listCustomerInbox } from "./inbox-BYYGIUPO.mjs";
import { c as pullCommands } from "./mikrotik-CoGoEmIc.mjs";
import { n as createStkIntent, r as settleStkIntent } from "./payments-BFIx3bjI.mjs";
import { i as openTicket } from "./tickets-B2YTopRq.mjs";
import { t as requireWorkspace } from "./workspace-CKP4BMr-.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-ops-CB7pX2HM.js
function newOtp(sandbox) {
	if (sandbox) return "000000";
	return String(1e5 + Math.floor(Math.random() * 9e5));
}
async function issuePortalOtp(sql, slug, phone) {
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 9) throw new Error("Enter a valid phone number");
	await applyRls(sql, { bypass: true });
	const [ten] = await sql`select id, name from tenants where slug = ${slug.trim()}`;
	if (!ten) throw new Error("Unknown network. Check the ISP slug.");
	await applyRls(sql, {
		tenantId: ten.id,
		bypass: false
	});
	const customer = (await sql`
    select id, phone from customers where tenant_id = ${ten.id}`).find((c) => c.phone.replace(/\D/g, "").endsWith(digits.slice(-9)));
	if (!customer) throw new Error("No customer with that phone on this network");
	const settings = await getMessagingSettings(sql, ten.id);
	const code = newOtp(settings.sms_sandbox);
	await sql`insert into portal_otps (id, tenant_id, customer_id, phone, code, expires_at, used)
    values (${nid("otp")}, ${ten.id}, ${customer.id}, ${phone}, ${code}, now() + interval '15 minutes', false)`;
	if (!settings.sms_sandbox) await deliverSms(settings, phone, `${ten.name} portal code: ${code}. Expires in 15 minutes.`);
	return {
		sent: true,
		hint: settings.sms_sandbox ? code : "sent to your phone",
		isp: ten.name,
		sandbox: settings.sms_sandbox
	};
}
async function verifyPortalOtp(sql, slug, phone, code) {
	const digits = phone.replace(/\D/g, "");
	await applyRls(sql, { bypass: true });
	const [ten] = await sql`select id, name from tenants where slug = ${slug.trim()}`;
	if (!ten) throw new Error("Unknown network");
	await applyRls(sql, {
		tenantId: ten.id,
		bypass: false
	});
	const rows = await sql`
    select id, customer_id from portal_otps
    where tenant_id = ${ten.id} and code = ${code.trim()} and used = false and expires_at > now()
    order by expires_at desc limit 8`;
	const customers = await sql`select id, phone from customers where tenant_id = ${ten.id}`;
	const match = rows.find((r) => {
		const c = customers.find((x) => x.id === r.customer_id);
		return c && c.phone.replace(/\D/g, "").endsWith(digits.slice(-9));
	});
	if (!match) throw new Error("Invalid or expired code");
	await sql`update portal_otps set used = true where id = ${match.id}`;
	const token = `prt_${crypto.randomUUID().replace(/-/g, "")}`;
	await sql`insert into portal_sessions (id, tenant_id, customer_id, token)
    values (${nid("psn")}, ${ten.id}, ${match.customer_id}, ${token})`;
	return {
		token,
		tenantId: ten.id,
		customerId: match.customer_id,
		isp: ten.name
	};
}
async function portalContext(sql, token) {
	await applyRls(sql, { bypass: true });
	const [ses] = await sql`
    select tenant_id, customer_id from portal_sessions where token = ${token}`;
	if (!ses) throw new Error("Session expired. Sign in again.");
	await applyRls(sql, {
		tenantId: ses.tenant_id,
		bypass: false
	});
	const [isp] = await sql`
    select name, slug, support_phone from tenants where id = ${ses.tenant_id}`;
	const [customer] = await sql`
    select id, name, phone, email from customers where id = ${ses.customer_id}`;
	if (!customer || !isp) throw new Error("Account not found");
	return {
		tenantId: ses.tenant_id,
		customer,
		isp
	};
}
async function issueResellerOtp(sql, slug, phone) {
	const digits = phone.replace(/\D/g, "");
	if (digits.length < 9) throw new Error("Enter a valid phone number");
	await applyRls(sql, { bypass: true });
	const [ten] = await sql`select id, name from tenants where slug = ${slug.trim()}`;
	if (!ten) throw new Error("Unknown network");
	await applyRls(sql, {
		tenantId: ten.id,
		bypass: false
	});
	const reseller = (await sql`
    select id, phone, name from resellers where tenant_id = ${ten.id} and status = 'active'`).find((r) => r.phone.replace(/\D/g, "").endsWith(digits.slice(-9)));
	if (!reseller) throw new Error("No reseller with that phone");
	const settings = await getMessagingSettings(sql, ten.id);
	const code = newOtp(settings.sms_sandbox);
	await sql`insert into reseller_otps (id, tenant_id, reseller_id, phone, code, expires_at, used)
    values (${nid("rot")}, ${ten.id}, ${reseller.id}, ${phone}, ${code}, now() + interval '15 minutes', false)`;
	if (!settings.sms_sandbox) await deliverSms(settings, phone, `${ten.name} reseller code: ${code}`);
	return {
		sent: true,
		hint: settings.sms_sandbox ? code : "sent to your phone",
		isp: ten.name
	};
}
async function verifyResellerOtp(sql, slug, phone, code) {
	const digits = phone.replace(/\D/g, "");
	await applyRls(sql, { bypass: true });
	const [ten] = await sql`select id from tenants where slug = ${slug.trim()}`;
	if (!ten) throw new Error("Unknown network");
	await applyRls(sql, {
		tenantId: ten.id,
		bypass: false
	});
	const rows = await sql`
    select id, reseller_id from reseller_otps
    where tenant_id = ${ten.id} and code = ${code.trim()} and used = false and expires_at > now()`;
	const resellers = await sql`select id, phone from resellers where tenant_id = ${ten.id}`;
	const match = rows.find((r) => {
		const rs = resellers.find((x) => x.id === r.reseller_id);
		return rs && rs.phone.replace(/\D/g, "").endsWith(digits.slice(-9));
	});
	if (!match) throw new Error("Invalid or expired code");
	await sql`update reseller_otps set used = true where id = ${match.id}`;
	const token = `rsl_${crypto.randomUUID().replace(/-/g, "")}`;
	await sql`insert into reseller_sessions (id, tenant_id, reseller_id, token)
    values (${nid("rss")}, ${ten.id}, ${match.reseller_id}, ${token})`;
	return { token };
}
async function resellerHome(sql, token) {
	await applyRls(sql, { bypass: true });
	const [ses] = await sql`
    select tenant_id, reseller_id from reseller_sessions where token = ${token}`;
	if (!ses) throw new Error("Session expired. Sign in again.");
	await applyRls(sql, {
		tenantId: ses.tenant_id,
		bypass: false
	});
	const [isp] = await sql`select name, slug from tenants where id = ${ses.tenant_id}`;
	const [rs] = await sql`
    select name, phone, commission_pct from resellers where id = ${ses.reseller_id}`;
	const [wallet] = await sql`
    select balance_kes from reseller_wallets where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id}`;
	const customers = await sql`
    select id, name, phone, status from customers
    where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id} order by name`;
	const txs = await sql`
    select delta_kes, reason, created_at::text as created_at from reseller_transactions
    where tenant_id = ${ses.tenant_id} and reseller_id = ${ses.reseller_id}
    order by created_at desc limit 20`;
	if (!rs || !isp) throw new Error("Account not found");
	return {
		isp,
		reseller: rs,
		balance: wallet?.balance_kes ?? 0,
		customers,
		txs
	};
}
var listRadius_createServerFn_handler = createServerRpc({
	id: "3825925e23a9dece455fd2f6bcc5f43649814004fa58a30552ba1bafb125c8c9",
	name: "listRadius",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listRadius.__executeServer(opts));
var listRadius = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listRadius_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const accounts = await sql`select a.id, a.username, a.password, a.framed_ip, a.group_name, a.enabled, a.rate_limit,
              c.name as customer_name, s.status, s.access_method
       from radius_accounts a
       join services s on s.id = a.service_id
       join customers c on c.id = s.customer_id
       where a.tenant_id = ${tenantId}
       order by a.username`;
	const sessions = await sql`select id, username, framed_ip, nas_ip, bytes_in, bytes_out, started_at::text as started_at, stopped_at::text as stopped_at
       from radius_sessions where tenant_id = ${tenantId} order by started_at desc limit 40`;
	return {
		accounts: accounts.map(publicRadiusAccount),
		sessions
	};
});
var disconnectRadius_createServerFn_handler = createServerRpc({
	id: "6c9de35413d7ffde4b62bd9492dac623db9bced2fd387a87d98d1a58cd58e1b2",
	name: "disconnectRadius",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => disconnectRadius.__executeServer(opts));
var disconnectRadius = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(disconnectRadius_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "radius.manage");
	return disconnectRadiusUser(sql, tenantId, data.username.trim());
});
var exportRadiusUsers_createServerFn_handler = createServerRpc({
	id: "a634b9e860990cf06fea3c0534afc623dcd29ed4717195c19fefd71202f90797",
	name: "exportRadiusUsers",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => exportRadiusUsers.__executeServer(opts));
var exportRadiusUsers = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(exportRadiusUsers_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "radius.manage");
	const accounts = await sql`select username, password, framed_ip, group_name, enabled, rate_limit
       from radius_accounts where tenant_id = ${tenantId} order by username`;
	return { users: renderFreeRadiusUsers(accounts) };
});
var listHotspot_createServerFn_handler = createServerRpc({
	id: "31ef43063c3a0dedbeef55e8bcd870df78e8ecd0560b492d6e861ae738d9101a",
	name: "listHotspot",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listHotspot.__executeServer(opts));
var listHotspot = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listHotspot_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	await expireDueVouchers(sql, tenantId);
	return {
		vouchers: await sql`select v.id, v.code, v.hours, v.status, p.name as package_name, v.created_at::text as created_at, v.expires_at::text as expires_at
       from hotspot_vouchers v join packages p on p.id = v.package_id
       where v.tenant_id = ${tenantId} order by v.created_at desc`,
		packages: await sql`
      select id, name from packages where tenant_id = ${tenantId} and access_method = 'hotspot'`,
		sessions: await sql`select id, username, framed_ip, nas_ip, started_at::text as started_at, stopped_at::text as stopped_at
       from radius_sessions
       where tenant_id = ${tenantId} and username in (select code from hotspot_vouchers where tenant_id = ${tenantId})
       order by started_at desc limit 20`
	};
});
var activateHotspotVoucher_createServerFn_handler = createServerRpc({
	id: "ad3b59d344956234e702d3c96c30ffd11ca87a555f01cee906ead15a555a80d2",
	name: "activateHotspotVoucher",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => activateHotspotVoucher.__executeServer(opts));
var activateHotspotVoucher = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(activateHotspotVoucher_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "services.manage");
	return activateVoucher(sql, tenantId, data.id);
});
var revokeHotspotVoucher_createServerFn_handler = createServerRpc({
	id: "ea6691fb42982b9ab59590a4bd3913dbd6e207bc04e494e931d021f2fb5f65fc",
	name: "revokeHotspotVoucher",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => revokeHotspotVoucher.__executeServer(opts));
var revokeHotspotVoucher = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(revokeHotspotVoucher_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "services.manage");
	return revokeVoucher(sql, tenantId, data.id);
});
var createVouchers_createServerFn_handler = createServerRpc({
	id: "4d32188543180f0a451d089415ae552aa21a70f71e011a089a5568013018bfa8",
	name: "createVouchers",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => createVouchers.__executeServer(opts));
var createVouchers = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createVouchers_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "services.manage");
	return generateVouchers(sql, tenantId, data.package_id, data.count, data.hours);
});
var listAgentQueue_createServerFn_handler = createServerRpc({
	id: "03a87dd3765c846fedf46e205b4458044cf97dcb6b78a0534a5138f8543601c0",
	name: "listAgentQueue",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listAgentQueue.__executeServer(opts));
var listAgentQueue = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listAgentQueue_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return { commands: await sql`select c.id, r.name as router_name, c.kind, c.payload, c.status, c.created_at::text as created_at
       from agent_commands c join routers r on r.id = c.router_id
       where c.tenant_id = ${tenantId}
       order by c.created_at desc limit 40` };
});
var simulateAgentPull_createServerFn_handler = createServerRpc({
	id: "488aeb1b613d5a353f9687b41c41eace61a8605b7d1d0269a9ce9d162b095b32",
	name: "simulateAgentPull",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => simulateAgentPull.__executeServer(opts));
var simulateAgentPull = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(simulateAgentPull_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [r] = await sql`
      select id, enroll_token, identity, name, wg_public, wg_address from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
	if (!r) throw new Error("Router not found");
	const pulled = r.enroll_token ? await pullCommands(sql, r.enroll_token, true) : { commands: [] };
	if (!r.enroll_token) await sql`update routers set wg_status = 'connected', last_seen = now(), cpu_pct = 12, agent_version = '0.2.0' where id = ${r.id}`;
	return {
		pulled: pulled.commands.length,
		commands: pulled.commands,
		script: agentScript({
			name: r.name,
			identity: r.identity,
			token: r.enroll_token,
			wgPublic: r.wg_public,
			wgAddress: r.wg_address || "10.200.0.2/32"
		})
	};
});
var listProviders_createServerFn_handler = createServerRpc({
	id: "e8aa2836b3a89aeb7cd471b7107b01b460c43f28c428d4a29f1af48041c826ae",
	name: "listProviders",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listProviders.__executeServer(opts));
var listProviders = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listProviders_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return {
		providers: await sql`
      select id, kind, label, enabled, sandbox from payment_providers where tenant_id = ${tenantId}`,
		intents: await sql`select id, checkout_id, provider, amount_kes, phone, status, created_at::text as created_at
       from payment_intents where tenant_id = ${tenantId} order by created_at desc limit 20`
	};
});
var toggleProvider_createServerFn_handler = createServerRpc({
	id: "8d55894f738b772309598ee421788e6709822a98ada9e6b61d10f94c10eb3753",
	name: "toggleProvider",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => toggleProvider.__executeServer(opts));
var toggleProvider = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(toggleProvider_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	await sql`update payment_providers set enabled = ${data.enabled} where id = ${data.id} and tenant_id = ${tenantId}`;
	return { ok: true };
});
var sendStk_createServerFn_handler = createServerRpc({
	id: "1b6abb435e2aa24896e2c8e35bf8886c2482c692eee6e64c8d1403d9127b1f27",
	name: "sendStk",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => sendStk.__executeServer(opts));
var sendStk = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(sendStk_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "payments.manage");
	return createStkIntent(sql, {
		tenantId,
		invoiceId: data.invoice_id,
		provider: data.provider || "mpesa",
		amountKes: data.amount_kes
	});
});
var confirmStk_createServerFn_handler = createServerRpc({
	id: "b82f6c5d4d7c9cda154c3316f0754d633de311765d8ba3edde7e8c2deb0f5ba9",
	name: "confirmStk",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => confirmStk.__executeServer(opts));
var confirmStk = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(confirmStk_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, tenantName, role } = await requireWorkspace(context.userId);
	assertPermission(role, "payments.manage");
	return settleStkIntent(sql, {
		tenantId,
		ispName: tenantName,
		checkoutId: data.checkout_id
	});
});
var listField_createServerFn_handler = createServerRpc({
	id: "0bc37d6d424ebf3c443e4599d12e084e9058555818c83cd9a48911368e57c8fb",
	name: "listField",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listField.__executeServer(opts));
var listField = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listField_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	return { tickets: role === "technician" ? await sql`select t.id, t.title, t.category, t.priority, t.status, t.assigned_to, c.name as customer_name, c.phone, c.address, t.created_at::text as created_at
       from tickets t left join customers c on c.id = t.customer_id
       where t.tenant_id = ${tenantId} and t.status not in ('closed','resolved')
         and (t.assigned_to = ${context.userId} or t.assigned_to = '')
       order by case t.priority when 'urgent' then 0 when 'high' then 1 else 2 end, t.created_at` : await sql`select t.id, t.title, t.category, t.priority, t.status, t.assigned_to, c.name as customer_name, c.phone, c.address, t.created_at::text as created_at
       from tickets t left join customers c on c.id = t.customer_id
       where t.tenant_id = ${tenantId} and t.status not in ('closed','resolved')
       order by case t.priority when 'urgent' then 0 when 'high' then 1 else 2 end, t.created_at` };
});
var listAcs_createServerFn_handler = createServerRpc({
	id: "693fd802704e726683002a77e5c7d01d54fcd47f4b02a0094f28d5248b95924e",
	name: "listAcs",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listAcs.__executeServer(opts));
var listAcs = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listAcs_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return {
		devices: await sql`select d.id, d.serial, d.product_class, d.ssid, d.status, c.name as customer_name, d.last_inform::text as last_inform
       from cpe_devices d left join customers c on c.id = d.customer_id
       where d.tenant_id = ${tenantId} order by d.last_inform desc`,
		customers: await sql`select id, name from customers where tenant_id = ${tenantId} order by name`
	};
});
var addCpe_createServerFn_handler = createServerRpc({
	id: "dca568a5575de21b69b2e844fe3531e89215694ffcbf914e4655369e397cbba6",
	name: "addCpe",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => addCpe.__executeServer(opts));
var addCpe = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(addCpe_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	if (!data.serial.trim()) throw new Error("Serial is required");
	await sql`insert into cpe_devices (id, tenant_id, serial, product_class, ssid, status, customer_id)
      values (${nid("cpe")}, ${tenantId}, ${data.serial.trim()}, ${data.product_class || "Router"}, ${data.ssid || ""}, 'online', ${data.customer_id || null})`;
	return { ok: true };
});
var informCpe_createServerFn_handler = createServerRpc({
	id: "b9e2f864ed9e659f04e84c867dfddaaa943b0067a7bb328f27e2557d6158d00c",
	name: "informCpe",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => informCpe.__executeServer(opts));
var informCpe = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(informCpe_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	await sql`update cpe_devices set last_inform = now(), status = 'online' where id = ${data.id} and tenant_id = ${tenantId}`;
	return { ok: true };
});
var listPartners_createServerFn_handler = createServerRpc({
	id: "d42debbe35d08a84f809c102bc9a795caba9b10c809e89a8a0bae236b375c870",
	name: "listPartners",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => listPartners.__executeServer(opts));
var listPartners = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listPartners_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return {
		loyalty: await sql`
      select c.id as customer_id, c.name as customer_name, c.phone, l.points
      from loyalty_accounts l join customers c on c.id = l.customer_id
      where l.tenant_id = ${tenantId} order by l.points desc`,
		referrals: await sql`select r.id, c.name as referrer, r.referee_name, r.referee_phone, r.status, r.points
       from referrals r join customers c on c.id = r.referrer_id
       where r.tenant_id = ${tenantId} order by r.created_at desc`,
		resellers: await sql`select r.id, r.name, r.phone, r.commission_pct, r.status, coalesce(w.balance_kes, 0)::int as balance_kes
       from resellers r
       left join reseller_wallets w on w.reseller_id = r.id and w.tenant_id = r.tenant_id
       where r.tenant_id = ${tenantId} order by r.name`,
		customers: await sql`select id, name from customers where tenant_id = ${tenantId} order by name`
	};
});
var addReferral_createServerFn_handler = createServerRpc({
	id: "c1520bcc010bb4ebf1d67f2a10bcb57a56664034ab50a2c439c081e57d5b658b",
	name: "addReferral",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => addReferral.__executeServer(opts));
var addReferral = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(addReferral_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	if (!data.referee_name.trim()) throw new Error("Name required");
	await sql`insert into referrals (id, tenant_id, referrer_id, referee_name, referee_phone, status, points)
      values (${nid("ref")}, ${tenantId}, ${data.referrer_id}, ${data.referee_name.trim()}, ${data.referee_phone.trim()}, 'pending', 200)`;
	return { ok: true };
});
var addReseller_createServerFn_handler = createServerRpc({
	id: "eca8eea30ac0436609c1dbe175fdc0164ab0dca2185b68f9ab65994386cc791c",
	name: "addReseller",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => addReseller.__executeServer(opts));
var addReseller = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(addReseller_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	if (!data.name.trim()) throw new Error("Name required");
	await sql`insert into resellers (id, tenant_id, name, phone, commission_pct, status)
      values (${nid("rsl")}, ${tenantId}, ${data.name.trim()}, ${data.phone.trim()}, ${data.commission_pct || 10}, 'active')`;
	return { ok: true };
});
var workspaceSlug_createServerFn_handler = createServerRpc({
	id: "62d491c28a0138cce95d6e2308a645a7f64ca6995edf437037e657745f604d3f",
	name: "workspaceSlug",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => workspaceSlug.__executeServer(opts));
var workspaceSlug = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(workspaceSlug_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const [t] = await sql`select slug, name from tenants where id = ${tenantId}`;
	return t ?? {
		slug: "",
		name: ""
	};
});
var requestPortalOtp_createServerFn_handler = createServerRpc({
	id: "a20611a7f7f3bdaa247dc1fe23e47513ec20777296774808872163e80ea17713",
	name: "requestPortalOtp",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => requestPortalOtp.__executeServer(opts));
var requestPortalOtp = createServerFn({ method: "POST" }).validator((d) => d).handler(requestPortalOtp_createServerFn_handler, async ({ data }) => {
	return issuePortalOtp(await getSql(), data.slug, data.phone);
});
var verifyPortalLogin_createServerFn_handler = createServerRpc({
	id: "2c34c4620cfd9f683aea8bfbfb5e7ec53c964195a6507cf296a2af20756424cf",
	name: "verifyPortalLogin",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => verifyPortalLogin.__executeServer(opts));
var verifyPortalLogin = createServerFn({ method: "POST" }).validator((d) => d).handler(verifyPortalLogin_createServerFn_handler, async ({ data }) => {
	return verifyPortalOtp(await getSql(), data.slug, data.phone, data.code);
});
var requestResellerOtp_createServerFn_handler = createServerRpc({
	id: "c31edd8c55cd710d0891392a0052d0e316abb9ad7cd02307b2d748d2ec212580",
	name: "requestResellerOtp",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => requestResellerOtp.__executeServer(opts));
var requestResellerOtp = createServerFn({ method: "POST" }).validator((d) => d).handler(requestResellerOtp_createServerFn_handler, async ({ data }) => {
	return issueResellerOtp(await getSql(), data.slug, data.phone);
});
var verifyResellerLogin_createServerFn_handler = createServerRpc({
	id: "634284e4631fc030e5d32c02aeb3cd4bc41fb897c028cade42cda34b823391d1",
	name: "verifyResellerLogin",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => verifyResellerLogin.__executeServer(opts));
var verifyResellerLogin = createServerFn({ method: "POST" }).validator((d) => d).handler(verifyResellerLogin_createServerFn_handler, async ({ data }) => {
	return verifyResellerOtp(await getSql(), data.slug, data.phone, data.code);
});
var getResellerHome_createServerFn_handler = createServerRpc({
	id: "e9fea7d3fb26d0ce3ed0ab5c1b326b94f06fb029464099c575e71aa5434682e1",
	name: "getResellerHome",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => getResellerHome.__executeServer(opts));
var getResellerHome = createServerFn({ method: "POST" }).validator((d) => d).handler(getResellerHome_createServerFn_handler, async ({ data }) => {
	return resellerHome(await getSql(), data.token);
});
var getPortalHome_createServerFn_handler = createServerRpc({
	id: "0a933c1d7147a260b0b7b06e923afe4666ce627387bcd37e42e1276b2128e23d",
	name: "getPortalHome",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => getPortalHome.__executeServer(opts));
var getPortalHome = createServerFn({ method: "POST" }).validator((d) => d).handler(getPortalHome_createServerFn_handler, async ({ data }) => {
	const sql = await getSql();
	const ctx = await portalContext(sql, data.token);
	const services = await sql`select p.name as package_name, s.access_method, s.username, s.status
       from services s join packages p on p.id = s.package_id
       where s.tenant_id = ${ctx.tenantId} and s.customer_id = ${ctx.customer.id}`;
	const invoices = await sql`select id, number, amount_kes, paid_kes,
              case when status = 'paid' then 0 else greatest(0, amount_kes - paid_kes) end as remaining_kes,
              status, due_date::text as due_date
       from invoices where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}
       order by issued_at desc`;
	const [loy] = await sql`
      select points from loyalty_accounts where tenant_id = ${ctx.tenantId} and customer_id = ${ctx.customer.id}`;
	const inbox = await listCustomerInbox(sql, ctx.tenantId, ctx.customer.id);
	return {
		...ctx,
		services,
		invoices,
		points: loy?.points ?? 0,
		inbox
	};
});
var portalPay_createServerFn_handler = createServerRpc({
	id: "3762011a8a863609d7f25b338b4d0962c3e62f545e3bb44f47ed98ae61a8e611",
	name: "portalPay",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => portalPay.__executeServer(opts));
var portalPay = createServerFn({ method: "POST" }).validator((d) => d).handler(portalPay_createServerFn_handler, async ({ data }) => {
	const sql = await getSql();
	const ctx = await portalContext(sql, data.token);
	const intent = await createStkIntent(sql, {
		tenantId: ctx.tenantId,
		invoiceId: data.invoice_id,
		provider: "mpesa"
	});
	if (!intent.checkout_id.startsWith("ws_")) return {
		...intent,
		paid: false,
		note: "Complete the M-Pesa prompt on your phone."
	};
	try {
		const pay = await settleStkIntent(sql, {
			tenantId: ctx.tenantId,
			ispName: ctx.isp.name,
			checkoutId: intent.checkout_id
		});
		return {
			...intent,
			paid: true,
			payment_id: pay.id,
			note: "Sandbox payment confirmed."
		};
	} catch (e) {
		return {
			...intent,
			paid: false,
			note: e instanceof Error ? e.message : "Waiting for payment"
		};
	}
});
var portalOpenTicket_createServerFn_handler = createServerRpc({
	id: "dc6c00b3a1df2860e149b926675af6275a2500ba3e242177ae1e5dd559aa1f44",
	name: "portalOpenTicket",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => portalOpenTicket.__executeServer(opts));
var portalOpenTicket = createServerFn({ method: "POST" }).validator((d) => d).handler(portalOpenTicket_createServerFn_handler, async ({ data }) => {
	const sql = await getSql();
	const ctx = await portalContext(sql, data.token);
	return await openTicket(sql, ctx.tenantId, {
		title: data.title.trim(),
		category: "support",
		priority: "normal",
		customer_id: ctx.customer.id
	});
});
var getMessaging_createServerFn_handler = createServerRpc({
	id: "06a74cd76fa462be44603eee1b688c499626cd559aecb2d18fbe8dd56ed450b0",
	name: "getMessaging",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => getMessaging.__executeServer(opts));
var getMessaging = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getMessaging_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return toPublic(await getMessagingSettings(sql, tenantId));
});
var saveMessaging_createServerFn_handler = createServerRpc({
	id: "3e89b2607399ba88f8a16e73ff3cd6f647b1d0137deff4437ceafc701539493d",
	name: "saveMessaging",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => saveMessaging.__executeServer(opts));
var saveMessaging = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(saveMessaging_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return toPublic(await saveMessagingSettings(sql, tenantId, data));
});
var testMessaging_createServerFn_handler = createServerRpc({
	id: "f075398e94e2bd2fb3b94ced67a1ef8694a805d176a93f1385c1909df18a6d50",
	name: "testMessaging",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => testMessaging.__executeServer(opts));
var testMessaging = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(testMessaging_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, tenantName } = await requireWorkspace(context.userId);
	const settings = await getMessagingSettings(sql, tenantId);
	const phone = data.phone.trim();
	if (!phone) throw new Error("Enter a test phone number");
	const msg = data.channel === "sms" ? `${tenantName}: test payment SMS from Gridline. If you received this, SMS is configured.` : `${tenantName}: test payment WhatsApp from Gridline. If you received this, the Cloud API is configured.`;
	return data.channel === "sms" ? deliverSms(settings, phone, msg) : deliverWhatsapp(settings, phone, msg);
});
var checkSmsAccount_createServerFn_handler = createServerRpc({
	id: "b4dcbf82b4bf84ba2b6f2bd159223569688d730940310a7318b304e4a5b4078e",
	name: "checkSmsAccount",
	filename: "src/lib/isp/server-ops.ts"
}, (opts) => checkSmsAccount.__executeServer(opts));
var checkSmsAccount = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(checkSmsAccount_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	const settings = await getMessagingSettings(sql, tenantId);
	if (settings.sms_provider !== "webfam") return {
		ok: false,
		detail: "Balance check is available for Webfam SMS."
	};
	return webfamBalance(settings);
});
//#endregion
export { activateHotspotVoucher_createServerFn_handler, addCpe_createServerFn_handler, addReferral_createServerFn_handler, addReseller_createServerFn_handler, checkSmsAccount_createServerFn_handler, confirmStk_createServerFn_handler, createVouchers_createServerFn_handler, disconnectRadius_createServerFn_handler, exportRadiusUsers_createServerFn_handler, getMessaging_createServerFn_handler, getPortalHome_createServerFn_handler, getResellerHome_createServerFn_handler, informCpe_createServerFn_handler, listAcs_createServerFn_handler, listAgentQueue_createServerFn_handler, listField_createServerFn_handler, listHotspot_createServerFn_handler, listPartners_createServerFn_handler, listProviders_createServerFn_handler, listRadius_createServerFn_handler, portalOpenTicket_createServerFn_handler, portalPay_createServerFn_handler, requestPortalOtp_createServerFn_handler, requestResellerOtp_createServerFn_handler, revokeHotspotVoucher_createServerFn_handler, saveMessaging_createServerFn_handler, sendStk_createServerFn_handler, simulateAgentPull_createServerFn_handler, testMessaging_createServerFn_handler, toggleProvider_createServerFn_handler, verifyPortalLogin_createServerFn_handler, verifyResellerLogin_createServerFn_handler, workspaceSlug_createServerFn_handler };

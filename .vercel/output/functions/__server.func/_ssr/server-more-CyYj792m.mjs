import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { b as nid, o as commandRosScript } from "./rls-stkZtAMF.mjs";
import { t as authMiddleware } from "./middleware-BuXiR3_1.mjs";
import { t as assertPermission } from "./tenant-context-BsYaB9rN.mjs";
import { n as changePlan, r as ensureSubscription } from "./saas-CEVRi20s.mjs";
import { n as commentTicket, r as listStaff, t as assignTicket } from "./tickets-DgGBky5M.mjs";
import { t as requireWorkspace } from "./workspace-CffEX4j5.mjs";
import { i as redeemLoyalty, t as attachCustomerReseller } from "./resellers-D82O6Apv.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-more-CyYj792m.js
var ACS_KINDS = [
	"reboot",
	"setSsid",
	"refresh"
];
async function queueAcsTask(sql, tenantId, cpeId, kind, payload) {
	if (!ACS_KINDS.includes(kind)) throw new Error("Unknown ACS task");
	const [cpe] = await sql`select id from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
	if (!cpe) throw new Error("CPE not found");
	const id = nid("acs");
	await sql`insert into acs_tasks (id, tenant_id, cpe_id, kind, payload, status)
    values (${id}, ${tenantId}, ${cpeId}, ${kind}, ${JSON.stringify(payload)}, 'queued')`;
	if (kind === "setSsid" && payload.ssid) await sql`update cpe_devices set ssid = ${String(payload.ssid)} where id = ${cpeId} and tenant_id = ${tenantId}`;
	return {
		id,
		status: "queued"
	};
}
function templateScript(prompt) {
	const p = prompt.toLowerCase();
	if (p.includes("hotspot")) return commandRosScript("hotspot.upsert", {
		username: "guest1",
		password: "changeme",
		package: "default"
	});
	if (p.includes("static") || p.includes("queue")) return commandRosScript("static.upsert", {
		username: "static1",
		static_ip: "10.10.10.20",
		download_mbps: 10,
		upload_mbps: 5
	});
	if (p.includes("pppoe") || p.includes("secret")) return commandRosScript("pppoe.upsert", {
		username: "user1",
		password: "changeme",
		package: "default"
	});
	return `# Review before paste — generated from: ${prompt.replace(/\n/g, " ").slice(0, 80)}
/system identity print
/interface print
/ppp secret print
/ip hotspot user print`;
}
async function generateMikrotikScript(sql, tenantId, prompt) {
	const text = prompt.trim();
	if (text.length < 8) throw new Error("Describe the change in more detail");
	if (text.length > 2e3) throw new Error("Prompt too long");
	let script = templateScript(text);
	let model = "template";
	const key = process.env.XAI_API_KEY;
	if (key) {
		const res = await fetch("https://api.x.ai/v1/chat/completions", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${key}`
			},
			body: JSON.stringify({
				model: "grok-4.5",
				max_tokens: 700,
				messages: [{
					role: "system",
					content: "You write MikroTik RouterOS v7 scripts only. No markdown. Use :local, :if, :do on-error. Never reboot unless asked. Placeholders for secrets."
				}, {
					role: "user",
					content: text
				}]
			})
		});
		if (res.ok) {
			const out = (await res.json()).choices?.[0]?.message?.content?.trim();
			if (out) {
				script = out.replace(/^```[\w]*\n?/, "").replace(/```$/, "");
				model = "grok-4.5";
			}
		}
	}
	await sql`insert into ai_scripts (id, tenant_id, prompt, script, model)
    values (${nid("ai")}, ${tenantId}, ${text.slice(0, 2e3)}, ${script.slice(0, 8e3)}, ${model})`;
	return {
		script,
		model
	};
}
function invoiceAging(status, dueDate, today = /* @__PURE__ */ new Date()) {
	if (status === "paid") return "paid";
	const due = new Date(dueDate);
	if (Number.isNaN(due.getTime())) return "current";
	const days = Math.floor((today.getTime() - due.getTime()) / 864e5);
	if (days <= 0) return "current";
	if (days <= 30) return "1-30";
	if (days <= 60) return "31-60";
	return "60+";
}
function tallyAging(rows, today = /* @__PURE__ */ new Date()) {
	const out = {
		current: {
			count: 0,
			amount: 0
		},
		"1-30": {
			count: 0,
			amount: 0
		},
		"31-60": {
			count: 0,
			amount: 0
		},
		"60+": {
			count: 0,
			amount: 0
		},
		paid: {
			count: 0,
			amount: 0
		}
	};
	for (const r of rows) {
		const b = invoiceAging(r.status, r.due_date, today);
		out[b].count += 1;
		out[b].amount += r.amount_kes;
	}
	return out;
}
function groupDaily(rows) {
	const map = /* @__PURE__ */ new Map();
	for (const r of rows) {
		const day = r.paid_at.slice(0, 10);
		const cur = map.get(day) ?? {
			day,
			amount: 0,
			n: 0
		};
		cur.amount += r.amount_kes;
		cur.n += 1;
		map.set(day, cur);
	}
	return [...map.values()].sort((a, b) => b.day.localeCompare(a.day)).slice(0, 14);
}
async function loadReports(sql, tenantId) {
	const aging = tallyAging(await sql`
    select status, due_date::text as due_date, amount_kes from invoices where tenant_id = ${tenantId}`);
	const daily = groupDaily(await sql`
    select paid_at::text as paid_at, amount_kes from payments
    where tenant_id = ${tenantId} and status = 'confirmed'`);
	const services = await sql`
    select access_method, status, count(*)::int as n from services
    where tenant_id = ${tenantId} group by access_method, status`;
	const methods = /* @__PURE__ */ new Map();
	for (const s of services) {
		const cur = methods.get(s.access_method) ?? {
			access_method: s.access_method,
			n: 0,
			active: 0
		};
		cur.n += s.n;
		if (s.status === "active") cur.active += s.n;
		methods.set(s.access_method, cur);
	}
	const tickets = await sql`
    select status, count(*)::int as n from tickets where tenant_id = ${tenantId} group by status`;
	const routers = await sql`
    select wg_status, count(*)::int as n from routers where tenant_id = ${tenantId} group by wg_status`;
	return {
		aging,
		daily,
		methods: [...methods.values()],
		tickets,
		routers
	};
}
async function loadAudit(sql, tenantId) {
	return sql`select id, user_id, action, entity_type, entity_id, created_at::text as created_at
     from audit_logs where tenant_id = ${tenantId} order by created_at desc limit 80`;
}
async function loadStatement(sql, tenantId, customerId) {
	const [customer] = await sql`select id, name, phone, email, address from customers where id = ${customerId} and tenant_id = ${tenantId}`;
	if (!customer) throw new Error("Customer not found");
	const invoices = await sql`select number, amount_kes, status, due_date::text as due_date
     from invoices where tenant_id = ${tenantId} and customer_id = ${customerId} order by issued_at desc`;
	const payments = await sql`select reference, provider, amount_kes, paid_at::text as paid_at, status
     from payments where tenant_id = ${tenantId} and customer_id = ${customerId} order by paid_at desc`;
	const ledger = await sql`select entry_type, debit_kes, credit_kes, memo, created_at::text as created_at
     from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}
     order by created_at desc limit 50`;
	const [bal] = await sql`
    select coalesce(sum(debit_kes),0)::int as debit, coalesce(sum(credit_kes),0)::int as credit
    from customer_ledger where tenant_id = ${tenantId} and customer_id = ${customerId}`;
	return {
		customer,
		invoices,
		payments,
		ledger,
		balance: (bal?.debit ?? 0) - (bal?.credit ?? 0)
	};
}
var ROLES = [
	"isp_owner",
	"isp_admin",
	"finance",
	"customer_care",
	"network_engineer",
	"technician"
];
function isTenantRole(role) {
	return ROLES.includes(role);
}
async function addMemberByEmail(sql, tenantId, email, role) {
	if (!isTenantRole(role)) throw new Error("Unknown role");
	const trimmed = email.trim().toLowerCase();
	if (!trimmed.includes("@")) throw new Error("Enter an email");
	const [user] = await sql`select id from "user" where lower(email) = ${trimmed}`;
	if (!user) throw new Error("They must sign in to Gridline once before you can add them.");
	if ((await sql`
    select id from tenant_members where tenant_id = ${tenantId} and user_id = ${user.id}`)[0]) throw new Error("Already a member of this ISP");
	await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${user.id}, ${role})`;
	return {
		user_id: user.id,
		role
	};
}
async function setMemberRole(sql, tenantId, userId, role) {
	if (!isTenantRole(role)) throw new Error("Unknown role");
	const [row] = await sql`
    select role from tenant_members where tenant_id = ${tenantId} and user_id = ${userId}`;
	if (!row) throw new Error("Member not found");
	if (row.role === "isp_owner" && role !== "isp_owner") {
		if (((await sql`
      select count(*)::int as n from tenant_members where tenant_id = ${tenantId} and role = 'isp_owner'`)[0]?.n ?? 0) <= 1) throw new Error("Keep at least one owner");
	}
	await sql`update tenant_members set role = ${role} where tenant_id = ${tenantId} and user_id = ${userId}`;
	return { ok: true };
}
async function listBranches(sql, tenantId) {
	return sql`
    select id, name, created_at::text as created_at from tenant_branches
    where tenant_id = ${tenantId} order by name`;
}
async function addBranch(sql, tenantId, name) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error("Branch name required");
	const id = nid("brn");
	await sql`insert into tenant_branches (id, tenant_id, name) values (${id}, ${tenantId}, ${trimmed})`;
	return {
		id,
		name: trimmed
	};
}
var assignOpenTicket_createServerFn_handler = createServerRpc({
	id: "8189f346456057568a37dde47fdf2a26d0c291ad3b07ca011b3e642c4eddade6",
	name: "assignOpenTicket",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => assignOpenTicket.__executeServer(opts));
var assignOpenTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(assignOpenTicket_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "tickets.manage");
	await assignTicket(sql, tenantId, data.id, data.user_id);
	return { ok: true };
});
var commentOpenTicket_createServerFn_handler = createServerRpc({
	id: "6cc57261e98985e29d9ad06b62b90ee399d17f030af756dabfcb1fc62758ae07",
	name: "commentOpenTicket",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => commentOpenTicket.__executeServer(opts));
var commentOpenTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(commentOpenTicket_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, role === "technician" ? "jobs.update" : "tickets.manage");
	await commentTicket(sql, tenantId, data.id, context.userId, data.body);
	return { ok: true };
});
var listTicketStaff_createServerFn_handler = createServerRpc({
	id: "5f9cf45bb6f1e783c44c9b2bf8ae0c24895b7f5c3c9dd273d115216220cbbd59",
	name: "listTicketStaff",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => listTicketStaff.__executeServer(opts));
var listTicketStaff = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listTicketStaff_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return { staff: await listStaff(sql, tenantId) };
});
var queueCpeTask_createServerFn_handler = createServerRpc({
	id: "48a0e790a8d1ae7d3d96adf83377a4c29339af9348cfbbe18dd818d8f19c6cd4",
	name: "queueCpeTask",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => queueCpeTask.__executeServer(opts));
var queueCpeTask = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(queueCpeTask_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "routers.manage");
	return queueAcsTask(sql, tenantId, data.cpe_id, data.kind, { ssid: data.ssid || "" });
});
var listCpeTasks_createServerFn_handler = createServerRpc({
	id: "a4276df6051847507687b2c60b80786fcb29007a418aed8bf97a7793326fe460",
	name: "listCpeTasks",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => listCpeTasks.__executeServer(opts));
var listCpeTasks = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listCpeTasks_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return { tasks: await sql`select t.id, t.kind, t.status, d.serial, t.created_at::text as created_at
       from acs_tasks t join cpe_devices d on d.id = t.cpe_id
       where t.tenant_id = ${tenantId} order by t.created_at desc limit 30` };
});
var redeemPoints_createServerFn_handler = createServerRpc({
	id: "f191e0976790b49a0f7b7d9c0bb41868d24dacf683d4bbea75bdf81b4568538a",
	name: "redeemPoints",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => redeemPoints.__executeServer(opts));
var redeemPoints = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(redeemPoints_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "customers.manage");
	return redeemLoyalty(sql, tenantId, data.customer_id, data.points);
});
var linkReseller_createServerFn_handler = createServerRpc({
	id: "3b65fa76427794bb9db6711fd25b659a0e5b0ecc27036dacb059f0d7a236dc44",
	name: "linkReseller",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => linkReseller.__executeServer(opts));
var linkReseller = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(linkReseller_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "customers.manage");
	await attachCustomerReseller(sql, tenantId, data.customer_id, data.reseller_id);
	return { ok: true };
});
var getPlan_createServerFn_handler = createServerRpc({
	id: "8e1392816efb0d87ed30324df30d5fde33bbb12011442e0e1c4bc495f53c00c3",
	name: "getPlan",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => getPlan.__executeServer(opts));
var getPlan = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getPlan_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return ensureSubscription(sql, tenantId);
});
var setPlan_createServerFn_handler = createServerRpc({
	id: "65ffed348c746e4fa38b133584e47a6a978e2f30a88da4619948de0699a612ed",
	name: "setPlan",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => setPlan.__executeServer(opts));
var setPlan = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(setPlan_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "settings.manage");
	return changePlan(sql, tenantId, data.plan);
});
var askRouterOs_createServerFn_handler = createServerRpc({
	id: "b8cdd856e4723bd8691e891996a289b24615758ae420af7b40146abda15964ac",
	name: "askRouterOs",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => askRouterOs.__executeServer(opts));
var askRouterOs = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(askRouterOs_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "routers.manage");
	return generateMikrotikScript(sql, tenantId, data.prompt);
});
var getReports_createServerFn_handler = createServerRpc({
	id: "434b7e52924a49ba3d2c02bf57e5bf1795c736f54b2d161bbd9ff232e34c4bea",
	name: "getReports",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => getReports.__executeServer(opts));
var getReports = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getReports_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return loadReports(sql, tenantId);
});
var getAuditLog_createServerFn_handler = createServerRpc({
	id: "dd66a2f2e88a97fde4c7bc456d49abbf04aebacbae551f33b6db26c17eeab899",
	name: "getAuditLog",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => getAuditLog.__executeServer(opts));
var getAuditLog = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getAuditLog_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "audit.read");
	return { rows: await loadAudit(sql, tenantId) };
});
var getStatement_createServerFn_handler = createServerRpc({
	id: "c1f8f6abd400cff69c71744e2921567e8c2f3b9709fbd9168556069264c948e0",
	name: "getStatement",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => getStatement.__executeServer(opts));
var getStatement = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(getStatement_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "invoices.read");
	return loadStatement(sql, tenantId, data.customer_id);
});
var getBranches_createServerFn_handler = createServerRpc({
	id: "4f0b05ba56a0dcde26445f41ef827f51f0fa6dd880c08857a010fb893d90746b",
	name: "getBranches",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => getBranches.__executeServer(opts));
var getBranches = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getBranches_createServerFn_handler, async ({ context }) => {
	const { sql, tenantId } = await requireWorkspace(context.userId);
	return { branches: await listBranches(sql, tenantId) };
});
var createBranch_createServerFn_handler = createServerRpc({
	id: "e2fe93fbeec90c7b90207fcb5f255ccbf30aae4915fe179d00bddd42186899e8",
	name: "createBranch",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => createBranch.__executeServer(opts));
var createBranch = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createBranch_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "settings.manage");
	return addBranch(sql, tenantId, data.name);
});
var inviteMember_createServerFn_handler = createServerRpc({
	id: "f343a29b60bea3cb975580feb1062e80abbf518b4cb5c670f5ade0de000536ba",
	name: "inviteMember",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => inviteMember.__executeServer(opts));
var inviteMember = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(inviteMember_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "settings.manage");
	return addMemberByEmail(sql, tenantId, data.email, data.role);
});
var changeMemberRole_createServerFn_handler = createServerRpc({
	id: "22bcb5c3d5edf5875466ea542ef918f35683ee50e646baceb4461db13efc758c",
	name: "changeMemberRole",
	filename: "src/lib/isp/server-more.ts"
}, (opts) => changeMemberRole.__executeServer(opts));
var changeMemberRole = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(changeMemberRole_createServerFn_handler, async ({ context, data }) => {
	const { sql, tenantId, role } = await requireWorkspace(context.userId);
	assertPermission(role, "settings.manage");
	return setMemberRole(sql, tenantId, data.user_id, data.role);
});
//#endregion
export { askRouterOs_createServerFn_handler, assignOpenTicket_createServerFn_handler, changeMemberRole_createServerFn_handler, commentOpenTicket_createServerFn_handler, createBranch_createServerFn_handler, getAuditLog_createServerFn_handler, getBranches_createServerFn_handler, getPlan_createServerFn_handler, getReports_createServerFn_handler, getStatement_createServerFn_handler, inviteMember_createServerFn_handler, linkReseller_createServerFn_handler, listCpeTasks_createServerFn_handler, listTicketStaff_createServerFn_handler, queueCpeTask_createServerFn_handler, redeemPoints_createServerFn_handler, setPlan_createServerFn_handler };

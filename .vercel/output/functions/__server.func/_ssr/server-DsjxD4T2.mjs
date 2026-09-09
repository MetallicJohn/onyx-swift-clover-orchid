import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { A as issueInvoice, M as nid, _ as wgAddressForIndex, a as emit, b as applyRls, c as enrollFields, f as provisionServiceAccess, g as syncRadiusAccount, h as seedOpsForTenant, n as agentScript, o as enqueueAgentCommand, t as agentPullUrl } from "./access-1saCIo2_.mjs";
import { i as getSql } from "./db-Cj2MXHzY.mjs";
import { a as assertPermission, d as provisionTenant, f as resolveActiveTenant, p as setActiveTenant, u as loadAuthUser } from "./accounts-CrIvUMZR.mjs";
import { t as authMiddleware } from "./middleware-Cu1DSXn0.mjs";
import { n as listInbox } from "./inbox-BYYGIUPO.mjs";
import { i as runBillingCycle, r as notifyCustomerEvent, t as ensureDefaultTemplates } from "./notifications-CBBMOK-P.mjs";
import { n as assertCustomerQuota } from "./saas-CKrgrfcA.mjs";
import { t as applyConfirmedPayment } from "./payments-BFIx3bjI.mjs";
import { i as openTicket } from "./tickets-B2YTopRq.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-DsjxD4T2.js
function parseV4Cidr(cidr) {
	const [ip, prefixRaw] = cidr.split("/");
	const parts = (ip || "").split(".").map((n) => Number(n));
	if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) throw new Error("Invalid IPv4 CIDR");
	const prefix = Number(prefixRaw ?? 24);
	if (prefix < 8 || prefix > 32) throw new Error("Unsupported prefix");
	return {
		parts,
		prefix
	};
}
function ipv4At(cidr, hostIndex) {
	const { parts } = parseV4Cidr(cidr);
	const last = Math.min(254, Math.max(1, hostIndex));
	return `${parts[0]}.${parts[1]}.${parts[2]}.${last}`;
}
function nextIpv4(cidr, nextHost) {
	return {
		address: ipv4At(cidr, nextHost),
		nextHost: nextHost + 1
	};
}
async function loadService(sql, tenantId, serviceId) {
	const [svc] = await sql`select s.id, s.customer_id, s.access_method, s.username, s.static_ip, s.status,
            p.name as package_name, p.download_mbps, p.upload_mbps
     from services s join packages p on p.id = s.package_id
     where s.id = ${serviceId} and s.tenant_id = ${tenantId}`;
	return svc ?? null;
}
async function allocateStaticIp(sql, tenantId, serviceId, customerId) {
	const [pool] = await sql`
    select id, cidr, next_host from ip_pools where tenant_id = ${tenantId} order by name limit 1`;
	if (!pool) throw new Error("No IP pool configured");
	let host = pool.next_host || 20;
	for (let i = 0; i < 80; i += 1) {
		const { address, nextHost } = nextIpv4(pool.cidr, host);
		host = nextHost;
		const taken = await sql`select id from ip_addresses where tenant_id = ${tenantId} and address = ${address}`;
		const onService = await sql`select id from services where tenant_id = ${tenantId} and static_ip = ${address}`;
		if (taken[0] || onService[0]) continue;
		await sql`insert into ip_addresses (id, tenant_id, pool_id, address, family, status, service_id, customer_id)
      values (${nid("ip")}, ${tenantId}, ${pool.id}, ${address}, 'ipv4', 'assigned', ${serviceId}, ${customerId})`;
		await sql`update ip_pools set next_host = ${host} where id = ${pool.id}`;
		await sql`update services set static_ip = ${address} where id = ${serviceId} and tenant_id = ${tenantId}`;
		return address;
	}
	throw new Error("IP pool exhausted");
}
async function rotateServicePassword(sql, tenantId, serviceId) {
	const svc = await loadService(sql, tenantId, serviceId);
	if (!svc) throw new Error("Service not found");
	const password = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
	const radius = await syncRadiusAccount(sql, tenantId, {
		...svc,
		password
	});
	await emit(sql, {
		type: "service.changed",
		tenantId,
		payload: {
			...svc,
			password
		}
	});
	return {
		username: radius.username,
		password
	};
}
async function disconnectSession(sql, tenantId, serviceId) {
	const svc = await loadService(sql, tenantId, serviceId);
	if (!svc) throw new Error("Service not found");
	const kind = `${svc.access_method === "static" ? "static" : svc.access_method}.disconnect`;
	await enqueueAgentCommand(sql, tenantId, kind, {
		username: svc.username,
		static_ip: svc.static_ip,
		service_id: svc.id
	});
	if (svc.username) await sql`update radius_sessions set stopped_at = now()
      where tenant_id = ${tenantId} and username = ${svc.username} and stopped_at is null`;
	return { kind };
}
async function audit(sql, tenantId, userId, action, entityType = "", entityId = "") {
	await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${entityType}, ${entityId})`;
}
async function seedDemo(sql, tenantId) {
	const pkgs = [
		{
			id: nid("pkg"),
			name: "Home 10",
			description: "Residential 10/5 Mbps",
			access_method: "pppoe",
			download_mbps: 10,
			upload_mbps: 5,
			price_kes: 2500,
			billing_interval: "monthly",
			grace_days: 5,
			bundle_mb: 0,
			validity_hours: 0
		},
		{
			id: nid("pkg"),
			name: "Home 20",
			description: "Residential 20/10 Mbps · 10 GB FUP",
			access_method: "pppoe",
			download_mbps: 20,
			upload_mbps: 10,
			price_kes: 3500,
			billing_interval: "monthly",
			grace_days: 5,
			bundle_mb: 10240,
			validity_hours: 0
		},
		{
			id: nid("pkg"),
			name: "Business 50",
			description: "Dedicated 50/50 Mbps",
			access_method: "static",
			download_mbps: 50,
			upload_mbps: 50,
			price_kes: 8500,
			billing_interval: "monthly",
			grace_days: 3,
			bundle_mb: 0,
			validity_hours: 0
		},
		{
			id: nid("pkg"),
			name: "Hotspot Day",
			description: "24-hour voucher · 1 GB",
			access_method: "hotspot",
			download_mbps: 8,
			upload_mbps: 4,
			price_kes: 100,
			billing_interval: "daily",
			grace_days: 0,
			bundle_mb: 1024,
			validity_hours: 24
		}
	];
	for (const p of pkgs) await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active)
      values (${p.id}, ${tenantId}, ${p.name}, ${p.description}, ${p.access_method}, ${p.download_mbps}, ${p.upload_mbps}, ${p.price_kes}, ${p.billing_interval}, ${p.grace_days}, ${p.bundle_mb}, ${p.validity_hours}, true)`;
	const people = [
		{
			name: "Amina Wanjiku",
			phone: "+254712001001",
			email: "amina@example.com",
			address: "Westlands, Nairobi",
			type: "individual"
		},
		{
			name: "Brian Otieno",
			phone: "+254722334455",
			email: "brian@example.com",
			address: "Kisumu CBD",
			type: "individual"
		},
		{
			name: "Njeri Holdings",
			phone: "+254733221100",
			email: "it@njeri.co.ke",
			address: "Upper Hill",
			type: "business"
		},
		{
			name: "Daniel Mwangi",
			phone: "+254700889900",
			email: "daniel@example.com",
			address: "Thika Road",
			type: "individual"
		},
		{
			name: "Faith Chebet",
			phone: "+254711223344",
			email: "faith@example.com",
			address: "Eldoret Town",
			type: "individual"
		},
		{
			name: "Coastal Cafe",
			phone: "+254701556677",
			email: "cafe@coastal.ke",
			address: "Nyali, Mombasa",
			type: "business"
		},
		{
			name: "Peter Kamau",
			phone: "+254798112233",
			email: "peter@example.com",
			address: "Ngong Road",
			type: "individual"
		},
		{
			name: "Lillian Achieng",
			phone: "+254710998877",
			email: "lillian@example.com",
			address: "Kisii Town",
			type: "individual"
		}
	];
	const customerIds = [];
	for (const c of people) {
		const id = nid("cus");
		customerIds.push(id);
		await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
      values (${id}, ${tenantId}, ${c.type}, ${c.name}, ${c.phone}, ${c.email}, ${c.address}, 'active')`;
	}
	for (const s of [
		{
			ci: 0,
			pi: 1,
			method: "pppoe",
			username: "amina.wanjiku",
			status: "active"
		},
		{
			ci: 1,
			pi: 0,
			method: "pppoe",
			username: "brian.otieno",
			status: "grace"
		},
		{
			ci: 2,
			pi: 2,
			method: "static",
			ip: "102.68.10.14",
			status: "active"
		},
		{
			ci: 3,
			pi: 0,
			method: "pppoe",
			username: "daniel.mwangi",
			status: "suspended"
		},
		{
			ci: 4,
			pi: 1,
			method: "pppoe",
			username: "faith.chebet",
			status: "active"
		},
		{
			ci: 5,
			pi: 3,
			method: "hotspot",
			username: "VCH-COAST-19",
			status: "active"
		},
		{
			ci: 6,
			pi: 0,
			method: "pppoe",
			username: "peter.kamau",
			status: "active"
		},
		{
			ci: 7,
			pi: 1,
			method: "pppoe",
			username: "lillian.achieng",
			status: "pending"
		}
	]) {
		const period = /* @__PURE__ */ new Date();
		if (s.status === "suspended") period.setDate(period.getDate() - 2);
		else period.setDate(period.getDate() + 28);
		await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
      values (${nid("svc")}, ${tenantId}, ${customerIds[s.ci]}, ${pkgs[s.pi].id}, ${s.method}, ${s.username ?? null}, ${s.ip ?? null}, ${s.status}, ${period.toISOString()})`;
	}
	const today = /* @__PURE__ */ new Date();
	const iso = (d) => d.toISOString().slice(0, 10);
	const due = (offset) => {
		const d = new Date(today);
		d.setDate(d.getDate() + offset);
		return iso(d);
	};
	const invSpecs = [
		{
			ci: 0,
			n: "INV-1042",
			amt: 3500,
			st: "paid",
			due: due(-2),
			paid: 3500,
			desc: "Home 20 (monthly)"
		},
		{
			ci: 1,
			n: "INV-1043",
			amt: 2500,
			st: "overdue",
			due: due(-4),
			paid: 0,
			desc: "Home 10 (monthly)"
		},
		{
			ci: 2,
			n: "INV-1044",
			amt: 8500,
			st: "issued",
			due: due(12),
			paid: 0,
			desc: "Business 50 (monthly)"
		},
		{
			ci: 3,
			n: "INV-1045",
			amt: 2500,
			st: "overdue",
			due: due(-8),
			paid: 0,
			desc: "Home 10 (monthly)"
		},
		{
			ci: 4,
			n: "INV-1046",
			amt: 3500,
			st: "paid",
			due: due(6),
			paid: 3500,
			desc: "Home 20 (monthly)"
		},
		{
			ci: 6,
			n: "INV-1047",
			amt: 2500,
			st: "partial",
			due: due(1),
			paid: 1e3,
			desc: "Home 10 (monthly)"
		}
	];
	const invoiceIds = [];
	for (const i of invSpecs) {
		const id = nid("inv");
		invoiceIds.push(id);
		await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date, subtotal_kes, paid_kes)
      values (${id}, ${tenantId}, ${customerIds[i.ci]}, ${i.n}, ${i.amt}, ${i.st}, ${i.due}, ${i.amt}, ${i.paid})`;
		await sql`insert into invoice_items (id, tenant_id, invoice_id, description, quantity, unit_kes, amount_kes)
      values (${nid("ili")}, ${tenantId}, ${id}, ${i.desc}, 1, ${i.amt}, ${i.amt})`;
	}
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[0]}, ${invoiceIds[0]}, 'mpesa', 3500, 'QK7X1IMANI', 'confirmed')`;
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[4]}, ${invoiceIds[4]}, 'mpesa', 3500, 'QK8Y2FAITH', 'confirmed')`;
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[6]}, ${invoiceIds[5]}, 'mpesa', 1000, 'QK7P4PETER', 'confirmed')`;
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[5]}, ${null}, 'mpesa', 100, 'QK9Z3VOUCH', 'confirmed')`;
	for (const r of [
		{
			name: "NBO-CORE-01",
			location: "Westlands POP",
			identity: "nbo-core-01",
			role: "core",
			wg: "connected",
			cpu: 18,
			up: 1420
		},
		{
			name: "NBO-AP-WEST",
			location: "Westlands rooftop",
			identity: "nbo-ap-west",
			role: "access",
			wg: "connected",
			cpu: 31,
			up: 640
		},
		{
			name: "MSA-EDGE-01",
			location: "Nyali",
			identity: "msa-edge-01",
			role: "edge",
			wg: "degraded",
			cpu: 67,
			up: 88
		}
	]) await sql`insert into routers (id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours)
      values (${nid("rtr")}, ${tenantId}, ${r.name}, ${r.location}, ${r.identity}, ${r.role}, ${r.wg}, now(), ${r.cpu}, ${r.up})`;
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status)
    values (${nid("tkt")}, ${tenantId}, ${customerIds[1]}, 'Slow speeds after 8pm', 'performance', 'high', 'assigned')`;
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status)
    values (${nid("tkt")}, ${tenantId}, ${customerIds[3]}, 'Service suspended — payment dispute', 'billing', 'normal', 'new')`;
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status)
    values (${nid("tkt")}, ${tenantId}, ${customerIds[5]}, 'Captive portal not loading', 'hotspot', 'high', 'on_site')`;
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status)
    values (${nid("tkt")}, ${tenantId}, ${null}, 'Fibre cut along Thika Road', 'network', 'urgent', 'travelling')`;
	await sql`update tenants set demo_seeded = true where id = ${tenantId}`;
	await seedOpsForTenant(sql, tenantId);
}
async function ensureWorkspace(sql, userId, displayName, email, ispName) {
	await applyRls(sql, { bypass: true });
	const profile = await loadAuthUser(sql, userId);
	const person = displayName || profile?.name || null;
	const mail = email || profile?.email || null;
	const workspace = await resolveActiveTenant(sql, userId) ?? await provisionTenant(sql, userId, {
		ispName,
		personName: person,
		email: mail
	});
	await applyRls(sql, {
		tenantId: workspace.tenantId,
		bypass: false
	});
	const [row] = await sql`select demo_seeded from tenants where id = ${workspace.tenantId}`;
	if (!row?.demo_seeded) {
		await applyRls(sql, { bypass: true });
		await seedDemo(sql, workspace.tenantId);
		await applyRls(sql, {
			tenantId: workspace.tenantId,
			bypass: false
		});
	}
	await ensureDefaultTemplates(sql, workspace.tenantId);
	await seedOpsForTenant(sql, workspace.tenantId);
	return workspace;
}
async function requireTenant(userId, displayName, email, ispName) {
	const sql = await getSql();
	return {
		sql,
		workspace: await ensureWorkspace(sql, userId, displayName ?? null, email ?? null, ispName)
	};
}
var bootstrapWorkspace_createServerFn_handler = createServerRpc({
	id: "b82b9e563917b8ca5c159855fbc036e93fae3ccf99f0f58fdfb124f9e0633d05",
	name: "bootstrapWorkspace",
	filename: "src/lib/isp/server.ts"
}, (opts) => bootstrapWorkspace.__executeServer(opts));
var bootstrapWorkspace = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(bootstrapWorkspace_createServerFn_handler, async ({ context, data }) => {
	const { workspace } = await requireTenant(context.userId, null, null, data.isp_name);
	return workspace;
});
var listMyTenants_createServerFn_handler = createServerRpc({
	id: "8929e8e5986deeb9ce8e7ffa5893daae647c195cd73a4c594d7ce92cb7b58654",
	name: "listMyTenants",
	filename: "src/lib/isp/server.ts"
}, (opts) => listMyTenants.__executeServer(opts));
var listMyTenants = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listMyTenants_createServerFn_handler, async ({ context }) => {
	const sql = await getSql();
	const { listMemberships } = await import("./accounts-CrIvUMZR.mjs").then((n) => n.t).then((n) => n.l);
	const rows = await listMemberships(sql, context.userId);
	return {
		activeId: (await resolveActiveTenant(sql, context.userId))?.tenantId ?? "",
		tenants: rows.map((r) => ({
			id: r.tenant_id,
			name: r.name,
			role: r.role
		}))
	};
});
var switchTenant_createServerFn_handler = createServerRpc({
	id: "f953d0c914d0090460292b04ae97b9a85879f43955ccd44d3aa35bec7b7b9b4c",
	name: "switchTenant",
	filename: "src/lib/isp/server.ts"
}, (opts) => switchTenant.__executeServer(opts));
var switchTenant = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(switchTenant_createServerFn_handler, async ({ context, data }) => {
	const sql = await getSql();
	const ws = await setActiveTenant(sql, context.userId, data.tenant_id);
	await audit(sql, ws.tenantId, context.userId, "tenant.switched", "tenant", ws.tenantId);
	return ws;
});
var getDashboard_createServerFn_handler = createServerRpc({
	id: "cb0a572eb9356911f9f3e76366206dc0242d0bce25cc9dd2ed0a14acbe0a95dd",
	name: "getDashboard",
	filename: "src/lib/isp/server.ts"
}, (opts) => getDashboard.__executeServer(opts));
var getDashboard = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(getDashboard_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const [cust] = await sql`select count(*)::int as n from customers where tenant_id = ${tid}`;
	const [active] = await sql`select count(*)::int as n from customers where tenant_id = ${tid} and status = 'active'`;
	const [susp] = await sql`select count(*)::int as n from services where tenant_id = ${tid} and status = 'suspended'`;
	const [online] = await sql`select count(*)::int as n from services where tenant_id = ${tid} and status = 'active'`;
	const [rev] = await sql`select coalesce(sum(amount_kes),0)::int as n from payments where tenant_id = ${tid} and status = 'confirmed'`;
	const [out] = await sql`select coalesce(sum(greatest(0, amount_kes - paid_kes)),0)::int as n from invoices where tenant_id = ${tid} and status in ('due','overdue','issued','partial')`;
	const [today] = await sql`select coalesce(sum(amount_kes),0)::int as n from payments where tenant_id = ${tid} and paid_at::date = current_date`;
	const [tix] = await sql`select count(*)::int as n from tickets where tenant_id = ${tid} and status not in ('closed','resolved')`;
	const [ron] = await sql`select count(*)::int as n from routers where tenant_id = ${tid} and wg_status = 'connected'`;
	const [rtot] = await sql`select count(*)::int as n from routers where tenant_id = ${tid}`;
	const [notes] = await sql`select count(*)::int as n from notification_logs where tenant_id = ${tid} and created_at::date = current_date`;
	const recentPayments = await sql`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid}
      order by p.paid_at desc limit 6`;
	const recentTickets = await sql`
      select t.id, t.customer_id, c.name as customer_name, t.title, t.category, t.priority, t.status, t.created_at::text as created_at
      from tickets t left join customers c on c.id = t.customer_id
      where t.tenant_id = ${tid}
      order by t.created_at desc limit 5`;
	const routers = await sql`
      select id, name, location, identity, role, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours
      from routers where tenant_id = ${tid} order by name`;
	return {
		workspace,
		totals: {
			customers: cust?.n ?? 0,
			active: active?.n ?? 0,
			suspended: susp?.n ?? 0,
			online: online?.n ?? 0,
			revenueMonth: rev?.n ?? 0,
			outstanding: out?.n ?? 0,
			paymentsToday: today?.n ?? 0,
			openTickets: tix?.n ?? 0,
			routersOnline: ron?.n ?? 0,
			routersTotal: rtot?.n ?? 0,
			noticesToday: notes?.n ?? 0
		},
		recentPayments,
		recentTickets,
		routers
	};
});
var listCustomers_createServerFn_handler = createServerRpc({
	id: "d9d3c88c37b6987ccdc28add8b12626a91aa49ac24954d749898588ad38cfc0b",
	name: "listCustomers",
	filename: "src/lib/isp/server.ts"
}, (opts) => listCustomers.__executeServer(opts));
var listCustomers = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listCustomers_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return {
		workspace,
		customers: await sql`
      select c.id, c.type, c.name, c.phone, c.email, c.address, c.status, c.created_at::text as created_at,
        (select count(*)::int from services s where s.customer_id = c.id) as service_count,
        (select coalesce(sum(greatest(0, i.amount_kes - i.paid_kes)),0)::int from invoices i where i.customer_id = c.id and i.status in ('due','overdue','issued','partial')) as balance_kes
      from customers c
      where c.tenant_id = ${workspace.tenantId}
      order by c.created_at desc`
	};
});
var createCustomer_createServerFn_handler = createServerRpc({
	id: "7333f74816133aef0c5a756e38329e0b8ebbd9bf77e991cdefd304a698570ff3",
	name: "createCustomer",
	filename: "src/lib/isp/server.ts"
}, (opts) => createCustomer.__executeServer(opts));
var createCustomer = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createCustomer_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const name = data.name.trim();
	if (!name) throw new Error("Name is required");
	await assertCustomerQuota(sql, workspace.tenantId);
	const id = nid("cus");
	await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
      values (${id}, ${workspace.tenantId}, ${data.type || "individual"}, ${name}, ${data.phone.trim()}, ${data.email.trim()}, ${data.address.trim()}, 'active')`;
	await emit(sql, {
		type: "customer.created",
		tenantId: workspace.tenantId,
		payload: {
			customer_id: id,
			phone: data.phone,
			name
		}
	});
	await audit(sql, workspace.tenantId, context.userId, "customer.created", "customer", id);
	return { id };
});
var listPackages_createServerFn_handler = createServerRpc({
	id: "e78843982652677c66d853dedd123a6a16bf73e7398cde1a3c81a6f0678c1e37",
	name: "listPackages",
	filename: "src/lib/isp/server.ts"
}, (opts) => listPackages.__executeServer(opts));
var listPackages = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listPackages_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return {
		workspace,
		packages: await sql`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
      from packages where tenant_id = ${workspace.tenantId} order by price_kes`
	};
});
var createPackage_createServerFn_handler = createServerRpc({
	id: "62f12a16c4a9fbb6f3114600ea27fcf4af4d5fa62aea2d9bab5e729f32e46b02",
	name: "createPackage",
	filename: "src/lib/isp/server.ts"
}, (opts) => createPackage.__executeServer(opts));
var createPackage = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createPackage_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (!data.name.trim()) throw new Error("Name is required");
	if (![
		"pppoe",
		"static",
		"hotspot"
	].includes(data.access_method)) throw new Error("Access method must be PPPoE, static, or hotspot");
	const id = nid("pkg");
	await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.description}, ${data.access_method}, ${data.download_mbps}, ${data.upload_mbps}, ${data.price_kes}, ${data.billing_interval}, ${data.grace_days}, ${Math.max(0, data.bundle_mb ?? 0)}, ${Math.max(0, data.validity_hours ?? 0)}, true)`;
	await audit(sql, workspace.tenantId, context.userId, "package.created", "package", id);
	return { id };
});
var updatePackage_createServerFn_handler = createServerRpc({
	id: "f8152056cc910d521a7b215c86a67025896f3f669f7546d227d9af72f86ff250",
	name: "updatePackage",
	filename: "src/lib/isp/server.ts"
}, (opts) => updatePackage.__executeServer(opts));
var updatePackage = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(updatePackage_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (!data.name.trim()) throw new Error("Name is required");
	if (![
		"pppoe",
		"static",
		"hotspot"
	].includes(data.access_method)) throw new Error("Access method must be PPPoE, static, or hotspot");
	if (!(await sql`
      update packages
      set name = ${data.name.trim()},
          description = ${data.description},
          access_method = ${data.access_method},
          download_mbps = ${data.download_mbps},
          upload_mbps = ${data.upload_mbps},
          price_kes = ${data.price_kes},
          billing_interval = ${data.billing_interval},
          grace_days = ${data.grace_days},
          bundle_mb = ${Math.max(0, data.bundle_mb ?? 0)},
          validity_hours = ${Math.max(0, data.validity_hours ?? 0)},
          active = ${data.active}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}
      returning id`)[0]) throw new Error("Package not found");
	await audit(sql, workspace.tenantId, context.userId, "package.updated", "package", data.id);
	return { id: data.id };
});
var listServices_createServerFn_handler = createServerRpc({
	id: "6dc3a12f614ad2143321f5f24d068bfc75df5f073d111dea1f2d907e95cc4c4f",
	name: "listServices",
	filename: "src/lib/isp/server.ts"
}, (opts) => listServices.__executeServer(opts));
var listServices = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listServices_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return {
		workspace,
		services: await sql`
      select s.id, s.customer_id, c.name as customer_name, s.package_id, p.name as package_name,
             s.access_method, s.username, s.static_ip, s.status, s.created_at::text as created_at,
             s.period_end::text as period_end, s.bundle_used_mb, p.bundle_mb, s.suspend_reason
      from services s
      join customers c on c.id = s.customer_id
      join packages p on p.id = s.package_id
      where s.tenant_id = ${workspace.tenantId}
      order by s.created_at desc`,
		customers: await sql`select id, name from customers where tenant_id = ${workspace.tenantId} order by name`,
		packages: await sql`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, bundle_mb, validity_hours, active
      from packages where tenant_id = ${workspace.tenantId} and active = true`
	};
});
var createService_createServerFn_handler = createServerRpc({
	id: "fb8f4084dd5b89df9ed7de4fee9d7846f044eceed9cafadec3e9fc9138dc4d5e",
	name: "createService",
	filename: "src/lib/isp/server.ts"
}, (opts) => createService.__executeServer(opts));
var createService = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createService_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const [pkg] = await sql`select name, access_method, price_kes, billing_interval, validity_hours
       from packages where id = ${data.package_id} and tenant_id = ${tid}`;
	if (!pkg) throw new Error("Package not found");
	const [cus] = await sql`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
	if (!cus) throw new Error("Customer not found");
	const id = nid("svc");
	const { periodMs } = await import("./access-policy-BX1fKswR.mjs").then((n) => n.t).then((n) => n.t);
	const periodEnd = new Date(Date.now() + periodMs(pkg.billing_interval, pkg.validity_hours)).toISOString();
	await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
      values (${id}, ${tid}, ${data.customer_id}, ${data.package_id}, ${pkg.access_method}, ${data.username || null}, ${data.static_ip || null}, 'active', ${periodEnd})`;
	if (pkg.access_method === "static" && !data.static_ip) await allocateStaticIp(sql, tid, id, data.customer_id);
	const radius = await provisionServiceAccess(sql, tid, id);
	if (!(await sql`
      select id from invoices where tenant_id = ${tid} and customer_id = ${data.customer_id}
      and status in ('issued','due','overdue','partial') limit 1`)[0] && pkg.price_kes > 0) {
		const due = /* @__PURE__ */ new Date();
		due.setDate(due.getDate() + 7);
		const inv = await issueInvoice(sql, {
			tenantId: tid,
			customerId: data.customer_id,
			dueDate: due.toISOString().slice(0, 10),
			items: [{
				description: `${pkg.name} (${pkg.billing_interval})`,
				quantity: 1,
				unit_kes: pkg.price_kes,
				package_id: data.package_id,
				service_id: id
			}]
		});
		await notifyCustomerEvent(sql, tid, workspace.tenantName, data.customer_id, "invoice.created", inv.id, {
			customer_name: "",
			invoice_number: inv.number,
			amount: `KES ${inv.amount_kes}`,
			due_date: due.toISOString().slice(0, 10)
		});
	}
	await audit(sql, tid, context.userId, "service.created", "service", id);
	return {
		id,
		username: radius?.username,
		password: radius?.password
	};
});
var setServiceStatus_createServerFn_handler = createServerRpc({
	id: "107df89607f4cf5642dd84e0b797075cd2a0d6ae8daf02cb91ea183e8afc75a8",
	name: "setServiceStatus",
	filename: "src/lib/isp/server.ts"
}, (opts) => setServiceStatus.__executeServer(opts));
var setServiceStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(setServiceStatus_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (data.status === "active") {
		const [row] = await sql`
        select customer_id from services where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
		if (row) {
			const { grantPaidPeriod } = await import("./access-policy-BX1fKswR.mjs").then((n) => n.t).then((n) => n.t);
			await grantPaidPeriod(sql, workspace.tenantId, row.customer_id);
		}
	}
	const reason = data.status === "suspended" ? "manual" : data.status === "active" ? "" : "invoice";
	await sql`update services set status = ${data.status}, suspend_reason = ${reason}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
	const [svc] = await sql`
      select s.customer_id, p.name from services s join packages p on p.id = s.package_id
      where s.id = ${data.id} and s.tenant_id = ${workspace.tenantId}`;
	if (svc && data.status === "suspended") await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "service.suspended", data.id, {
		customer_name: "",
		service_name: svc.name
	});
	if (svc && data.status === "active") await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "service.restored", data.id, {
		customer_name: "",
		service_name: svc.name
	});
	if (svc && data.status === "grace") await notifyCustomerEvent(sql, workspace.tenantId, workspace.tenantName, svc.customer_id, "grace.started", data.id, {
		customer_name: "",
		service_name: svc.name
	});
	await provisionServiceAccess(sql, workspace.tenantId, data.id);
	await audit(sql, workspace.tenantId, context.userId, `service.${data.status}`, "service", data.id);
	return { ok: true };
});
var rotateServiceSecret_createServerFn_handler = createServerRpc({
	id: "9dee39d4fd2d27ce30ac377dc62a55edac44617b8da966df91c157c853d4ba6a",
	name: "rotateServiceSecret",
	filename: "src/lib/isp/server.ts"
}, (opts) => rotateServiceSecret.__executeServer(opts));
var rotateServiceSecret = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(rotateServiceSecret_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	assertPermission(workspace.role, "services.manage");
	const out = await rotateServicePassword(sql, workspace.tenantId, data.id);
	await audit(sql, workspace.tenantId, context.userId, "service.password", "service", data.id);
	return out;
});
var disconnectService_createServerFn_handler = createServerRpc({
	id: "b923f07b4b4fa0d4e93188fd249a30703fef1cedc4b3e0d414bf7ce756503493",
	name: "disconnectService",
	filename: "src/lib/isp/server.ts"
}, (opts) => disconnectService.__executeServer(opts));
var disconnectService = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(disconnectService_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	assertPermission(workspace.role, "services.manage");
	const out = await disconnectSession(sql, workspace.tenantId, data.id);
	await audit(sql, workspace.tenantId, context.userId, "service.disconnect", "service", data.id);
	return out;
});
var listBilling_createServerFn_handler = createServerRpc({
	id: "3038cd6cc8f6f407e8479001e53c68728b0cc653d5648490041e1270e05909e0",
	name: "listBilling",
	filename: "src/lib/isp/server.ts"
}, (opts) => listBilling.__executeServer(opts));
var listBilling = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listBilling_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const invoices = await sql`
      select i.id, i.customer_id, c.name as customer_name, i.number, i.amount_kes,
             i.subtotal_kes, i.tax_kes, i.tax_rate, i.paid_kes,
             case when i.status = 'paid' then 0 else greatest(0, i.amount_kes - i.paid_kes) end as remaining_kes,
             i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes
      from invoices i join customers c on c.id = i.customer_id
      where i.tenant_id = ${tid}
      order by i.issued_at desc`;
	const payments = await sql`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid}
      order by p.paid_at desc`;
	const customers = await sql`
      select id, name, phone from customers where tenant_id = ${tid} order by name`;
	const quotes = await sql`
      select s.customer_id, p.id as package_id, s.id as service_id, p.name as package_name, p.price_kes, p.billing_interval
      from services s join packages p on p.id = s.package_id
      where s.tenant_id = ${tid} and s.status in ('active','grace','suspended','pending')
      order by p.price_kes`;
	const [ten] = await sql`
      select vat_enabled, vat_rate_pct from tenants where id = ${tid}`;
	const { tallyAging } = await import("./aging-D-i0c_IO.mjs").then((n) => n.t);
	const aging = tallyAging(invoices);
	const outstanding = invoices.reduce((s, i) => s + i.remaining_kes, 0);
	const overdue = invoices.filter((i) => i.status === "overdue" || i.status === "partial" && i.remaining_kes > 0 && i.due_date < (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)).reduce((s, i) => s + i.remaining_kes, 0);
	const collected = payments.filter((p) => p.status === "confirmed").reduce((s, p) => s + p.amount_kes, 0);
	const open = invoices.filter((i) => i.remaining_kes > 0).length;
	return {
		workspace,
		invoices,
		payments,
		customers,
		quotes,
		vat_enabled: Boolean(ten?.vat_enabled),
		vat_rate_pct: ten?.vat_rate_pct ?? 16,
		aging,
		totals: {
			outstanding,
			overdue,
			collected,
			open
		}
	};
});
var getInvoice_createServerFn_handler = createServerRpc({
	id: "d29992f7e813ce2a2df10e18aa1531c7a7662ea27648ba573b424d6e6a12e10a",
	name: "getInvoice",
	filename: "src/lib/isp/server.ts"
}, (opts) => getInvoice.__executeServer(opts));
var getInvoice = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(getInvoice_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const [invoice] = await sql`
      select i.id, i.customer_id, c.name as customer_name, i.number, i.amount_kes,
             i.subtotal_kes, i.tax_kes, i.tax_rate, i.paid_kes,
             case when i.status = 'paid' then 0 else greatest(0, i.amount_kes - i.paid_kes) end as remaining_kes,
             i.status, i.due_date::text as due_date, i.issued_at::text as issued_at, i.notes
      from invoices i join customers c on c.id = i.customer_id
      where i.id = ${data.id} and i.tenant_id = ${tid}`;
	if (!invoice) throw new Error("Invoice not found");
	const [customer] = await sql`select id, name, phone, email, address from customers where id = ${invoice.customer_id} and tenant_id = ${tid}`;
	return {
		invoice,
		customer,
		items: await sql`select id, description, quantity, unit_kes, amount_kes from invoice_items
       where invoice_id = ${invoice.id} and tenant_id = ${tid} order by description`,
		payments: await sql`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.invoice_id = ${invoice.id} and p.tenant_id = ${tid}
      order by p.paid_at desc`,
		allocations: await sql`
      select id, payment_id, amount_kes from payment_allocations where invoice_id = ${invoice.id} and tenant_id = ${tid}`,
		tenant: {
			name: workspace.tenantName,
			supportEmail: workspace.supportEmail,
			supportPhone: workspace.supportPhone
		}
	};
});
var saveBillingSettings_createServerFn_handler = createServerRpc({
	id: "d10de407eff592c85952061661ba87d1fba7422d507030cb442c829f990cc222",
	name: "saveBillingSettings",
	filename: "src/lib/isp/server.ts"
}, (opts) => saveBillingSettings.__executeServer(opts));
var saveBillingSettings = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(saveBillingSettings_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	assertPermission(workspace.role, "invoices.manage");
	const rate = Math.min(100, Math.max(0, Math.round(data.vat_rate_pct ?? 16)));
	await sql`update tenants set vat_enabled = ${data.vat_enabled}, vat_rate_pct = ${rate} where id = ${workspace.tenantId}`;
	await audit(sql, workspace.tenantId, context.userId, "billing.settings", "tenant", workspace.tenantId);
	return {
		vat_enabled: data.vat_enabled,
		vat_rate_pct: rate
	};
});
var createInvoice_createServerFn_handler = createServerRpc({
	id: "6a88e38a76ab45f9b3bd545076de5dca7a1c8e894e5cf2c824a687763893288a",
	name: "createInvoice",
	filename: "src/lib/isp/server.ts"
}, (opts) => createInvoice.__executeServer(opts));
var createInvoice = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createInvoice_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	assertPermission(workspace.role, "invoices.manage");
	const [cus] = await sql`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
	if (!cus) throw new Error("Customer not found");
	const inv = await issueInvoice(sql, {
		tenantId: tid,
		customerId: data.customer_id,
		dueDate: data.due_date,
		amountKes: data.amount_kes,
		items: data.items,
		notes: data.notes
	});
	await notifyCustomerEvent(sql, tid, workspace.tenantName, data.customer_id, "invoice.created", inv.id, {
		customer_name: "",
		invoice_number: inv.number,
		amount: `KES ${inv.amount_kes}`,
		due_date: data.due_date
	});
	await audit(sql, tid, context.userId, "invoice.created", "invoice", inv.id);
	return inv;
});
var recordPayment_createServerFn_handler = createServerRpc({
	id: "21aa30200fbb871771a87c4ace21132b156363e6170f90c2c46f9c3c37e47d6a",
	name: "recordPayment",
	filename: "src/lib/isp/server.ts"
}, (opts) => recordPayment.__executeServer(opts));
var recordPayment = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(recordPayment_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	assertPermission(workspace.role, "payments.manage");
	const [inv] = await sql`
      select id from invoices where id = ${data.invoice_id} and tenant_id = ${tid}`;
	if (!inv) throw new Error("Invoice not found");
	const result = await applyConfirmedPayment(sql, {
		tenantId: tid,
		ispName: workspace.tenantName,
		invoiceId: inv.id,
		provider: data.provider || "mpesa",
		reference: data.reference.trim() || `MPESA-${Date.now()}`,
		amountKes: data.amount_kes
	});
	await audit(sql, tid, context.userId, "payment.received", "payment", result.id);
	return {
		id: result.id,
		amount: result.amount,
		status: result.status
	};
});
var listRouters_createServerFn_handler = createServerRpc({
	id: "5139ec72ef7cd95594c293eae3021b86b86a3c91020bab91f8cdcf531ddefbb1",
	name: "listRouters",
	filename: "src/lib/isp/server.ts"
}, (opts) => listRouters.__executeServer(opts));
var listRouters = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listRouters_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return {
		workspace,
		routers: await sql`
      select id, name, location, identity, role, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours,
             wg_public, wg_address, agent_version
      from routers where tenant_id = ${workspace.tenantId} order by name`
	};
});
var addRouter_createServerFn_handler = createServerRpc({
	id: "1da6e3801cdc10c2df0cca6dc0e85b43356baa8aeef50bba4d00741b618b05c8",
	name: "addRouter",
	filename: "src/lib/isp/server.ts"
}, (opts) => addRouter.__executeServer(opts));
var addRouter = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(addRouter_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (!data.name.trim()) throw new Error("Name is required");
	assertPermission(workspace.role, "routers.manage");
	const id = nid("rtr");
	const count = await sql`select count(*)::int as n from routers where tenant_id = ${workspace.tenantId}`;
	const enroll = enrollFields(data.name);
	const wgAddress = wgAddressForIndex((count[0]?.n ?? 0) + 1);
	await sql`insert into routers (id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours, enroll_token, wg_public, wg_address, agent_version, wg_private_ref)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.location.trim()}, ${data.identity.trim() || data.name.trim().toLowerCase()}, ${data.role || "access"}, 'pending', now(), 0, 0, ${enroll.token}, ${enroll.wg_public}, ${wgAddress}, '0.2.0', ${enroll.wg_private_sealed})`;
	await audit(sql, workspace.tenantId, context.userId, "router.created", "router", id);
	const [ten] = await sql`select public_base_url from tenants where id = ${workspace.tenantId}`;
	return {
		id,
		script: agentScript({
			name: data.name.trim(),
			identity: data.identity.trim() || data.name.trim().toLowerCase(),
			token: enroll.token,
			wgPublic: enroll.wg_public,
			wgAddress,
			pullUrl: agentPullUrl(ten?.public_base_url || "", enroll.token)
		}),
		token: enroll.token
	};
});
var listTickets_createServerFn_handler = createServerRpc({
	id: "fbbe28f960b118c4ac3fcbc69927b1048dd832e6275e0258b170198c07a264bf",
	name: "listTickets",
	filename: "src/lib/isp/server.ts"
}, (opts) => listTickets.__executeServer(opts));
var listTickets = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listTickets_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return {
		workspace,
		tickets: await sql`
      select t.id, t.customer_id, c.name as customer_name, t.title, t.category, t.priority, t.status, t.assigned_to, t.created_at::text as created_at
      from tickets t left join customers c on c.id = t.customer_id
      where t.tenant_id = ${workspace.tenantId}
      order by t.created_at desc`,
		customers: await sql`select id, name from customers where tenant_id = ${workspace.tenantId} order by name`
	};
});
var createTicket_createServerFn_handler = createServerRpc({
	id: "830e682f10512ee2eee1cd75d71f0db022bb8c479fea20858c2e35a1f11eb0d9",
	name: "createTicket",
	filename: "src/lib/isp/server.ts"
}, (opts) => createTicket.__executeServer(opts));
var createTicket = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(createTicket_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	assertPermission(workspace.role, "tickets.manage");
	if (!data.title.trim()) throw new Error("Title is required");
	const opened = await openTicket(sql, workspace.tenantId, data);
	await audit(sql, workspace.tenantId, context.userId, "ticket.created", "ticket", opened.id);
	return opened;
});
var setTicketStatus_createServerFn_handler = createServerRpc({
	id: "f9f4f5cc635047ddc6b6f5a986c941472688c45a108340df6f8c5cba87355c52",
	name: "setTicketStatus",
	filename: "src/lib/isp/server.ts"
}, (opts) => setTicketStatus.__executeServer(opts));
var setTicketStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(setTicketStatus_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	assertPermission(workspace.role, workspace.role === "technician" ? "jobs.update" : "tickets.manage");
	if (workspace.role === "technician") {
		const [t] = await sql`
        select assigned_to from tickets where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
		if (t && t.assigned_to && t.assigned_to !== context.userId) throw new Error("Not assigned to you");
	}
	await sql`update tickets set status = ${data.status} where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
	return { ok: true };
});
var renameTenant_createServerFn_handler = createServerRpc({
	id: "927c7845d2692853774f93db8a0bf205fde11794f72073a81ed2f971cc41d4dd",
	name: "renameTenant",
	filename: "src/lib/isp/server.ts"
}, (opts) => renameTenant.__executeServer(opts));
var renameTenant = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(renameTenant_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (workspace.role !== "isp_owner" && workspace.role !== "isp_admin") throw new Error("Not allowed");
	const name = data.name.trim();
	if (!name) throw new Error("Name is required");
	await sql`update tenants set name = ${name}, support_email = ${data.supportEmail.trim()}, support_phone = ${data.supportPhone.trim()}
      where id = ${workspace.tenantId}`;
	return { ok: true };
});
var importCustomers_createServerFn_handler = createServerRpc({
	id: "4cdcbc4d92e44f708c9ad19679788d00e050ec32d37b244e75e96e6be971c79b",
	name: "importCustomers",
	filename: "src/lib/isp/server.ts"
}, (opts) => importCustomers.__executeServer(opts));
var importCustomers = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(importCustomers_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const pkgs = await sql`
      select id, name, access_method from packages where tenant_id = ${tid}`;
	let created = 0;
	const errors = [];
	for (let i = 0; i < data.rows.length; i++) {
		const row = data.rows[i];
		const line = i + 2;
		if (!row.name?.trim()) {
			errors.push(`Row ${line}: name required`);
			continue;
		}
		const method = (row.access_method || "pppoe").toLowerCase();
		if (![
			"pppoe",
			"static",
			"hotspot"
		].includes(method)) {
			errors.push(`Row ${line}: invalid access method`);
			continue;
		}
		const pkg = pkgs.find((p) => p.name.toLowerCase() === row.package_name.trim().toLowerCase()) || pkgs.find((p) => p.access_method === method);
		if (!pkg) {
			errors.push(`Row ${line}: no matching package`);
			continue;
		}
		if (method === "pppoe" && !row.username?.trim()) {
			errors.push(`Row ${line}: PPPoE username required`);
			continue;
		}
		if (method === "static" && !row.static_ip?.trim()) {
			errors.push(`Row ${line}: static IP required`);
			continue;
		}
		const cid = nid("cus");
		await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
        values (${cid}, ${tid}, 'individual', ${row.name.trim()}, ${row.phone || ""}, ${row.email || ""}, ${row.address || ""}, 'active')`;
		const sid = nid("svc");
		const periodEnd = new Date(Date.now() + 2592e6).toISOString();
		await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status, period_end)
        values (${sid}, ${tid}, ${cid}, ${pkg.id}, ${method}, ${row.username || null}, ${row.static_ip || null}, 'pending', ${periodEnd})`;
		await provisionServiceAccess(sql, tid, sid);
		created += 1;
	}
	await audit(sql, tid, context.userId, "customers.imported", "customer", String(created));
	return {
		created,
		errors
	};
});
var exportCustomersCsv_createServerFn_handler = createServerRpc({
	id: "9f22ac761f3885e9157652a1b6472e6e6ae76548e42fc0a8ea03e999587dd762",
	name: "exportCustomersCsv",
	filename: "src/lib/isp/server.ts"
}, (opts) => exportCustomersCsv.__executeServer(opts));
var exportCustomersCsv = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(exportCustomersCsv_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	return `name,phone,email,address,access_method,username,static_ip,package_name,service_status\n${(await sql`
      select c.name, c.phone, c.email, c.address, s.access_method, s.username, s.static_ip, p.name as package_name, s.status as service_status
      from customers c
      left join services s on s.customer_id = c.id
      left join packages p on p.id = s.package_id
      where c.tenant_id = ${workspace.tenantId}
      order by c.name`).map((r) => [
		r.name,
		r.phone,
		r.email,
		r.address,
		r.access_method ?? "",
		r.username ?? "",
		r.static_ip ?? "",
		r.package_name ?? "",
		r.service_status ?? ""
	].map((v) => `"${String(v).replaceAll("\"", "\"\"")}"`).join(",")).join("\n")}\n`;
});
var listNotifications_createServerFn_handler = createServerRpc({
	id: "9cb7069991d792125d9fa6cef27b8221211dbe1658c23ed02fdcaff14e11d073",
	name: "listNotifications",
	filename: "src/lib/isp/server.ts"
}, (opts) => listNotifications.__executeServer(opts));
var listNotifications = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listNotifications_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	await ensureDefaultTemplates(sql, workspace.tenantId);
	return {
		workspace,
		logs: await sql`
      select n.id, n.customer_id, c.name as customer_name, n.event_code, n.channel, n.subject, n.body,
             n.destination, n.status, n.created_at::text as created_at
      from notification_logs n
      left join customers c on c.id = n.customer_id
      where n.tenant_id = ${workspace.tenantId}
      order by n.created_at desc
      limit 100`,
		templates: await sql`
      select id, event_code, channel, subject, body, enabled
      from notification_templates where tenant_id = ${workspace.tenantId}
      order by event_code, channel`,
		inbox: await listInbox(sql, workspace.tenantId)
	};
});
var updateNotificationTemplate_createServerFn_handler = createServerRpc({
	id: "0574a099e85b0ffe882dd02d0c85145cabf5dafcc9e3581213ecb1405412ffe1",
	name: "updateNotificationTemplate",
	filename: "src/lib/isp/server.ts"
}, (opts) => updateNotificationTemplate.__executeServer(opts));
var updateNotificationTemplate = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(updateNotificationTemplate_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	if (!(await sql`
      update notification_templates
      set subject = ${data.subject}, body = ${data.body}, enabled = ${data.enabled}
      where id = ${data.id} and tenant_id = ${workspace.tenantId}
      returning id`)[0]) throw new Error("Template not found");
	return { ok: true };
});
var runAutomatedBilling_createServerFn_handler = createServerRpc({
	id: "a51779c6cac87f3eab85b8d9d511f5d1e76dbc9fbe42ae946556d155deadaf4e",
	name: "runAutomatedBilling",
	filename: "src/lib/isp/server.ts"
}, (opts) => runAutomatedBilling.__executeServer(opts));
var runAutomatedBilling = createServerFn({ method: "POST" }).middleware([authMiddleware]).handler(runAutomatedBilling_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const result = await runBillingCycle(sql, workspace.tenantId, workspace.tenantName);
	await audit(sql, workspace.tenantId, context.userId, "billing.cycle", "billing", workspace.tenantId);
	return result;
});
//#endregion
export { addRouter_createServerFn_handler, bootstrapWorkspace_createServerFn_handler, createCustomer_createServerFn_handler, createInvoice_createServerFn_handler, createPackage_createServerFn_handler, createService_createServerFn_handler, createTicket_createServerFn_handler, disconnectService_createServerFn_handler, exportCustomersCsv_createServerFn_handler, getDashboard_createServerFn_handler, getInvoice_createServerFn_handler, importCustomers_createServerFn_handler, listBilling_createServerFn_handler, listCustomers_createServerFn_handler, listMyTenants_createServerFn_handler, listNotifications_createServerFn_handler, listPackages_createServerFn_handler, listRouters_createServerFn_handler, listServices_createServerFn_handler, listTickets_createServerFn_handler, recordPayment_createServerFn_handler, renameTenant_createServerFn_handler, rotateServiceSecret_createServerFn_handler, runAutomatedBilling_createServerFn_handler, saveBillingSettings_createServerFn_handler, setServiceStatus_createServerFn_handler, setTicketStatus_createServerFn_handler, switchTenant_createServerFn_handler, updateNotificationTemplate_createServerFn_handler, updatePackage_createServerFn_handler };

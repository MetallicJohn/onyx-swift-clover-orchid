import { r as createServerFn } from "./ssr.mjs";
import { t as createServerRpc } from "./createServerRpc-CcvdN_gc.mjs";
import { i as slugify, r as nid } from "./utils-Cu94vfxT.mjs";
import { t as authMiddleware } from "./middleware-DSMJxnKB.mjs";
import { r as getSql } from "./db-Dt2G5COQ.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/server-DfJqWESy.js
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
			grace_days: 5
		},
		{
			id: nid("pkg"),
			name: "Home 20",
			description: "Residential 20/10 Mbps",
			access_method: "pppoe",
			download_mbps: 20,
			upload_mbps: 10,
			price_kes: 3500,
			billing_interval: "monthly",
			grace_days: 5
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
			grace_days: 3
		},
		{
			id: nid("pkg"),
			name: "Hotspot Day",
			description: "24-hour voucher",
			access_method: "hotspot",
			download_mbps: 8,
			upload_mbps: 4,
			price_kes: 100,
			billing_interval: "daily",
			grace_days: 0
		}
	];
	for (const p of pkgs) await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, active)
      values (${p.id}, ${tenantId}, ${p.name}, ${p.description}, ${p.access_method}, ${p.download_mbps}, ${p.upload_mbps}, ${p.price_kes}, ${p.billing_interval}, ${p.grace_days}, true)`;
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
	]) await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status)
      values (${nid("svc")}, ${tenantId}, ${customerIds[s.ci]}, ${pkgs[s.pi].id}, ${s.method}, ${s.username ?? null}, ${s.ip ?? null}, ${s.status})`;
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
			due: due(-2)
		},
		{
			ci: 1,
			n: "INV-1043",
			amt: 2500,
			st: "overdue",
			due: due(-4)
		},
		{
			ci: 2,
			n: "INV-1044",
			amt: 8500,
			st: "issued",
			due: due(12)
		},
		{
			ci: 3,
			n: "INV-1045",
			amt: 2500,
			st: "overdue",
			due: due(-8)
		},
		{
			ci: 4,
			n: "INV-1046",
			amt: 3500,
			st: "paid",
			due: due(6)
		},
		{
			ci: 6,
			n: "INV-1047",
			amt: 2500,
			st: "due",
			due: due(1)
		}
	];
	const invoiceIds = [];
	for (const i of invSpecs) {
		const id = nid("inv");
		invoiceIds.push(id);
		await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values (${id}, ${tenantId}, ${customerIds[i.ci]}, ${i.n}, ${i.amt}, ${i.st}, ${i.due})`;
	}
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[0]}, ${invoiceIds[0]}, 'mpesa', 3500, 'QK7X1IMANI', 'confirmed')`;
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
    values (${nid("pay")}, ${tenantId}, ${customerIds[4]}, ${invoiceIds[4]}, 'mpesa', 3500, 'QK8Y2FAITH', 'confirmed')`;
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
}
async function ensureWorkspace(sql, userId, displayName, email) {
	const existing = await sql`select t.id as tenant_id, t.name, t.slug, t.status, t.currency, m.role, t.support_email, t.support_phone, t.demo_seeded
     from tenant_members m
     join tenants t on t.id = m.tenant_id
     where m.user_id = ${userId}
     order by m.created_at asc
     limit 1`;
	if (existing[0]) {
		const row = existing[0];
		if (!row.demo_seeded) await seedDemo(sql, row.tenant_id);
		return {
			tenantId: row.tenant_id,
			tenantName: row.name,
			slug: row.slug,
			status: row.status,
			currency: row.currency,
			role: row.role,
			supportEmail: row.support_email,
			supportPhone: row.support_phone
		};
	}
	const tenantId = nid("ten");
	const baseName = displayName?.trim() || email?.split("@")[0] || "New ISP";
	const name = `${baseName}'s Network`;
	const slug = `${slugify(baseName)}-${tenantId.slice(-6)}`;
	await sql`insert into tenants (id, name, slug, status, currency, timezone, support_email)
    values (${tenantId}, ${name}, ${slug}, 'trial', 'KES', 'Africa/Nairobi', ${email ?? ""})`;
	await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${userId}, 'isp_owner')`;
	await seedDemo(sql, tenantId);
	await audit(sql, tenantId, userId, "tenant.created", "tenant", tenantId);
	return {
		tenantId,
		tenantName: name,
		slug,
		status: "trial",
		currency: "KES",
		role: "isp_owner",
		supportEmail: email ?? "",
		supportPhone: ""
	};
}
async function requireTenant(userId, displayName, email) {
	const sql = await getSql();
	return {
		sql,
		workspace: await ensureWorkspace(sql, userId, displayName ?? null, email ?? null)
	};
}
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
	const [out] = await sql`select coalesce(sum(amount_kes),0)::int as n from invoices where tenant_id = ${tid} and status in ('due','overdue','issued','partial')`;
	const [today] = await sql`select coalesce(sum(amount_kes),0)::int as n from payments where tenant_id = ${tid} and paid_at::date = current_date`;
	const [tix] = await sql`select count(*)::int as n from tickets where tenant_id = ${tid} and status not in ('closed','resolved')`;
	const [ron] = await sql`select count(*)::int as n from routers where tenant_id = ${tid} and wg_status = 'connected'`;
	const [rtot] = await sql`select count(*)::int as n from routers where tenant_id = ${tid}`;
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
			routersTotal: rtot?.n ?? 0
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
        (select coalesce(sum(i.amount_kes),0)::int from invoices i where i.customer_id = c.id and i.status in ('due','overdue','issued','partial')) as balance_kes
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
	const id = nid("cus");
	await sql`insert into customers (id, tenant_id, type, name, phone, email, address, status)
      values (${id}, ${workspace.tenantId}, ${data.type || "individual"}, ${name}, ${data.phone.trim()}, ${data.email.trim()}, ${data.address.trim()}, 'active')`;
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
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, active
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
	const id = nid("pkg");
	await sql`insert into packages (id, tenant_id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, active)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.description}, ${data.access_method}, ${data.download_mbps}, ${data.upload_mbps}, ${data.price_kes}, ${data.billing_interval}, ${data.grace_days}, true)`;
	await audit(sql, workspace.tenantId, context.userId, "package.created", "package", id);
	return { id };
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
             s.access_method, s.username, s.static_ip, s.status, s.created_at::text as created_at
      from services s
      join customers c on c.id = s.customer_id
      join packages p on p.id = s.package_id
      where s.tenant_id = ${workspace.tenantId}
      order by s.created_at desc`,
		customers: await sql`select id, name from customers where tenant_id = ${workspace.tenantId} order by name`,
		packages: await sql`
      select id, name, description, access_method, download_mbps, upload_mbps, price_kes, billing_interval, grace_days, active
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
	const [pkg] = await sql`select access_method from packages where id = ${data.package_id} and tenant_id = ${tid}`;
	if (!pkg) throw new Error("Package not found");
	const [cus] = await sql`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
	if (!cus) throw new Error("Customer not found");
	const id = nid("svc");
	await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status)
      values (${id}, ${tid}, ${data.customer_id}, ${data.package_id}, ${pkg.access_method}, ${data.username || null}, ${data.static_ip || null}, 'active')`;
	await audit(sql, tid, context.userId, "service.created", "service", id);
	return { id };
});
var setServiceStatus_createServerFn_handler = createServerRpc({
	id: "107df89607f4cf5642dd84e0b797075cd2a0d6ae8daf02cb91ea183e8afc75a8",
	name: "setServiceStatus",
	filename: "src/lib/isp/server.ts"
}, (opts) => setServiceStatus.__executeServer(opts));
var setServiceStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(setServiceStatus_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	await sql`update services set status = ${data.status} where id = ${data.id} and tenant_id = ${workspace.tenantId}`;
	await audit(sql, workspace.tenantId, context.userId, `service.${data.status}`, "service", data.id);
	return { ok: true };
});
var listBilling_createServerFn_handler = createServerRpc({
	id: "3038cd6cc8f6f407e8479001e53c68728b0cc653d5648490041e1270e05909e0",
	name: "listBilling",
	filename: "src/lib/isp/server.ts"
}, (opts) => listBilling.__executeServer(opts));
var listBilling = createServerFn({ method: "GET" }).middleware([authMiddleware]).handler(listBilling_createServerFn_handler, async ({ context }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	return {
		workspace,
		invoices: await sql`
      select i.id, i.customer_id, c.name as customer_name, i.number, i.amount_kes, i.status, i.due_date::text as due_date, i.issued_at::text as issued_at
      from invoices i join customers c on c.id = i.customer_id
      where i.tenant_id = ${tid}
      order by i.issued_at desc`,
		payments: await sql`
      select p.id, p.customer_id, c.name as customer_name, p.invoice_id, p.provider, p.amount_kes, p.reference, p.status, p.paid_at::text as paid_at
      from payments p join customers c on c.id = p.customer_id
      where p.tenant_id = ${tid}
      order by p.paid_at desc`,
		customers: await sql`select id, name from customers where tenant_id = ${tid} order by name`
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
	const [cus] = await sql`select id from customers where id = ${data.customer_id} and tenant_id = ${tid}`;
	if (!cus) throw new Error("Customer not found");
	const [{ n }] = await sql`select count(*)::int as n from invoices where tenant_id = ${tid}`;
	const number = `INV-${String(1e3 + n + 1)}`;
	const id = nid("inv");
	await sql`insert into invoices (id, tenant_id, customer_id, number, amount_kes, status, due_date)
      values (${id}, ${tid}, ${data.customer_id}, ${number}, ${data.amount_kes}, 'issued', ${data.due_date})`;
	await audit(sql, tid, context.userId, "invoice.created", "invoice", id);
	return {
		id,
		number
	};
});
var recordPayment_createServerFn_handler = createServerRpc({
	id: "21aa30200fbb871771a87c4ace21132b156363e6170f90c2c46f9c3c37e47d6a",
	name: "recordPayment",
	filename: "src/lib/isp/server.ts"
}, (opts) => recordPayment.__executeServer(opts));
var recordPayment = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(recordPayment_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
	const tid = workspace.tenantId;
	const [inv] = await sql`
      select id, customer_id, amount_kes, status from invoices where id = ${data.invoice_id} and tenant_id = ${tid}`;
	if (!inv) throw new Error("Invoice not found");
	const ref = data.reference.trim() || `MPESA-${Date.now()}`;
	if ((await sql`select id from payments where tenant_id = ${tid} and reference = ${ref}`)[0]) throw new Error("Duplicate payment reference");
	const payId = nid("pay");
	await sql`insert into payments (id, tenant_id, customer_id, invoice_id, provider, amount_kes, reference, status)
      values (${payId}, ${tid}, ${inv.customer_id}, ${inv.id}, ${data.provider || "mpesa"}, ${inv.amount_kes}, ${ref}, 'confirmed')`;
	await sql`update invoices set status = 'paid' where id = ${inv.id} and tenant_id = ${tid}`;
	await sql`update services set status = 'active' where customer_id = ${inv.customer_id} and tenant_id = ${tid} and status in ('grace','suspended','pending')`;
	await audit(sql, tid, context.userId, "payment.received", "payment", payId);
	return { id: payId };
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
      select id, name, location, identity, role, wg_status, last_seen::text as last_seen, cpu_pct, uptime_hours
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
	const id = nid("rtr");
	await sql`insert into routers (id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours)
      values (${id}, ${workspace.tenantId}, ${data.name.trim()}, ${data.location.trim()}, ${data.identity.trim() || data.name.trim().toLowerCase()}, ${data.role || "access"}, 'pending', now(), 0, 0)`;
	await audit(sql, workspace.tenantId, context.userId, "router.created", "router", id);
	return { id };
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
      select t.id, t.customer_id, c.name as customer_name, t.title, t.category, t.priority, t.status, t.created_at::text as created_at
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
	if (!data.title.trim()) throw new Error("Title is required");
	const id = nid("tkt");
	await sql`insert into tickets (id, tenant_id, customer_id, title, category, priority, status)
      values (${id}, ${workspace.tenantId}, ${data.customer_id || null}, ${data.title.trim()}, ${data.category}, ${data.priority}, 'new')`;
	await audit(sql, workspace.tenantId, context.userId, "ticket.created", "ticket", id);
	return { id };
});
var setTicketStatus_createServerFn_handler = createServerRpc({
	id: "f9f4f5cc635047ddc6b6f5a986c941472688c45a108340df6f8c5cba87355c52",
	name: "setTicketStatus",
	filename: "src/lib/isp/server.ts"
}, (opts) => setTicketStatus.__executeServer(opts));
var setTicketStatus = createServerFn({ method: "POST" }).middleware([authMiddleware]).validator((d) => d).handler(setTicketStatus_createServerFn_handler, async ({ context, data }) => {
	const { sql, workspace } = await requireTenant(context.userId);
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
		await sql`insert into services (id, tenant_id, customer_id, package_id, access_method, username, static_ip, status)
        values (${nid("svc")}, ${tid}, ${cid}, ${pkg.id}, ${method}, ${row.username || null}, ${row.static_ip || null}, 'pending')`;
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
//#endregion
export { addRouter_createServerFn_handler, createCustomer_createServerFn_handler, createInvoice_createServerFn_handler, createPackage_createServerFn_handler, createService_createServerFn_handler, createTicket_createServerFn_handler, exportCustomersCsv_createServerFn_handler, getDashboard_createServerFn_handler, importCustomers_createServerFn_handler, listBilling_createServerFn_handler, listCustomers_createServerFn_handler, listPackages_createServerFn_handler, listRouters_createServerFn_handler, listServices_createServerFn_handler, listTickets_createServerFn_handler, recordPayment_createServerFn_handler, renameTenant_createServerFn_handler, setServiceStatus_createServerFn_handler, setTicketStatus_createServerFn_handler };

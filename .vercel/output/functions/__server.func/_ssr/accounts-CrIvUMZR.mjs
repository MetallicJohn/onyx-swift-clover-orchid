import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
import { M as nid, b as applyRls, z as slugify } from "./access-1saCIo2_.mjs";
import { a as hashPassword$1, o as verifyPassword$1 } from "./db-Cj2MXHzY.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/accounts-CrIvUMZR.js
var accounts_CrIvUMZR_exports = /* @__PURE__ */ __exportAll({
	a: () => loadAuthUser,
	c: () => setActiveTenant,
	d: () => addBranch,
	f: () => addMemberByEmail,
	i: () => listAllTenants,
	l: () => tenant_context_exports,
	m: () => setMemberRole,
	n: () => createIspWithOwner,
	o: () => provisionTenant,
	p: () => listBranches,
	r: () => isPlatformAdmin,
	s: () => resolveActiveTenant,
	t: () => addStaffMember,
	u: () => assertPermission
});
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
var ROLE_PERMS = {
	isp_owner: ["*"],
	isp_admin: ["*"],
	finance: [
		"customers.read",
		"invoices.read",
		"invoices.manage",
		"payments.read",
		"payments.manage",
		"payments.reconcile",
		"packages.read",
		"services.read"
	],
	customer_care: [
		"customers.read",
		"customers.manage",
		"services.read",
		"invoices.read",
		"payments.read",
		"tickets.read",
		"tickets.manage",
		"packages.read"
	],
	network_engineer: [
		"customers.read",
		"services.read",
		"services.manage",
		"routers.read",
		"routers.manage",
		"network.read",
		"radius.manage",
		"wireguard.manage",
		"packages.read"
	],
	technician: [
		"tickets.assigned.read",
		"jobs.update",
		"customers.read",
		"services.read",
		"tickets.read"
	]
};
function permissionsFor(role) {
	return ROLE_PERMS[role] ?? [];
}
function hasPermission(role, permission) {
	const perms = ROLE_PERMS[role] ?? [];
	if (perms.includes("*")) return true;
	return perms.includes(permission);
}
function assertPermission(role, permission) {
	if (!hasPermission(role, permission)) throw new Error("Forbidden");
}
var tenant_context_exports = /* @__PURE__ */ __exportAll$1({
	listMemberships: () => listMemberships,
	resolveActiveTenant: () => resolveActiveTenant,
	setActiveTenant: () => setActiveTenant
});
async function listMemberships(sql, userId) {
	return sql`
    select t.id as tenant_id, t.name, t.slug, m.role, t.status, t.currency, t.support_email, t.support_phone
    from tenant_members m
    join tenants t on t.id = m.tenant_id
    where m.user_id = ${userId}
    order by t.name`;
}
async function membership(sql, userId, tenantId) {
	const [row] = await sql`select t.id as tenant_id, t.name, t.slug, m.role, t.status, t.currency, t.support_email, t.support_phone
     from tenant_members m
     join tenants t on t.id = m.tenant_id
     where m.user_id = ${userId} and t.id = ${tenantId}`;
	return row ?? null;
}
function toWorkspace$1(row) {
	return {
		tenantId: row.tenant_id,
		tenantName: row.name,
		slug: row.slug,
		status: row.status,
		currency: row.currency,
		role: row.role,
		supportEmail: row.support_email,
		supportPhone: row.support_phone,
		permissions: permissionsFor(row.role)
	};
}
async function setActiveTenant(sql, userId, tenantId) {
	const row = await membership(sql, userId, tenantId);
	if (!row) throw new Error("Not a member of that workspace");
	await sql`insert into user_active_tenant (user_id, tenant_id, updated_at)
    values (${userId}, ${tenantId}, now())
    on conflict (user_id) do update set tenant_id = ${tenantId}, updated_at = now()`;
	return toWorkspace$1(row);
}
async function resolveActiveTenant(sql, userId) {
	const [active] = await sql`
    select tenant_id from user_active_tenant where user_id = ${userId}`;
	if (active?.tenant_id) {
		const row = await membership(sql, userId, active.tenant_id);
		if (row) return toWorkspace$1(row);
	}
	const members = await listMemberships(sql, userId);
	if (!members[0]) return null;
	await sql`insert into user_active_tenant (user_id, tenant_id, updated_at)
    values (${userId}, ${members[0].tenant_id}, now())
    on conflict (user_id) do update set tenant_id = ${members[0].tenant_id}, updated_at = now()`;
	return toWorkspace$1(members[0]);
}
async function loadAuthUser(sql, userId) {
	const [row] = await sql`
    select id, name, email from "user" where id = ${userId}`;
	return row ?? null;
}
async function findAuthUserByEmail(sql, email) {
	const [row] = await sql`
    select id, name, email from "user" where lower(email) = ${email.trim().toLowerCase()}`;
	return row ?? null;
}
/** Create (or attach) a Better Auth email/password credential. Does not start a session. */
async function createCredentialAccount(sql, opts) {
	const email = opts.email.trim().toLowerCase();
	const name = opts.name.trim() || email.split("@")[0] || "Operator";
	const password = opts.password;
	if (!email.includes("@")) throw new Error("Enter a valid email");
	if (password.length < 8) throw new Error("Password must be at least 8 characters");
	const existing = await findAuthUserByEmail(sql, email);
	const hashed = await hashPassword$1(password);
	if (existing) {
		const [cred] = await sql`
      select id from account where "userId" = ${existing.id} and "providerId" = 'credential'`;
		if (cred) throw new Error("An account with that email already exists. They can sign in.");
		await sql`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      values (${crypto.randomUUID()}, ${existing.id}, 'credential', ${existing.id}, ${hashed}, now(), now())`;
		if (name && name !== existing.name) await sql`update "user" set name = ${name}, "updatedAt" = now() where id = ${existing.id}`;
		if (!await passwordVerifies(sql, email, password)) throw new Error("Could not store a sign-in password for that email");
		return {
			id: existing.id,
			name: name || existing.name,
			email: existing.email,
			created: false
		};
	}
	const userId = crypto.randomUUID();
	const accountId = crypto.randomUUID();
	await sql`insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
    values (${userId}, ${name}, ${email}, true, now(), now())`;
	await sql`insert into account (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
    values (${accountId}, ${userId}, 'credential', ${userId}, ${hashed}, now(), now())`;
	if (!await passwordVerifies(sql, email, password)) throw new Error("Could not store a sign-in password for that email");
	return {
		id: userId,
		name,
		email,
		created: true
	};
}
async function passwordVerifies(sql, email, password) {
	const user = await findAuthUserByEmail(sql, email);
	if (!user) return false;
	const [cred] = await sql`
    select password from account where "userId" = ${user.id} and "providerId" = 'credential'`;
	if (!cred?.password) return false;
	return verifyPassword$1({
		hash: cred.password,
		password
	});
}
async function isPlatformAdmin(sql, userId) {
	const [row] = await sql`
    select user_id from platform_admins where user_id = ${userId}`;
	return Boolean(row);
}
async function ensureFirstPlatformAdmin(sql, userId) {
	const [n] = await sql`select count(*)::int as n from platform_admins`;
	if ((n?.n ?? 0) > 0) return isPlatformAdmin(sql, userId);
	await sql`insert into platform_admins (user_id) values (${userId})
    on conflict (user_id) do nothing`;
	return true;
}
function toWorkspace(opts) {
	return {
		tenantId: opts.tenantId,
		tenantName: opts.name,
		slug: opts.slug,
		status: "trial",
		currency: "KES",
		role: opts.role,
		supportEmail: opts.email,
		supportPhone: "",
		permissions: permissionsFor(opts.role)
	};
}
/** Create an ISP tenant for a user who has none. No-op when they already belong somewhere. */
async function provisionTenant(sql, userId, opts = {}) {
	await applyRls(sql, { bypass: true });
	const existing = await resolveActiveTenant(sql, userId);
	if (existing) return existing;
	const profile = await loadAuthUser(sql, userId);
	const person = (opts.personName || profile?.name || opts.email || profile?.email || "New ISP").trim();
	const email = (opts.email || profile?.email || "").trim();
	const ispName = (opts.ispName || "").trim() || `${person.split("@")[0]}'s Network`;
	const tenantId = nid("ten");
	const slug = `${slugify(ispName)}-${tenantId.slice(-6)}`;
	await sql`insert into tenants (id, name, slug, status, currency, timezone, support_email)
    values (${tenantId}, ${ispName}, ${slug}, 'trial', 'KES', 'Africa/Nairobi', ${email})`;
	await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${userId}, 'isp_owner')`;
	await setActiveTenant(sql, userId, tenantId);
	await ensureFirstPlatformAdmin(sql, userId);
	await applyRls(sql, {
		tenantId,
		bypass: false
	});
	return toWorkspace({
		tenantId,
		name: ispName,
		slug,
		email,
		role: "isp_owner"
	});
}
async function addStaffMember(sql, tenantId, opts) {
	if (!isTenantRole(opts.role)) throw new Error("Unknown role");
	const email = opts.email.trim().toLowerCase();
	const password = (opts.password || "").trim();
	let user;
	if (password) user = await createCredentialAccount(sql, {
		email,
		password,
		name: opts.name || email.split("@")[0] || "Staff"
	});
	else {
		const found = await findAuthUserByEmail(sql, email);
		if (!found) throw new Error("Set a password to create their login, or they must sign up first.");
		user = found;
	}
	if ((await sql`
    select id from tenant_members where tenant_id = ${tenantId} and user_id = ${user.id}`)[0]) throw new Error("Already a member of this ISP");
	await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${user.id}, ${opts.role})`;
	return {
		user_id: user.id,
		email: user.email,
		name: user.name,
		role: opts.role
	};
}
async function createIspWithOwner(sql, opts) {
	const ispName = opts.ispName.trim();
	if (!ispName) throw new Error("ISP name is required");
	const owner = await createCredentialAccount(sql, {
		email: opts.ownerEmail,
		password: opts.ownerPassword,
		name: opts.ownerName
	});
	await applyRls(sql, { bypass: true });
	if ((await sql`
    select id from tenant_members where user_id = ${owner.id} limit 1`)[0]) throw new Error("That email already belongs to an ISP. Sign in instead, or pick another email.");
	const tenantId = nid("ten");
	const slug = `${slugify(ispName)}-${tenantId.slice(-6)}`;
	await sql`insert into tenants (id, name, slug, status, currency, timezone, support_email)
    values (${tenantId}, ${ispName}, ${slug}, 'trial', 'KES', 'Africa/Nairobi', ${owner.email})`;
	await sql`insert into tenant_members (id, tenant_id, user_id, role)
    values (${nid("mem")}, ${tenantId}, ${owner.id}, 'isp_owner')`;
	await setActiveTenant(sql, owner.id, tenantId);
	await ensureFirstPlatformAdmin(sql, owner.id);
	return {
		tenant_id: tenantId,
		tenant_name: ispName,
		slug,
		owner_email: owner.email,
		owner_id: owner.id
	};
}
async function listAllTenants(sql) {
	await applyRls(sql, { bypass: true });
	return sql`
    select t.id, t.name, t.slug, t.status, t.created_at::text as created_at,
           (select count(*)::int from tenant_members m where m.tenant_id = t.id) as members
    from tenants t
    order by t.created_at desc`;
}
//#endregion
export { assertPermission as a, listAllTenants as c, provisionTenant as d, resolveActiveTenant as f, addStaffMember as i, listBranches as l, setMemberRole as m, addBranch as n, createIspWithOwner as o, setActiveTenant as p, addMemberByEmail as r, isPlatformAdmin as s, accounts_CrIvUMZR_exports as t, loadAuthUser as u };

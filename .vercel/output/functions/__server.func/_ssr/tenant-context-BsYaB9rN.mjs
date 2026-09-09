import { r as __exportAll } from "../_runtime.mjs";
import { t as __exportAll$1 } from "./rolldown-runtime-D7D4PA-g.mjs";
//#region node_modules/.nitro/vite/services/ssr/assets/tenant-context-BsYaB9rN.js
var tenant_context_BsYaB9rN_exports = /* @__PURE__ */ __exportAll({
	i: () => assertPermission,
	n: () => setActiveTenant,
	r: () => tenant_context_exports,
	t: () => resolveActiveTenant
});
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
function toWorkspace(row) {
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
	return toWorkspace(row);
}
async function resolveActiveTenant(sql, userId) {
	const [active] = await sql`
    select tenant_id from user_active_tenant where user_id = ${userId}`;
	if (active?.tenant_id) {
		const row = await membership(sql, userId, active.tenant_id);
		if (row) return toWorkspace(row);
	}
	const members = await listMemberships(sql, userId);
	if (!members[0]) return null;
	await sql`insert into user_active_tenant (user_id, tenant_id, updated_at)
    values (${userId}, ${members[0].tenant_id}, now())
    on conflict (user_id) do update set tenant_id = ${members[0].tenant_id}, updated_at = now()`;
	return toWorkspace(members[0]);
}
//#endregion
export { tenant_context_BsYaB9rN_exports as i, resolveActiveTenant as n, setActiveTenant as r, assertPermission as t };

import type { TenantRole } from "./types";

export const PERMISSIONS = [
  "customers.read",
  "customers.manage",
  "customers.delete",
  "packages.read",
  "packages.manage",
  "services.read",
  "services.manage",
  "services.activate_now",
  "services.grace.grant",
  "services.grace.extend",
  "services.grace.revoke",
  "services.expiry.update",
  "services.delete",
  "services.reassign",
  "traffic.view",
  "invoices.read",
  "invoices.manage",
  "payments.read",
  "payments.manage",
  "payments.reconcile",
  "billing.partial.manage",
  "billing.partial.approve",
  "billing.business_credit.view",
  "billing.business_credit.manage",
  "billing.business_credit.approve",
  "billing.business_credit.override",
  "billing.business_credit.suspend",
  "billing.business_credit.restore",
  "routers.read",
  "routers.manage",
  "network.read",
  "radius.manage",
  "wireguard.manage",
  "tickets.read",
  "tickets.manage",
  "tickets.assigned.read",
  "jobs.update",
  "settings.manage",
  "audit.read",
  "communications.view",
  "communications.send",
  "communications.templates.manage",
  "acs.credentials.view",
  "acs.credentials.manage",
  "acs.credentials.reveal",
  "acs.credentials.rotate",
  "acs.connection.test",
  "acs.devices.view",
  "acs.devices.add",
  "acs.devices.assign",
  "acs.devices.reassign",
  "acs.devices.edit",
  "acs.devices.wifi.manage",
  "acs.devices.optical.view",
  "acs.devices.reboot",
  "acs.devices.factory_reset",
  "acs.devices.firmware.manage",
  "acs.tasks.view",
  "acs.tasks.retry",
  "recycle_bin.view",
  "recycle_bin.restore_customer",
  "recycle_bin.restore_service",
  "recycle_bin.permanent_delete",
] as const;

export type Permission = (typeof PERMISSIONS)[number] | "*";

const ROLE_PERMS: Record<TenantRole, Permission[]> = {
  isp_owner: ["*"],
  isp_admin: ["*"],
  finance: [
    "customers.read",
    "invoices.read",
    "invoices.manage",
    "payments.read",
    "payments.manage",
    "payments.reconcile",
    "billing.partial.manage",
    "billing.partial.approve",
    "billing.business_credit.view",
    "billing.business_credit.manage",
    "billing.business_credit.approve",
    "billing.business_credit.override",
    "billing.business_credit.suspend",
    "billing.business_credit.restore",
    "packages.read",
    "services.read",
    "services.grace.grant",
    "services.grace.extend",
    "services.grace.revoke",
    "traffic.view",
    "communications.view",
    "communications.send",
    "recycle_bin.view",
  ],
  customer_care: [
    "customers.read",
    "customers.manage",
    "customers.delete",
    "services.read",
    "services.grace.grant",
    "services.grace.extend",
    "services.grace.revoke",
    "services.expiry.update",
    "services.delete",
    "services.reassign",
    "traffic.view",
    "invoices.read",
    "payments.read",
    "billing.partial.manage",
    "billing.business_credit.view",
    "billing.business_credit.manage",
    "billing.business_credit.suspend",
    "tickets.read",
    "tickets.manage",
    "packages.read",
    "communications.view",
    "communications.send",
    "communications.templates.manage",
    "recycle_bin.view",
    "recycle_bin.restore_customer",
    "recycle_bin.restore_service",
    "acs.devices.view",
    "acs.devices.add",
    "acs.devices.assign",
    "acs.devices.reassign",
    "acs.devices.optical.view",
    "acs.tasks.view",
  ],
  network_engineer: [
    "customers.read",
    "services.read",
    "services.manage",
    "services.activate_now",
    "services.grace.grant",
    "services.grace.extend",
    "services.expiry.update",
    "services.delete",
    "services.reassign",
    "traffic.view",
    "routers.read",
    "routers.manage",
    "network.read",
    "radius.manage",
    "wireguard.manage",
    "packages.read",
    "communications.view",
    "communications.send",
    "acs.credentials.view",
    "acs.credentials.manage",
    "acs.credentials.reveal",
    "acs.credentials.rotate",
    "acs.connection.test",
    "acs.devices.view",
    "acs.devices.add",
    "acs.devices.assign",
    "acs.devices.reassign",
    "acs.devices.edit",
    "acs.devices.wifi.manage",
    "acs.devices.optical.view",
    "acs.devices.reboot",
    "acs.devices.factory_reset",
    "acs.devices.firmware.manage",
    "acs.tasks.view",
    "acs.tasks.retry",
    "recycle_bin.view",
    "recycle_bin.restore_service",
  ],
  technician: [
    "tickets.assigned.read",
    "jobs.update",
    "customers.read",
    "services.read",
    "tickets.read",
    "traffic.view",
    "acs.devices.view",
    "acs.devices.optical.view",
    "acs.tasks.view",
  ],
  support: [
    "customers.read",
    "packages.read",
    "services.read",
    "invoices.read",
    "payments.read",
    "routers.read",
    "network.read",
    "tickets.read",
    "audit.read",
    "communications.view",
    "acs.credentials.view",
    "acs.devices.view",
    "acs.devices.optical.view",
    "acs.tasks.view",
    "traffic.view",
    "recycle_bin.view",
    "billing.business_credit.view",
  ],
};

export function permissionsFor(role: TenantRole): Permission[] {
  return ROLE_PERMS[role] ?? [];
}

export function hasPermission(role: TenantRole | string, permission: Permission) {
  const perms = ROLE_PERMS[role as TenantRole] ?? [];
  if (perms.includes("*")) return true;
  return perms.includes(permission);
}

export function assertPermission(role: TenantRole | string, permission: Permission) {
  if (!hasPermission(role, permission)) {
    throw new Error("Forbidden");
  }
}

export function assertTenantMatch(resourceTenantId: string, contextTenantId: string) {
  if (!resourceTenantId || resourceTenantId !== contextTenantId) {
    throw new Error("Not found");
  }
}

export const ROLE_GUIDE: { role: TenantRole; label: string; summary: string }[] = [
  { role: "isp_owner", label: "Owner", summary: "Full console: staff, billing, network, and settings." },
  { role: "isp_admin", label: "Admin", summary: "Same access as owner. Keep at least one owner on the ISP." },
  { role: "finance", label: "Finance", summary: "Invoices, payments, paybill matching, statements, and grace." },
  {
    role: "customer_care",
    label: "Customer care",
    summary: "Customers, tickets, SMS/WhatsApp, invoices (read), grace, service expiry, and Recycle Bin.",
  },
  { role: "network_engineer", label: "Network engineer", summary: "Services, routers, RADIUS, hotspot, WireGuard, and ACS." },
  { role: "technician", label: "Technician", summary: "Assigned tickets and field jobs. No billing or router changes." },
  { role: "support", label: "Support", summary: "Read-only when ISP Solutions staff is inside this workspace." },
];

/** Longest prefix first. Overview (`/app`) has no entry and is open to every member. */
const PAGE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  { prefix: "/app/recycle-bin", permission: "recycle_bin.view" },
  { prefix: "/app/customers", permission: "customers.read" },
  { prefix: "/app/packages", permission: "packages.read" },
  { prefix: "/app/services", permission: "services.read" },
  { prefix: "/app/radius", permission: "radius.manage" },
  { prefix: "/app/hotspot", permission: "radius.manage" },
  { prefix: "/app/billing", permission: "invoices.read" },
  { prefix: "/app/reports", permission: "invoices.read" },
  { prefix: "/app/statements", permission: "invoices.read" },
  { prefix: "/app/routers", permission: "routers.read" },
  { prefix: "/app/acs", permission: "acs.devices.view" },
  { prefix: "/app/ai", permission: "routers.manage" },
  { prefix: "/app/field", permission: "jobs.update" },
  { prefix: "/app/tickets", permission: "tickets.read" },
  { prefix: "/app/partners", permission: "settings.manage" },
  { prefix: "/app/import", permission: "customers.manage" },
  { prefix: "/app/settings", permission: "settings.manage" },
  { prefix: "/app/notifications", permission: "settings.manage" },
];

export const STAFF_ROLES = ROLE_GUIDE.filter((row) => row.role !== "support");

export function permissionForAppPath(pathname: string): Permission | null {
  const hit = PAGE_PERMISSIONS.find((row) => pathname === row.prefix || pathname.startsWith(`${row.prefix}/`));
  return hit?.permission ?? null;
}

export function canAccessAppPath(role: TenantRole | string | undefined, pathname: string) {
  if (!role) return true;
  const perm = permissionForAppPath(pathname);
  if (!perm) return true;
  return hasPermission(role, perm);
}

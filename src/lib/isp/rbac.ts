import type { TenantRole } from "./types";

export const PERMISSIONS = [
  "customers.read",
  "customers.manage",
  "packages.read",
  "packages.manage",
  "services.read",
  "services.manage",
  "services.grace.grant",
  "services.grace.extend",
  "services.grace.revoke",
  "invoices.read",
  "invoices.manage",
  "payments.read",
  "payments.manage",
  "payments.reconcile",
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
    "packages.read",
    "services.read",
    "services.grace.grant",
    "services.grace.extend",
    "services.grace.revoke",
    "communications.view",
    "communications.send",
  ],
  customer_care: [
    "customers.read",
    "customers.manage",
    "services.read",
    "services.grace.grant",
    "services.grace.extend",
    "services.grace.revoke",
    "invoices.read",
    "payments.read",
    "tickets.read",
    "tickets.manage",
    "packages.read",
    "communications.view",
    "communications.send",
    "communications.templates.manage",
  ],
  network_engineer: [
    "customers.read",
    "services.read",
    "services.manage",
    "services.grace.grant",
    "services.grace.extend",
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
  ],
  technician: ["tickets.assigned.read", "jobs.update", "customers.read", "services.read", "tickets.read"],
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
  { role: "customer_care", label: "Customer care", summary: "Customers, tickets, SMS/WhatsApp, invoices (read), and grace." },
  { role: "network_engineer", label: "Network engineer", summary: "Services, routers, RADIUS, hotspot, WireGuard, and ACS." },
  { role: "technician", label: "Technician", summary: "Assigned tickets and field jobs. No billing or router changes." },
  { role: "support", label: "Support", summary: "Read-only when ISP Solutions staff is inside this workspace." },
];

/** Longest prefix first. Overview (`/app`) has no entry and is open to every member. */
const PAGE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  { prefix: "/app/customers", permission: "customers.read" },
  { prefix: "/app/packages", permission: "packages.read" },
  { prefix: "/app/services", permission: "services.read" },
  { prefix: "/app/radius", permission: "radius.manage" },
  { prefix: "/app/hotspot", permission: "radius.manage" },
  { prefix: "/app/billing", permission: "invoices.read" },
  { prefix: "/app/reports", permission: "invoices.read" },
  { prefix: "/app/statements", permission: "invoices.read" },
  { prefix: "/app/routers", permission: "routers.read" },
  { prefix: "/app/acs", permission: "routers.manage" },
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


import type { TenantRole } from "./types";

export const PERMISSIONS = [
  "customers.read",
  "customers.manage",
  "packages.read",
  "packages.manage",
  "services.read",
  "services.manage",
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
  ],
  customer_care: [
    "customers.read",
    "customers.manage",
    "services.read",
    "invoices.read",
    "payments.read",
    "tickets.read",
    "tickets.manage",
    "packages.read",
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
    "packages.read",
  ],
  technician: ["tickets.assigned.read", "jobs.update", "customers.read", "services.read", "tickets.read"],
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

/** Login identifier for the first-install platform Superadmin. Not a secret. */
export const BOOTSTRAP_SUPERADMIN_USERNAME = "superadmin";

/** Better Auth stores an email-shaped identifier. Mapped from the username at sign-in. */
export const BOOTSTRAP_SUPERADMIN_EMAIL = "superadmin@ispsolutions.internal";

export function isBootstrapSuperadminLogin(raw: string) {
  const trimmed = String(raw || "").trim().toLowerCase();
  return trimmed === BOOTSTRAP_SUPERADMIN_USERNAME || trimmed === BOOTSTRAP_SUPERADMIN_EMAIL;
}

export function resolveBootstrapLoginId(raw: string) {
  const trimmed = String(raw || "").trim().toLowerCase();
  if (isBootstrapSuperadminLogin(trimmed)) return BOOTSTRAP_SUPERADMIN_EMAIL;
  return trimmed;
}

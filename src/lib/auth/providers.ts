/**
 * Application sign-in providers.
 *
 * ISP Solutions authenticates only against platform accounts stored in this
 * app's database (email/password credentials created by signup, staff
 * management, or the first-install Superadmin). Google, X, and other broker
 * identity providers are not application login methods.
 *
 * Leave this list empty. Do not add social or external IdPs here.
 */
export type GrokProvider = {
  /** This app's local provider id; also the callback path segment. */
  providerId: string;
  /** Upstream hint the broker forwards to (Better Auth social id). */
  idp: string;
  /** Human label for the sign-in button. */
  label: string;
};

/** No external identity providers for ISP Solutions application login. */
export const GROK_PROVIDERS: readonly GrokProvider[] = [];

/**
 * Gate / broker identities must not become ISP Solutions sessions.
 * The gate verifier stays in place for the host; it is not an application login.
 */
export const applicationExternalIdentityEnabled = false;

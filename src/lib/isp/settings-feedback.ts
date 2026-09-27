/** Shared save/test copy and gateway status for Settings. UI only — no payment rules. */

export const PAYMENT_SAVE_OK = "Payment settings saved successfully.";
export const PAYMENT_SAVE_FAIL = "Unable to save payment settings.";
export const PAYMENT_TEST_OK = "Payment gateway connection successful.";
export const PAYMENT_TEST_FAIL = "Connection failed. Please verify the gateway configuration.";
export const PAYMENT_TEST_BUSY = "Testing connection...";

export const SMS_SAVE_OK = "SMS settings saved successfully.";
export const SMS_SAVE_FAIL = "Unable to save SMS settings.";
export const WHATSAPP_SAVE_OK = "WhatsApp settings saved successfully.";
export const WHATSAPP_SAVE_FAIL = "Unable to save WhatsApp settings.";
export const EMAIL_SAVE_OK = "Email settings saved successfully.";
export const EMAIL_SAVE_FAIL = "Unable to save email settings.";

export const GRACE_SAVE_OK = "Grace period terms saved successfully.";
export const GRACE_SAVE_FAIL = "Unable to save grace period terms.";
export const PARTIAL_SAVE_OK = "Partial payment policy saved successfully.";
export const PARTIAL_SAVE_FAIL = "Unable to save partial payment policy.";
export const STAFF_SAVE_FAIL = "Unable to save staff settings.";
export const NOTIFY_SAVE_OK = "Notification template saved successfully.";
export const NOTIFY_SAVE_FAIL = "Unable to save notification template.";
export const TAG_SAVE_OK = "Customer tag saved successfully.";
export const TAG_SAVE_FAIL = "Unable to save customer tag.";
export const ID_SAVE_OK = "ID settings saved successfully.";
export const ID_SAVE_FAIL = "Unable to save ID settings.";
export const NETWORK_SAVE_OK = "Network settings saved successfully.";
export const NETWORK_SAVE_FAIL = "Unable to save network settings.";
export const WA_SAVE_OK = "WhatsApp customer settings saved successfully.";
export const WA_SAVE_FAIL = "Unable to save WhatsApp customer settings.";

export const SETTINGS_GATEWAYS = [
  { id: "mpesa", label: "M-Pesa" },
  { id: "kopokopo", label: "Kopo Kopo" },
  { id: "callbacks", label: "Callbacks" },
] as const;

export type SettingsGatewayId = (typeof SETTINGS_GATEWAYS)[number]["id"];

export type GatewayTestState = "ok" | "fail" | null;

/** Connected only after a live test succeeds. Credentials alone are not a connection. */
export function gatewayStatus(input: { tested: GatewayTestState; complete: boolean }) {
  if (input.tested === "ok") return { label: "Connected", tone: "ok" as const };
  if (input.tested === "fail") return { label: "Connection failed", tone: "danger" as const };
  if (!input.complete) return { label: "Configuration incomplete", tone: "muted" as const };
  return { label: "Not tested", tone: "muted" as const };
}

export function mpesaConfigComplete(fields: {
  clientId: string;
  clientSecret: string;
  till: string;
  passkey: string;
  secretStored: boolean;
  passkeyStored: boolean;
}) {
  const secret = fields.clientSecret.trim();
  const pass = fields.passkey.trim();
  return Boolean(
    fields.clientId.trim() &&
      fields.till.trim() &&
      (secret || fields.secretStored) &&
      (pass || fields.passkeyStored),
  );
}

export function kopoConfigComplete(fields: { clientId: string; clientSecret: string; till: string; secretStored: boolean }) {
  return Boolean(fields.clientId.trim() && fields.till.trim() && (fields.clientSecret.trim() || fields.secretStored));
}

/** Prefer a short API message. Never echo a secret the operator just typed. */
export function safeSettingsError(err: unknown, fallback: string, secrets: string[] = []) {
  const raw = err instanceof Error ? err.message.trim() : "";
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length >= 4 && lower.includes(value.toLowerCase())) return fallback;
  }
  return raw;
}

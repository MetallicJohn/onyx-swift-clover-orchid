import { nid } from "../utils.ts";
import { deliverSms, e164, type MessagingSettings } from "./messaging.ts";
import { hint, open, seal } from "./secrets.ts";
import { writePlatformAudit } from "./platform.ts";
import { applyRls } from "./rls.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type SmsSendInput = { to: string; message: string; senderId?: string };
export type SmsSendResult = {
  status: "sent" | "failed" | "sandbox" | "disabled";
  detail: string;
  provider: string;
};

export const DEFAULT_OTP_TEMPLATE =
  "Your ISP Solutions verification code is {{otp}}. It expires in {{minutes}} minutes. Do not share this code with anyone.";

const SECRET_KEYS = new Set(["saas_sms_api_key", "saas_sms_api_secret"]);

export type SaasSmsSettings = {
  provider: string;
  api_url: string;
  username: string;
  sender_id: string;
  country: string;
  enabled: boolean;
  otp_enabled: boolean;
  notify_enabled: boolean;
  otp_template: string;
  otp_ttl_minutes: number;
  otp_max_attempts: number;
  reset_per_hour: number;
  api_key_set: boolean;
  api_secret_set: boolean;
  api_key_hint: string;
  api_secret_hint: string;
};

const DEFAULTS: SaasSmsSettings = {
  provider: "africastalking",
  api_url: "",
  username: "",
  sender_id: "",
  country: "254",
  enabled: false,
  otp_enabled: true,
  notify_enabled: true,
  otp_template: DEFAULT_OTP_TEMPLATE,
  otp_ttl_minutes: 5,
  otp_max_attempts: 5,
  reset_per_hour: 5,
  api_key_set: false,
  api_secret_set: false,
  api_key_hint: "",
  api_secret_hint: "",
};

type RawSms = {
  api_key: string;
  api_secret: string;
  provider: string;
  api_url: string;
  username: string;
  sender_id: string;
  country: string;
  enabled: boolean;
  otp_enabled: boolean;
  notify_enabled: boolean;
  otp_template: string;
  otp_ttl_minutes: number;
  otp_max_attempts: number;
  reset_per_hour: number;
};

async function loadRaw(sql: Sql): Promise<RawSms> {
  await applyRls(sql, { bypass: true });
  const rows = await sql<{ key: string; value: string }>`select key, value from platform_settings where key like ${"saas_sms_%"}`;
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  const ttl = Number(map.saas_sms_otp_ttl_minutes || 5);
  const attempts = Number(map.saas_sms_otp_max_attempts || 5);
  const perHour = Number(map.saas_sms_reset_per_hour || 5);
  return {
    api_key: open(map.saas_sms_api_key || ""),
    api_secret: open(map.saas_sms_api_secret || ""),
    provider: (map.saas_sms_provider || DEFAULTS.provider).trim() || DEFAULTS.provider,
    api_url: (map.saas_sms_api_url || "").trim(),
    username: (map.saas_sms_username || "").trim(),
    sender_id: (map.saas_sms_sender_id || "").trim(),
    country: (map.saas_sms_country || "254").trim() || "254",
    enabled: map.saas_sms_enabled === "true",
    otp_enabled: map.saas_sms_otp_enabled !== "false",
    notify_enabled: map.saas_sms_notify_enabled !== "false",
    otp_template: (map.saas_sms_otp_template || DEFAULT_OTP_TEMPLATE).trim() || DEFAULT_OTP_TEMPLATE,
    otp_ttl_minutes: Number.isFinite(ttl) ? Math.min(30, Math.max(1, Math.round(ttl))) : 5,
    otp_max_attempts: Number.isFinite(attempts) ? Math.min(10, Math.max(3, Math.round(attempts))) : 5,
    reset_per_hour: Number.isFinite(perHour) ? Math.min(20, Math.max(1, Math.round(perHour))) : 5,
  };
}

export function publicSaasSms(raw: RawSms): SaasSmsSettings {
  return {
    provider: raw.provider,
    api_url: raw.api_url,
    username: raw.username,
    sender_id: raw.sender_id,
    country: raw.country,
    enabled: raw.enabled,
    otp_enabled: raw.otp_enabled,
    notify_enabled: raw.notify_enabled,
    otp_template: raw.otp_template,
    otp_ttl_minutes: raw.otp_ttl_minutes,
    otp_max_attempts: raw.otp_max_attempts,
    reset_per_hour: raw.reset_per_hour,
    api_key_set: Boolean(raw.api_key),
    api_secret_set: Boolean(raw.api_secret),
    api_key_hint: raw.api_key ? hint(seal(raw.api_key)) : "",
    api_secret_hint: raw.api_secret ? hint(seal(raw.api_secret)) : "",
  };
}

export async function getSaasSmsSettings(sql: Sql): Promise<SaasSmsSettings> {
  return publicSaasSms(await loadRaw(sql));
}

function toMessaging(raw: RawSms, senderId?: string): MessagingSettings {
  return {
    payment_sms: true,
    payment_whatsapp: false,
    billing_sms: true,
    billing_whatsapp: false,
    sms_provider: raw.provider,
    sms_sender_id: senderId || raw.sender_id,
    sms_username: raw.username,
    sms_api_key: raw.api_secret || raw.api_key,
    sms_sandbox: !raw.enabled || !(raw.api_key || raw.api_secret),
    wa_provider: "meta",
    wa_phone_id: "",
    wa_access_token: "",
    wa_business_id: "",
    wa_sandbox: true,
    payment_email: false,
    billing_email: false,
    email_provider: "resend",
    email_from_name: "",
    email_from_address: "",
    email_reply_to: "",
    email_api_key: "",
    smtp_host: "",
    smtp_port: 587,
    smtp_username: "",
    smtp_password: "",
    smtp_secure: false,
    email_sandbox: true,
  };
}

export function renderOtpTemplate(template: string, otp: string, minutes: number) {
  const body = (template || DEFAULT_OTP_TEMPLATE).includes("{{otp}}")
    ? template || DEFAULT_OTP_TEMPLATE
    : `${template || DEFAULT_OTP_TEMPLATE} {{otp}}`;
  return body.replaceAll("{{otp}}", otp).replaceAll("{{minutes}}", String(minutes));
}

type SmsSender = (input: SmsSendInput & { settings: MessagingSettings }) => Promise<SmsSendResult>;

let testSender: SmsSender | null = null;

export function setSaasSmsSenderForTests(fn: SmsSender | null) {
  testSender = fn;
}

export async function sendSms(
  sql: Sql,
  input: SmsSendInput & { userId?: string | null; tenantId?: string | null; messageType: string; purpose?: string },
): Promise<SmsSendResult> {
  const raw = await loadRaw(sql);
  const to = e164(input.to);
  const settings = toMessaging(raw, input.senderId);
  if (!raw.enabled) {
    await logSms(sql, {
      ...input,
      phone: to || input.to,
      provider: raw.provider,
      sender_id: settings.sms_sender_id,
      status: "disabled",
      error: "SaaS SMS gateway is disabled",
    });
    return { status: "disabled", detail: "SaaS SMS gateway is disabled", provider: raw.provider };
  }
  if (!to) {
    await logSms(sql, {
      ...input,
      phone: input.to,
      provider: raw.provider,
      sender_id: settings.sms_sender_id,
      status: "failed",
      error: "Invalid phone number",
    });
    return { status: "failed", detail: "Invalid phone number", provider: raw.provider };
  }

  let result: SmsSendResult;
  if (testSender) {
    result = await testSender({ to, message: input.message, senderId: settings.sms_sender_id, settings });
  } else {
    const delivered = await deliverSms(settings, to, input.message);
    result = { status: delivered.status, detail: delivered.detail, provider: raw.provider };
  }

  await logSms(sql, {
    ...input,
    phone: to,
    provider: raw.provider,
    sender_id: settings.sms_sender_id,
    status: result.status,
    error: result.status === "failed" ? sanitizeSmsError(result.detail) : "",
    providerMessageId: result.status === "sent" ? result.detail.slice(0, 80) : "",
  });
  return { ...result, detail: sanitizeSmsError(result.detail) };
}

function sanitizeSmsError(detail: string) {
  return String(detail || "")
    .replace(/api[_-]?key[=:]?\s*\S+/gi, "api_key=***")
    .replace(/secret[=:]?\s*\S+/gi, "secret=***")
    .replace(/Bearer\s+\S+/gi, "Bearer ***")
    .slice(0, 160);
}

async function logSms(
  sql: Sql,
  opts: {
    userId?: string | null;
    tenantId?: string | null;
    phone: string;
    provider: string;
    sender_id: string;
    messageType: string;
    purpose?: string;
    status: string;
    error?: string;
    providerMessageId?: string;
  },
) {
  await applyRls(sql, { bypass: true });
  await sql`insert into sms_messages
    (id, tenant_id, user_id, phone, provider, sender_id, message_type, purpose, provider_message_id, status, error_code, error_message_sanitized, sent_at)
    values (
      ${nid("sms")}, ${opts.tenantId || null}, ${opts.userId || null}, ${opts.phone.slice(0, 32)},
      ${opts.provider}, ${opts.sender_id}, ${opts.messageType}, ${opts.purpose || ""},
      ${opts.providerMessageId || ""}, ${opts.status}, ${opts.status === "failed" ? "send_failed" : ""},
      ${opts.error || ""}, ${opts.status === "sent" || opts.status === "sandbox" ? new Date().toISOString() : null}
    )`;
}

export async function saveSaasSmsSettings(
  sql: Sql,
  actorUserId: string,
  patch: Partial<{
    provider: string;
    api_url: string;
    username: string;
    sender_id: string;
    country: string;
    enabled: boolean;
    otp_enabled: boolean;
    notify_enabled: boolean;
    otp_template: string;
    otp_ttl_minutes: number;
    otp_max_attempts: number;
    reset_per_hour: number;
    api_key: string;
    api_secret: string;
  }>,
) {
  const entries: [string, string][] = [];
  if (patch.provider != null) entries.push(["saas_sms_provider", patch.provider.trim().slice(0, 40) || "africastalking"]);
  if (patch.api_url != null) entries.push(["saas_sms_api_url", patch.api_url.trim().slice(0, 200)]);
  if (patch.username != null) entries.push(["saas_sms_username", patch.username.trim().slice(0, 80)]);
  if (patch.sender_id != null) entries.push(["saas_sms_sender_id", patch.sender_id.trim().slice(0, 20)]);
  if (patch.country != null) entries.push(["saas_sms_country", patch.country.replace(/\D/g, "").slice(0, 4) || "254"]);
  if (patch.enabled != null) entries.push(["saas_sms_enabled", patch.enabled ? "true" : "false"]);
  if (patch.otp_enabled != null) entries.push(["saas_sms_otp_enabled", patch.otp_enabled ? "true" : "false"]);
  if (patch.notify_enabled != null) entries.push(["saas_sms_notify_enabled", patch.notify_enabled ? "true" : "false"]);
  if (patch.otp_template != null) {
    const tpl = patch.otp_template.trim().slice(0, 320) || DEFAULT_OTP_TEMPLATE;
    entries.push(["saas_sms_otp_template", tpl.includes("{{otp}}") ? tpl : `${tpl} {{otp}}`]);
  }
  if (patch.otp_ttl_minutes != null) {
    entries.push(["saas_sms_otp_ttl_minutes", String(Math.min(30, Math.max(1, Math.round(Number(patch.otp_ttl_minutes) || 5))) )]);
  }
  if (patch.otp_max_attempts != null) {
    entries.push(["saas_sms_otp_max_attempts", String(Math.min(10, Math.max(3, Math.round(Number(patch.otp_max_attempts) || 5))) )]);
  }
  if (patch.reset_per_hour != null) {
    entries.push(["saas_sms_reset_per_hour", String(Math.min(20, Math.max(1, Math.round(Number(patch.reset_per_hour) || 5))) )]);
  }
  if (patch.api_key != null && patch.api_key.trim() && !/^\*+$|•/.test(patch.api_key)) {
    entries.push(["saas_sms_api_key", seal(patch.api_key.trim())]);
  }
  if (patch.api_secret != null && patch.api_secret.trim() && !/^\*+$|•/.test(patch.api_secret)) {
    entries.push(["saas_sms_api_secret", seal(patch.api_secret.trim())]);
  }
  for (const [key, value] of entries) {
    if (SECRET_KEYS.has(key) && !value) continue;
    await sql`insert into platform_settings (key, value, updated_at) values (${key}, ${value}, now())
      on conflict (key) do update set value = ${value}, updated_at = now()`;
  }
  await writePlatformAudit(sql, {
    actorUserId,
    action: "SMS_GATEWAY_UPDATED",
    entityType: "platform_settings",
    entityId: "saas_sms",
    metadata: {
      keys: entries.map(([k]) => k).filter((k) => !SECRET_KEYS.has(k)),
      enabled: patch.enabled,
      provider: patch.provider,
    },
  });
  return getSaasSmsSettings(sql);
}

export async function testSaasSms(sql: Sql, actorUserId: string, to: string) {
  const raw = await loadRaw(sql);
  const result = await sendSms(sql, {
    to,
    message: "ISP Solutions SMS gateway test. If you received this, the SaaS SMS provider is working.",
    messageType: "SMS_TEST",
    purpose: "SMS_GATEWAY_TEST",
    userId: actorUserId,
  });
  await writePlatformAudit(sql, {
    actorUserId,
    action: "SMS_GATEWAY_TESTED",
    entityType: "sms",
    metadata: { ok: result.status === "sent" || result.status === "sandbox", status: result.status, provider: raw.provider },
  });
  if (result.status === "sent" || result.status === "sandbox") {
    return { ok: true as const, message: "SMS gateway test successful", status: result.status };
  }
  return { ok: false as const, message: `SMS gateway test failed: ${result.detail}`, status: result.status };
}

export async function listSaasSmsMessages(
  sql: Sql,
  opts: { page?: number; pageSize?: number } = {},
) {
  const pageSize = Math.min(50, Math.max(10, opts.pageSize || 25));
  const page = Math.max(1, opts.page || 1);
  const offset = (page - 1) * pageSize;
  const rows = await sql<{
    id: string;
    phone: string;
    provider: string;
    sender_id: string;
    message_type: string;
    purpose: string;
    status: string;
    error_message_sanitized: string;
    created_at: string;
    sent_at: string | null;
    user_id: string | null;
  }>`select id, phone, provider, sender_id, message_type, purpose, status, error_message_sanitized,
           created_at::text as created_at, sent_at::text as sent_at, user_id
     from sms_messages order by created_at desc limit ${pageSize} offset ${offset}`;
  const [n] = await sql<{ n: number }>`select count(*)::int as n from sms_messages`;
  return { messages: rows, total: n?.n ?? 0, page, pageSize };
}

export async function loadOtpPolicy(sql: Sql) {
  const raw = await loadRaw(sql);
  return {
    ttlMinutes: raw.otp_ttl_minutes,
    maxAttempts: raw.otp_max_attempts,
    resetPerHour: raw.reset_per_hour,
    otpEnabled: raw.otp_enabled && raw.enabled,
    template: raw.otp_template,
    sandbox: !raw.enabled || !(raw.api_key || raw.api_secret),
  };
}

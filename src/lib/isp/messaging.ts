import type { BillingEvent, NotifyChannel } from "./types";
import { PAYMENT_NOTIFY_EVENTS } from "./notification-catalog.ts";
import { open, seal } from "./secrets";
import {
  buildSmsProbe,
  buildSmsRequest,
  configFromFlat,
  emptyGateway,
  executeSmsRequest,
  gatewayConfigured,
  isSmsGatewayId,
  mergeGatewayConfig,
  mergeGatewayStore,
  parseGatewayStore,
  projectGateway,
  responseSummary,
  scrubSecrets,
  SMS_GATEWAYS,
  SMS_TEST_FAIL,
  SMS_TEST_OK,
  smsGatewayLabel,
  toPublicGateway,
  validateGateway,
  type PublicSmsGateway,
  type SmsGatewayConfig,
  type SmsGatewayId,
} from "./sms-gateways";
import { sendSmtp } from "./smtp";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type EmailAttachment = {
  filename: string;
  content: string;
  contentType?: string;
};

export type MessagingSettings = {
  payment_sms: boolean;
  payment_whatsapp: boolean;
  billing_sms: boolean;
  billing_whatsapp: boolean;
  sms_provider: string;
  sms_sender_id: string;
  sms_username: string;
  sms_api_key: string;
  sms_sandbox: boolean;
  wa_provider: string;
  wa_phone_id: string;
  wa_access_token: string;
  wa_business_id: string;
  wa_sandbox: boolean;
  payment_email: boolean;
  billing_email: boolean;
  email_provider: string;
  email_from_name: string;
  email_from_address: string;
  email_reply_to: string;
  email_api_key: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_secure: boolean;
  email_sandbox: boolean;
  sms_gateways: string;
};

export type MessagingPublic = Omit<
  MessagingSettings,
  "sms_api_key" | "wa_access_token" | "email_api_key" | "smtp_password" | "sms_gateways"
> & {
  sms_api_key_set: boolean;
  sms_api_key_hint: string;
  wa_token_set: boolean;
  wa_token_hint: string;
  email_api_key_set: boolean;
  email_api_key_hint: string;
  smtp_password_set: boolean;
  smtp_password_hint: string;
  sms_gateways: PublicSmsGateway[];
  default_sms_gateway: string;
};

const DEFAULTS: MessagingSettings = {
  payment_sms: true,
  payment_whatsapp: true,
  billing_sms: true,
  billing_whatsapp: false,
  sms_provider: "africastalking",
  sms_sender_id: "",
  sms_username: "",
  sms_api_key: "",
  sms_sandbox: true,
  wa_provider: "meta",
  wa_phone_id: "",
  wa_access_token: "",
  wa_business_id: "",
  wa_sandbox: true,
  payment_email: true,
  billing_email: true,
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
  sms_gateways: "",
};

export async function ensureMessagingSchema(_sql: Sql) {
  /* schema: migrations/0005_messaging.sql + 0035_tenant_email.sql */
}

export async function getMessagingSettings(sql: Sql, tenantId: string): Promise<MessagingSettings> {
  await ensureMessagingSchema(sql);
  const rows = await sql<MessagingSettings>`
    select payment_sms, payment_whatsapp, billing_sms, billing_whatsapp,
           sms_provider, sms_sender_id, sms_username, sms_api_key, sms_sandbox,
           wa_provider, wa_phone_id, wa_access_token, wa_business_id, wa_sandbox,
           payment_email, billing_email, email_provider, email_from_name, email_from_address,
           email_reply_to, email_api_key, smtp_host, smtp_port, smtp_username, smtp_password,
           smtp_secure, email_sandbox, sms_gateways
    from messaging_settings where tenant_id = ${tenantId}`;
  if (rows[0]) {
    return {
      ...DEFAULTS,
      ...rows[0],
      smtp_port: Number(rows[0].smtp_port || 587),
      sms_api_key: open(rows[0].sms_api_key),
      wa_access_token: open(rows[0].wa_access_token),
      email_api_key: open(rows[0].email_api_key),
      smtp_password: open(rows[0].smtp_password),
      sms_gateways: open(rows[0].sms_gateways || ""),
    };
  }
  await sql`insert into messaging_settings (tenant_id) values (${tenantId})`;
  return { ...DEFAULTS };
}

function hint(secret: string) {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export function listPublicGateways(s: MessagingSettings) {
  const store = parseGatewayStore(s.sms_gateways || "");
  const defaultId: SmsGatewayId = isSmsGatewayId(s.sms_provider) ? s.sms_provider : "africastalking";
  if (!store[defaultId] && (s.sms_api_key || s.sms_sender_id || s.sms_username)) {
    store[defaultId] = configFromFlat(defaultId, s);
  }
  return {
    defaultId,
    gateways: SMS_GATEWAYS.map((gateway) => toPublicGateway(gateway.id, store[gateway.id] || emptyGateway(gateway.id))),
  };
}

export function toPublic(s: MessagingSettings): MessagingPublic {
  const listed = listPublicGateways(s);
  return {
    payment_sms: s.payment_sms,
    payment_whatsapp: s.payment_whatsapp,
    billing_sms: s.billing_sms,
    billing_whatsapp: s.billing_whatsapp,
    sms_provider: s.sms_provider,
    sms_sender_id: s.sms_sender_id,
    sms_username: s.sms_username,
    sms_sandbox: s.sms_sandbox,
    wa_provider: s.wa_provider,
    wa_phone_id: s.wa_phone_id,
    wa_business_id: s.wa_business_id,
    wa_sandbox: s.wa_sandbox,
    payment_email: s.payment_email,
    billing_email: s.billing_email,
    email_provider: s.email_provider,
    email_from_name: s.email_from_name,
    email_from_address: s.email_from_address,
    email_reply_to: s.email_reply_to,
    smtp_host: s.smtp_host,
    smtp_port: s.smtp_port,
    smtp_username: s.smtp_username,
    smtp_secure: s.smtp_secure,
    email_sandbox: s.email_sandbox,
    sms_api_key_set: Boolean(s.sms_api_key),
    sms_api_key_hint: hint(s.sms_api_key),
    wa_token_set: Boolean(s.wa_access_token),
    wa_token_hint: hint(s.wa_access_token),
    email_api_key_set: Boolean(s.email_api_key),
    email_api_key_hint: hint(s.email_api_key),
    smtp_password_set: Boolean(s.smtp_password),
    smtp_password_hint: hint(s.smtp_password),
    sms_gateways: listed.gateways,
    default_sms_gateway: listed.defaultId,
  };
}

export function channelAllowed(event: BillingEvent, channel: NotifyChannel, s: MessagingSettings) {
  if (channel === "in_app") return true;
  const ticketTech = event === "ticket_assigned" || event === "ticket_sla_warning";
  if (channel === "whatsapp" && ticketTech) return s.payment_whatsapp || s.billing_whatsapp;
  const payment = PAYMENT_NOTIFY_EVENTS.has(event);
  if (channel === "sms") return payment ? s.payment_sms : s.billing_sms;
  if (channel === "whatsapp") return payment ? s.payment_whatsapp : s.billing_whatsapp;
  if (channel === "email") return payment ? s.payment_email : s.billing_email;
  return false;
}

export function e164(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("254")) return `+${d}`;
  if (d.startsWith("0") && d.length >= 10) return `+254${d.slice(1)}`;
  if (d.length === 9) return `+254${d}`;
  return `+${d}`;
}

export function emailOk(email: string) {
  const v = email.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) && v.length <= 254 && !v.includes("\n");
}

export function formatFrom(settings: MessagingSettings) {
  const addr = settings.email_from_address.trim();
  if (!emailOk(addr)) return "";
  const name = settings.email_from_name.trim().replace(/[\r\n<>"]/g, "");
  return name ? `${name} <${addr}>` : addr;
}

function keMobile(phone: string) {
  return e164(phone).replace("+", "");
}

function webfamError(status: number, text: string) {
  try {
    const j = JSON.parse(text) as { error?: string; errors?: Record<string, string[]>; success?: boolean };
    if (j.error) return `Webfam ${status}: ${j.error}`;
    if (j.errors) return `Webfam ${status}: ${Object.values(j.errors).flat().join("; ")}`;
  } catch {
    /* ignore */
  }
  return `Webfam ${status} ${text.slice(0, 80)}`;
}

export async function webfamBalance(settings: MessagingSettings) {
  if (!settings.sms_api_key) return { ok: false as const, detail: "No Webfam API key saved" };
  const res = await fetch("https://sms.webfam.co.ke/api/v1/account/balance", {
    headers: { Authorization: `Bearer ${settings.sms_api_key}`, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) return { ok: false as const, detail: webfamError(res.status, text) };
  try {
    const j = JSON.parse(text) as { success?: boolean; data?: { balance?: number; currency?: string; is_low?: boolean } };
    if (!j.success) return { ok: false as const, detail: webfamError(res.status, text) };
    return {
      ok: true as const,
      detail: `${j.data?.balance ?? "?"} ${j.data?.currency ?? "credits"}${j.data?.is_low ? " (low)" : ""}`,
    };
  } catch {
    return { ok: false as const, detail: text.slice(0, 80) };
  }
}

export function resolveActiveGateway(settings: MessagingSettings): { id: SmsGatewayId; config: SmsGatewayConfig } {
  const id: SmsGatewayId = isSmsGatewayId(settings.sms_provider) ? settings.sms_provider : "advanta";
  const store = parseGatewayStore(settings.sms_gateways || "");
  const stored = store[id];
  const flat = configFromFlat(id, settings);
  if (stored && gatewayConfigured(id, stored)) return { id, config: stored };
  if (gatewayConfigured(id, flat)) return { id, config: flat };
  return { id, config: stored || flat };
}

export function resolveStoredGateway(settings: MessagingSettings, id: SmsGatewayId): SmsGatewayConfig {
  const store = parseGatewayStore(settings.sms_gateways || "");
  if (store[id]) return store[id];
  if (settings.sms_provider === id) return configFromFlat(id, settings);
  return emptyGateway(id);
}

function safeSmsDetail(id: SmsGatewayId, status: number, text: string, config: SmsGatewayConfig) {
  return scrubSecrets(responseSummary(id, status, text), [config.apiKey, config.token, config.password]) || "SMS provider rejected the request";
}

export async function probeSmsGateway(settings: MessagingSettings, id: SmsGatewayId, incoming?: SmsGatewayConfig) {
  if (!isSmsGatewayId(id)) return { ok: false as const, detail: "Unknown SMS gateway" };
  if (id === "bytewave") return { ok: false as const, detail: "Bytewave cannot be tested until its API contract is verified." };
  const config = incoming ? mergeGatewayConfig(resolveStoredGateway(settings, id), incoming, id) : resolveStoredGateway(settings, id);
  if (!gatewayConfigured(id, config)) return { ok: false as const, detail: "Enter the required fields for this gateway." };
  const request = buildSmsProbe(id, config);
  if (!request) {
    return {
      ok: false as const,
      detail: `${smsGatewayLabel(id)} has no balance or status check. Use Send Test SMS to confirm delivery.`,
    };
  }
  if (/sendsms|send_sms|\/send\/message|\/sms\/send|\/messaging/i.test(request.url)) {
    return { ok: false as const, detail: SMS_TEST_FAIL };
  }
  try {
    const res = await executeSmsRequest(request);
    if (!res.ok) return { ok: false as const, detail: safeSmsDetail(id, res.status, res.text, config) || SMS_TEST_FAIL };
    try {
      const body = JSON.parse(res.text) as { success?: boolean };
      if (body.success === false) return { ok: false as const, detail: SMS_TEST_FAIL };
    } catch {
      /* non-json success body is acceptable when the HTTP status is ok */
    }
    return { ok: true as const, detail: SMS_TEST_OK };
  } catch (e) {
    const message = e instanceof Error ? e.message : SMS_TEST_FAIL;
    return { ok: false as const, detail: scrubSecrets(message, [config.apiKey, config.token, config.password]) || SMS_TEST_FAIL };
  }
}

export async function deliverSms(settings: MessagingSettings, phone: string, message: string) {
  const to = e164(phone);
  const mobile = keMobile(phone);
  if (!to) return { status: "failed" as const, detail: "No phone number" };
  const { id, config } = resolveActiveGateway(settings);
  if (settings.sms_sandbox || !gatewayConfigured(id, config)) {
    return { status: "sandbox" as const, detail: `${id} sandbox → ${to}` };
  }
  try {
    const request = buildSmsRequest(id, config, { mobile, to, message });
    const res = await executeSmsRequest(request);
    if (!res.ok) return { status: "failed" as const, detail: safeSmsDetail(id, res.status, res.text, config) };
    if (id === "webfam") {
      try {
        const body = JSON.parse(res.text) as {
          success?: boolean;
          data?: { message_id?: number; balance_remaining?: number; balanceRemaining?: number };
        };
        if (body.success === false) return { status: "failed" as const, detail: safeSmsDetail(id, res.status, res.text, config) };
        const remaining = body.data?.balance_remaining ?? body.data?.balanceRemaining;
        const mid = body.data?.message_id ? ` · id ${body.data.message_id}` : "";
        const bal = remaining != null ? ` · ${remaining} credits` : "";
        return { status: "sent" as const, detail: scrubSecrets(`Webfam SMS ${res.status}${mid}${bal}`, [config.token]).slice(0, 180) };
      } catch {
        return { status: "sent" as const, detail: safeSmsDetail(id, res.status, res.text, config) };
      }
    }
    return { status: "sent" as const, detail: safeSmsDetail(id, res.status, res.text, config) };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMS send failed";
    return { status: "failed" as const, detail: scrubSecrets(message, [config.apiKey, config.token, config.password]) || "SMS send failed" };
  }
}

export async function deliverWhatsapp(settings: MessagingSettings, phone: string, message: string) {
  const to = e164(phone).replace("+", "");
  if (!to) return { status: "failed" as const, detail: "No phone number" };
  if (!settings.wa_access_token || !settings.wa_phone_id || settings.wa_sandbox) {
    return { status: "sandbox" as const, detail: `WhatsApp sandbox → +${to}` };
  }
  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${settings.wa_phone_id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.wa_access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { preview_url: false, body: message },
      }),
    });
    if (!res.ok) return { status: "failed" as const, detail: `Meta ${res.status}` };
    return { status: "sent" as const, detail: `+${to}` };
  } catch (e) {
    return { status: "failed" as const, detail: e instanceof Error ? e.message : "WhatsApp send failed" };
  }
}

function emailReady(settings: MessagingSettings) {
  if (settings.email_provider === "smtp") return Boolean(settings.smtp_host.trim());
  return Boolean(settings.email_api_key.trim());
}

async function sendResend(
  settings: MessagingSettings,
  from: string,
  to: string,
  subject: string,
  body: string,
  attachments?: EmailAttachment[],
) {
  const payload: Record<string, unknown> = {
    from,
    to: [to],
    subject,
    text: body,
  };
  if (settings.email_reply_to && emailOk(settings.email_reply_to)) payload.reply_to = settings.email_reply_to;
  if (attachments?.length) {
    payload.attachments = attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      content_type: a.contentType || "application/pdf",
    }));
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${settings.email_api_key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) return { status: "failed" as const, detail: `Resend ${res.status} ${text.slice(0, 80)}` };
  return { status: "sent" as const, detail: to };
}

export async function deliverEmail(
  settings: MessagingSettings,
  to: string,
  subject: string,
  body: string,
  opts?: { attachments?: EmailAttachment[] },
) {
  const dest = to.trim();
  if (!emailOk(dest)) return { status: "failed" as const, detail: "No email address" };
  const from = formatFrom(settings);
  if (settings.email_sandbox || !emailReady(settings)) {
    const why = settings.email_sandbox ? "sandbox" : "not configured";
    return { status: "sandbox" as const, detail: `${settings.email_provider} ${why} → ${dest}` };
  }
  if (!from) return { status: "failed" as const, detail: "Set this ISP's from address" };
  try {
    if (settings.email_provider === "smtp") {
      await sendSmtp({
        host: settings.smtp_host,
        port: settings.smtp_port || 587,
        secure: settings.smtp_secure,
        username: settings.smtp_username,
        password: settings.smtp_password,
        from,
        to: dest,
        replyTo: emailOk(settings.email_reply_to) ? settings.email_reply_to : undefined,
        subject,
        body,
        attachments: opts?.attachments,
      });
      return { status: "sent" as const, detail: dest };
    }
    return await sendResend(settings, from, dest, subject, body, opts?.attachments);
  } catch (e) {
    return { status: "failed" as const, detail: e instanceof Error ? e.message : "Email send failed" };
  }
}

export async function deliverChannel(
  settings: MessagingSettings,
  channel: NotifyChannel,
  dest: string,
  body: string,
  opts?: { subject?: string; attachments?: EmailAttachment[] },
) {
  if (channel === "sms") return deliverSms(settings, dest, body);
  if (channel === "whatsapp") return deliverWhatsapp(settings, dest, body);
  if (channel === "email") return deliverEmail(settings, dest, opts?.subject || "Notice", body, opts);
  return { status: "sent" as const, detail: dest };
}

export async function saveMessagingSettings(
  sql: Sql,
  tenantId: string,
  patch: Partial<MessagingSettings> & {
    sms_api_key?: string;
    wa_access_token?: string;
    email_api_key?: string;
    smtp_password?: string;
  },
) {
  const current = await getMessagingSettings(sql, tenantId);
  const keepSecret = (incoming: string | undefined, existing: string) => {
    if (!incoming || incoming.startsWith("••••")) return existing;
    return incoming;
  };
  const fromAddr = (patch.email_from_address ?? current.email_from_address).trim();
  if (fromAddr && !emailOk(fromAddr)) throw new Error("From address must be a valid email");
  const replyTo = (patch.email_reply_to ?? current.email_reply_to).trim();
  if (replyTo && !emailOk(replyTo)) throw new Error("Reply-to must be a valid email");
  const provider = (patch.email_provider ?? current.email_provider).trim() || "resend";
  if (provider !== "resend" && provider !== "smtp") throw new Error("Email provider must be Resend or SMTP");
  const port = Number(patch.smtp_port ?? current.smtp_port ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SMTP port is invalid");
  const next: MessagingSettings = {
    payment_sms: patch.payment_sms ?? current.payment_sms,
    payment_whatsapp: patch.payment_whatsapp ?? current.payment_whatsapp,
    billing_sms: patch.billing_sms ?? current.billing_sms,
    billing_whatsapp: patch.billing_whatsapp ?? current.billing_whatsapp,
    sms_provider: patch.sms_provider ?? current.sms_provider,
    sms_sender_id: patch.sms_sender_id ?? current.sms_sender_id,
    sms_username: patch.sms_username ?? current.sms_username,
    sms_api_key: seal(keepSecret(patch.sms_api_key, current.sms_api_key)),
    sms_sandbox: patch.sms_sandbox ?? current.sms_sandbox,
    wa_provider: patch.wa_provider ?? current.wa_provider,
    wa_phone_id: patch.wa_phone_id ?? current.wa_phone_id,
    wa_access_token: seal(keepSecret(patch.wa_access_token, current.wa_access_token)),
    wa_business_id: patch.wa_business_id ?? current.wa_business_id,
    wa_sandbox: patch.wa_sandbox ?? current.wa_sandbox,
    payment_email: patch.payment_email ?? current.payment_email,
    billing_email: patch.billing_email ?? current.billing_email,
    email_provider: provider,
    email_from_name: (patch.email_from_name ?? current.email_from_name).trim().slice(0, 80),
    email_from_address: fromAddr.slice(0, 160),
    email_reply_to: replyTo.slice(0, 160),
    email_api_key: seal(keepSecret(patch.email_api_key, current.email_api_key)),
    smtp_host: (patch.smtp_host ?? current.smtp_host).trim().slice(0, 200),
    smtp_port: port,
    smtp_username: (patch.smtp_username ?? current.smtp_username).trim().slice(0, 160),
    smtp_password: seal(keepSecret(patch.smtp_password, current.smtp_password)),
    smtp_secure: patch.smtp_secure ?? current.smtp_secure,
    email_sandbox: patch.email_sandbox ?? current.email_sandbox,
    sms_gateways: current.sms_gateways,
  };
  await sql`update messaging_settings set
    payment_sms = ${next.payment_sms},
    payment_whatsapp = ${next.payment_whatsapp},
    billing_sms = ${next.billing_sms},
    billing_whatsapp = ${next.billing_whatsapp},
    sms_provider = ${next.sms_provider},
    sms_sender_id = ${next.sms_sender_id},
    sms_username = ${next.sms_username},
    sms_api_key = ${next.sms_api_key},
    sms_sandbox = ${next.sms_sandbox},
    wa_provider = ${next.wa_provider},
    wa_phone_id = ${next.wa_phone_id},
    wa_access_token = ${next.wa_access_token},
    wa_business_id = ${next.wa_business_id},
    wa_sandbox = ${next.wa_sandbox},
    payment_email = ${next.payment_email},
    billing_email = ${next.billing_email},
    email_provider = ${next.email_provider},
    email_from_name = ${next.email_from_name},
    email_from_address = ${next.email_from_address},
    email_reply_to = ${next.email_reply_to},
    email_api_key = ${next.email_api_key},
    smtp_host = ${next.smtp_host},
    smtp_port = ${next.smtp_port},
    smtp_username = ${next.smtp_username},
    smtp_password = ${next.smtp_password},
    smtp_secure = ${next.smtp_secure},
    email_sandbox = ${next.email_sandbox},
    updated_at = now()
    where tenant_id = ${tenantId}`;
  return {
    ...next,
    sms_api_key: open(next.sms_api_key),
    wa_access_token: open(next.wa_access_token),
    email_api_key: open(next.email_api_key),
    smtp_password: open(next.smtp_password),
    sms_gateways: current.sms_gateways,
  };
}

export async function saveSmsGatewaySettings(
  sql: Sql,
  tenantId: string,
  input: {
    id: string;
    config: SmsGatewayConfig;
    makeDefault?: boolean;
    payment_sms?: boolean;
    billing_sms?: boolean;
    sms_sandbox?: boolean;
  },
) {
  if (!isSmsGatewayId(input.id)) throw new Error("Unknown SMS gateway");
  const current = await getMessagingSettings(sql, tenantId);
  const store = parseGatewayStore(current.sms_gateways);
  const currentId: SmsGatewayId = isSmsGatewayId(current.sms_provider) ? current.sms_provider : "advanta";
  if (!store[currentId] && (current.sms_api_key || current.sms_username || current.sms_sender_id)) {
    store[currentId] = configFromFlat(currentId, current);
  }
  const nextStore = mergeGatewayStore(store, input.id, input.config);
  const merged = nextStore[input.id] || emptyGateway(input.id);
  validateGateway(input.id, merged);
  const keepDefault = input.makeDefault === true || current.sms_provider === input.id;
  if (keepDefault && !gatewayConfigured(input.id, merged)) {
    throw new Error("A gateway can be the default only after it is configured.");
  }
  let sms_provider = current.sms_provider;
  let sms_api_key = current.sms_api_key;
  let sms_username = current.sms_username;
  let sms_sender_id = current.sms_sender_id;
  if (keepDefault) {
    const projected = projectGateway(input.id, merged);
    sms_provider = input.id;
    sms_api_key = projected.sms_api_key;
    sms_username = projected.sms_username;
    sms_sender_id = projected.sms_sender_id;
  }
  await sql`update messaging_settings set
    payment_sms = ${input.payment_sms ?? current.payment_sms},
    billing_sms = ${input.billing_sms ?? current.billing_sms},
    sms_provider = ${sms_provider},
    sms_sender_id = ${sms_sender_id},
    sms_username = ${sms_username},
    sms_api_key = ${seal(sms_api_key)},
    sms_sandbox = ${input.sms_sandbox ?? current.sms_sandbox},
    sms_gateways = ${seal(JSON.stringify(nextStore))},
    updated_at = now()
    where tenant_id = ${tenantId}`;
  return getMessagingSettings(sql, tenantId);
}

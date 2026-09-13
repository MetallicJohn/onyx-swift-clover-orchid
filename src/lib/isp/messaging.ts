import type { BillingEvent, NotifyChannel } from "./types";
import { open, seal } from "./secrets";
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
};

export type MessagingPublic = Omit<
  MessagingSettings,
  "sms_api_key" | "wa_access_token" | "email_api_key" | "smtp_password"
> & {
  sms_api_key_set: boolean;
  sms_api_key_hint: string;
  wa_token_set: boolean;
  wa_token_hint: string;
  email_api_key_set: boolean;
  email_api_key_hint: string;
  smtp_password_set: boolean;
  smtp_password_hint: string;
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
           smtp_secure, email_sandbox
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
    };
  }
  await sql`insert into messaging_settings (tenant_id) values (${tenantId})`;
  return { ...DEFAULTS };
}

function hint(secret: string) {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export function toPublic(s: MessagingSettings): MessagingPublic {
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
  };
}

export function channelAllowed(event: BillingEvent, channel: NotifyChannel, s: MessagingSettings) {
  if (channel === "in_app") return true;
  const payment = event === "payment.received" || event === "service.restored";
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

async function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

async function sendHostpinnacle(host: string, settings: MessagingSettings, mobile: string, message: string) {
  return postJson(`${host.replace(/\/$/, "")}/api/services/sendsms/`, {
    apikey: settings.sms_api_key,
    partnerID: settings.sms_username,
    message,
    shortcode: settings.sms_sender_id,
    mobile,
  });
}

async function sendTalksasaV3(base: string, settings: MessagingSettings, mobile: string, message: string) {
  return postJson(
    `${base.replace(/\/$/, "")}/sms/send`,
    {
      recipient: mobile.startsWith("+") ? mobile : `+${mobile}`,
      sender_id: settings.sms_sender_id,
      type: "plain",
      message,
    },
    { Authorization: `Bearer ${settings.sms_api_key}` },
  );
}

async function sendWebfam(settings: MessagingSettings, mobile: string, message: string) {
  const body: Record<string, string> = { to: mobile, message };
  if (settings.sms_sender_id) body.sender_id = settings.sms_sender_id;
  return postJson("https://sms.webfam.co.ke/api/v1/sms/send", body, {
    Authorization: `Bearer ${settings.sms_api_key}`,
  });
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

export async function deliverSms(settings: MessagingSettings, phone: string, message: string) {
  const to = e164(phone);
  const mobile = keMobile(phone);
  if (!to) return { status: "failed" as const, detail: "No phone number" };
  if (!settings.sms_api_key || settings.sms_sandbox) {
    return { status: "sandbox" as const, detail: `${settings.sms_provider} sandbox → ${to}` };
  }
  try {
    const kind = settings.sms_provider;
    if (kind === "africastalking") {
      const body = new URLSearchParams({
        username: settings.sms_username,
        to,
        message,
        ...(settings.sms_sender_id ? { from: settings.sms_sender_id } : {}),
      });
      const res = await fetch("https://api.africastalking.com/version1/messaging", {
        method: "POST",
        headers: {
          apiKey: settings.sms_api_key,
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (!res.ok) return { status: "failed" as const, detail: `Africa's Talking ${res.status}` };
      return { status: "sent" as const, detail: to };
    }
    if (kind === "twilio") {
      const sid = settings.sms_username;
      const auth = Buffer.from(`${sid}:${settings.sms_api_key}`).toString("base64");
      const body = new URLSearchParams({
        To: to,
        From: settings.sms_sender_id,
        Body: message,
      });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) return { status: "failed" as const, detail: `Twilio ${res.status}` };
      return { status: "sent" as const, detail: to };
    }
    if (kind === "talksasa") {
      const r = await sendTalksasaV3("https://bulksms.talksasa.com/api/v3", settings, mobile, message);
      if (!r.ok) return { status: "failed" as const, detail: `Talksasa ${r.status} ${r.text.slice(0, 80)}` };
      return { status: "sent" as const, detail: to };
    }
    if (kind === "blessedtexts") {
      const r = await sendHostpinnacle("https://sms.blessedtexts.com", settings, mobile, message);
      if (!r.ok) return { status: "failed" as const, detail: `Blessed Texts ${r.status} ${r.text.slice(0, 80)}` };
      return { status: "sent" as const, detail: to };
    }
    if (kind === "webfam") {
      const r = await sendWebfam(settings, mobile, message);
      if (!r.ok) return { status: "failed" as const, detail: webfamError(r.status, r.text) };
      try {
        const j = JSON.parse(r.text) as {
          success?: boolean;
          error?: string;
          data?: { message_id?: number; status?: string; balance_remaining?: number; balanceRemaining?: number };
        };
        if (j.success === false) return { status: "failed" as const, detail: webfamError(r.status, r.text) };
        const remaining = j.data?.balance_remaining ?? j.data?.balanceRemaining;
        const id = j.data?.message_id ? `#${j.data.message_id}` : "";
        const bal = remaining != null ? ` · ${remaining} credits` : "";
        return { status: "sent" as const, detail: `${to} ${id}${bal}`.trim() };
      } catch {
        return { status: "sent" as const, detail: to };
      }
    }
    const res = await fetch("https://api.advantasms.com/v1/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": settings.sms_api_key },
      body: JSON.stringify({
        partnerID: settings.sms_username,
        shortcode: settings.sms_sender_id,
        mobile,
        message,
      }),
    });
    if (!res.ok) return { status: "failed" as const, detail: `Advanta ${res.status}` };
    return { status: "sent" as const, detail: to };
  } catch (e) {
    return { status: "failed" as const, detail: e instanceof Error ? e.message : "SMS send failed" };
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
  return { ...next, sms_api_key: open(next.sms_api_key), wa_access_token: open(next.wa_access_token), email_api_key: open(next.email_api_key), smtp_password: open(next.smtp_password) };
}

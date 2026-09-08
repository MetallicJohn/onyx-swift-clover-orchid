import type { BillingEvent, NotifyChannel } from "./notifications";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
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
};

export type MessagingPublic = Omit<MessagingSettings, "sms_api_key" | "wa_access_token"> & {
  sms_api_key_set: boolean;
  sms_api_key_hint: string;
  wa_token_set: boolean;
  wa_token_hint: string;
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
};

export async function ensureMessagingSchema(sql: Sql) {
  await sql.query(`
    create table if not exists messaging_settings (
      tenant_id text primary key references tenants(id) on delete cascade,
      payment_sms boolean not null default true,
      payment_whatsapp boolean not null default true,
      billing_sms boolean not null default true,
      billing_whatsapp boolean not null default false,
      sms_provider text not null default 'africastalking',
      sms_sender_id text not null default '',
      sms_username text not null default '',
      sms_api_key text not null default '',
      sms_sandbox boolean not null default true,
      wa_provider text not null default 'meta',
      wa_phone_id text not null default '',
      wa_access_token text not null default '',
      wa_business_id text not null default '',
      wa_sandbox boolean not null default true,
      updated_at timestamptz not null default now()
    )`);
}

export async function getMessagingSettings(sql: Sql, tenantId: string): Promise<MessagingSettings> {
  await ensureMessagingSchema(sql);
  const rows = await sql<MessagingSettings>`
    select payment_sms, payment_whatsapp, billing_sms, billing_whatsapp,
           sms_provider, sms_sender_id, sms_username, sms_api_key, sms_sandbox,
           wa_provider, wa_phone_id, wa_access_token, wa_business_id, wa_sandbox
    from messaging_settings where tenant_id = ${tenantId}`;
  if (rows[0]) return rows[0];
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
    sms_api_key_set: Boolean(s.sms_api_key),
    sms_api_key_hint: hint(s.sms_api_key),
    wa_token_set: Boolean(s.wa_access_token),
    wa_token_hint: hint(s.wa_access_token),
  };
}

export function channelAllowed(event: BillingEvent, channel: NotifyChannel, s: MessagingSettings) {
  if (channel === "in_app" || channel === "email") return true;
  const payment = event === "payment.received" || event === "service.restored";
  if (channel === "sms") return payment ? s.payment_sms : s.billing_sms;
  if (channel === "whatsapp") return payment ? s.payment_whatsapp : s.billing_whatsapp;
  return false;
}

function e164(phone: string) {
  const d = phone.replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("254")) return `+${d}`;
  if (d.startsWith("0") && d.length >= 10) return `+254${d.slice(1)}`;
  if (d.length === 9) return `+254${d}`;
  return `+${d}`;
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

export async function deliverChannel(
  settings: MessagingSettings,
  channel: NotifyChannel,
  dest: string,
  body: string,
) {
  if (channel === "sms") return deliverSms(settings, dest, body);
  if (channel === "whatsapp") return deliverWhatsapp(settings, dest, body);
  return { status: "sent" as const, detail: dest };
}

export async function saveMessagingSettings(
  sql: Sql,
  tenantId: string,
  patch: Partial<MessagingSettings> & { sms_api_key?: string; wa_access_token?: string },
) {
  const current = await getMessagingSettings(sql, tenantId);
  const keepSecret = (incoming: string | undefined, existing: string) => {
    if (!incoming || incoming.startsWith("••••")) return existing;
    return incoming;
  };
  const next: MessagingSettings = {
    payment_sms: patch.payment_sms ?? current.payment_sms,
    payment_whatsapp: patch.payment_whatsapp ?? current.payment_whatsapp,
    billing_sms: patch.billing_sms ?? current.billing_sms,
    billing_whatsapp: patch.billing_whatsapp ?? current.billing_whatsapp,
    sms_provider: patch.sms_provider ?? current.sms_provider,
    sms_sender_id: patch.sms_sender_id ?? current.sms_sender_id,
    sms_username: patch.sms_username ?? current.sms_username,
    sms_api_key: keepSecret(patch.sms_api_key, current.sms_api_key),
    sms_sandbox: patch.sms_sandbox ?? current.sms_sandbox,
    wa_provider: patch.wa_provider ?? current.wa_provider,
    wa_phone_id: patch.wa_phone_id ?? current.wa_phone_id,
    wa_access_token: keepSecret(patch.wa_access_token, current.wa_access_token),
    wa_business_id: patch.wa_business_id ?? current.wa_business_id,
    wa_sandbox: patch.wa_sandbox ?? current.wa_sandbox,
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
    updated_at = now()
    where tenant_id = ${tenantId}`;
  return next;
}


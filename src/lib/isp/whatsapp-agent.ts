import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { nid } from "../utils.ts";
import { runAcsDeviceAction } from "./acs-device-actions.ts";
import { enqueueJob } from "./jobs.ts";
import { deliverSms, deliverWhatsapp, e164, getMessagingSettings } from "./messaging.ts";
import { rotatePppoeCredentials } from "./pppoe-provision.ts";
import { rateLimit } from "./rate-limit.ts";
import { open, seal } from "./secrets.ts";
import { createStkIntent } from "./payments.ts";
import { remainingKes } from "./billing.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const WA_UNVERIFIED = "We could not verify this WhatsApp number. Please contact support for assistance.";
export const WA_OTP_ASK = "I sent a verification code by SMS. Reply here with the 6-digit code. The code is not sent on WhatsApp.";
export const WA_OTP_BAD = "That code is not valid. Check the SMS and try again.";
export const WA_OTP_LOCKED = "We could not verify this WhatsApp number. Please contact support for assistance.";
export const WA_MENU = [
  "How can I help?",
  "",
  "1 My Account",
  "2 Payments",
  "3 Internet Problem",
  "4 My Service",
  "5 Support",
  "6 Pay now",
].join("\n");

const IDENTIFY_PER_HOUR = 10;
const OTP_PER_15_MIN = 3;
const OTP_COOLDOWN_MS = 30_000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_TTL_MIN = 60;
const OTP_TTL_MAX = 300;
const LEVEL2_TTL_MIN = 60;
const LEVEL2_TTL_MAX = 600;

export type WaActionGroup = "faq" | "read" | "ticket" | "connection" | "cpe" | "password" | "service" | "payment";

export type WaActionDef = {
  id: string;
  name: string;
  group: WaActionGroup;
  level: 0 | 1 | 2;
  confirm: boolean;
  confirmTtlSec: number;
  executable: boolean;
  ratePerHour: number;
};

export const WA_ACTIONS: WaActionDef[] = [
  { id: "CHECK_ACCOUNT", name: "Check Account", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 30 },
  { id: "CHECK_SERVICE", name: "Check Service", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 30 },
  { id: "CHECK_PAYMENT", name: "Check Payment", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 30 },
  { id: "CHECK_BALANCE", name: "Check Balance", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 30 },
  { id: "GET_INVOICE", name: "Get Invoice", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 20 },
  { id: "GET_STATEMENT", name: "Get Statement", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 20 },
  { id: "CHECK_CONNECTION", name: "Check Connection", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 20 },
  { id: "RUN_CONNECTION_DIAGNOSTIC", name: "Run Diagnostic", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 10 },
  { id: "CREATE_TICKET", name: "Create Ticket", group: "ticket", level: 1, confirm: false, confirmTtlSec: 0, executable: true, ratePerHour: 6 },
  { id: "REQUEST_TECHNICIAN", name: "Request Technician", group: "ticket", level: 1, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 4 },
  { id: "REFRESH_CONNECTION", name: "Refresh Connection", group: "connection", level: 1, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 4 },
  { id: "DISCONNECT_SESSION", name: "Disconnect Session", group: "connection", level: 2, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 2 },
  { id: "RECONNECT_SESSION", name: "Reconnect Session", group: "connection", level: 2, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 2 },
  { id: "REBOOT_CPE", name: "Reboot Router", group: "cpe", level: 1, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 2 },
  { id: "CHECK_CPE_STATUS", name: "Check Router", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 20 },
  { id: "RUN_CPE_DIAGNOSTIC", name: "Router Diagnostic", group: "read", level: 1, confirm: false, confirmTtlSec: 0, executable: false, ratePerHour: 10 },
  { id: "CHANGE_PPPOE_PASSWORD", name: "Change PPPoE Password", group: "password", level: 2, confirm: true, confirmTtlSec: 300, executable: true, ratePerHour: 2 },
  { id: "RESET_PPPOE_PASSWORD", name: "Reset PPPoE Password", group: "password", level: 2, confirm: true, confirmTtlSec: 300, executable: true, ratePerHour: 2 },
  { id: "CHANGE_WIFI_PASSWORD", name: "Change WiFi Password", group: "cpe", level: 2, confirm: true, confirmTtlSec: 300, executable: true, ratePerHour: 2 },
  { id: "RENEW_SERVICE", name: "Renew Service", group: "service", level: 2, confirm: true, confirmTtlSec: 300, executable: true, ratePerHour: 3 },
  { id: "REQUEST_SERVICE_UPGRADE", name: "Request Upgrade", group: "service", level: 1, confirm: true, confirmTtlSec: 300, executable: true, ratePerHour: 3 },
  { id: "PAY_INVOICE", name: "Pay invoice", group: "payment", level: 1, confirm: true, confirmTtlSec: 180, executable: true, ratePerHour: 4 },
];

const ACTION_IDS = WA_ACTIONS.map((action) => action.id);
const ACTION_BY_ID = new Map(WA_ACTIONS.map((action) => [action.id, action]));

export function waAction(id: string) {
  return ACTION_BY_ID.get(id) || null;
}

export type WaSettings = {
  enabled: boolean;
  ai_enabled: boolean;
  read_only_enabled: boolean;
  connection_actions_enabled: boolean;
  cpe_actions_enabled: boolean;
  password_actions_enabled: boolean;
  service_actions_enabled: boolean;
  payment_prompt_enabled: boolean;
  kill_switch: boolean;
  link_mode: string;
  otp_ttl_seconds: number;
  level2_ttl_seconds: number;
  business_hours: string;
  handoff_phone: string;
  actions: Record<string, boolean>;
};

const DEFAULT_SETTINGS: WaSettings = {
  enabled: false,
  ai_enabled: false,
  read_only_enabled: true,
  connection_actions_enabled: false,
  cpe_actions_enabled: false,
  password_actions_enabled: false,
  service_actions_enabled: false,
  payment_prompt_enabled: false,
  kill_switch: false,
  link_mode: "web",
  otp_ttl_seconds: 300,
  level2_ttl_seconds: 600,
  business_hours: "",
  handoff_phone: "",
  actions: {},
};

export function clampOtpTtl(value: number) {
  const n = Math.floor(Number(value) || 300);
  return Math.min(OTP_TTL_MAX, Math.max(OTP_TTL_MIN, n));
}

export function clampLevel2Ttl(value: number) {
  const n = Math.floor(Number(value) || 600);
  return Math.min(LEVEL2_TTL_MAX, Math.max(LEVEL2_TTL_MIN, n));
}

function pepper() {
  return (process.env.APP_SECRET || process.env.BETTER_AUTH_SECRET || "").trim() || "isp-wa-otp";
}

export function hashWhatsAppOtp(id: string, code: string) {
  return createHash("sha256").update(`${pepper()}:${id}:${code}`).digest("hex");
}

function hashesMatch(stored: string, computed: string) {
  const a = Buffer.from(stored);
  const b = Buffer.from(computed);
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

export function normalizeWhatsAppPhone(raw: string) {
  const value = e164(String(raw || "").replace(/@.*/, ""));
  return value;
}

function last9(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export type WaIntent = { intent: string; confidence: number };

const IntentSchema = z
  .object({
    intent: z.string(),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

/** Model output may only name a registered intent. Extra fields, including router ids, are rejected. */
export function parseModelIntent(raw: string): WaIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = IntentSchema.safeParse(parsed);
  if (!result.success) return null;
  if (result.data.intent !== "MENU" && result.data.intent !== "CLARIFY" && !waAction(result.data.intent)) return null;
  return { intent: result.data.intent, confidence: result.data.confidence ?? 0 };
}

const INFRA = /\b(?:10|172|192)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b|\bwg-ispsolutions\b|\brouter\s*id\b/i;

export function classifyIntent(text: string): WaIntent {
  const raw = text.trim();
  const q = raw.toLowerCase();
  if (!q || /^(hi|hello|hey|menu|start|help)$/.test(q)) return { intent: "MENU", confidence: 1 };
  if (isPayRequest(q)) return { intent: "PAY_INVOICE", confidence: 0.92 };
  if (/^[1]$|my account|account status|what's my package|whats my package|package/.test(q)) return { intent: "CHECK_ACCOUNT", confidence: 0.9 };
  if (/^[2]$|payment|i paid|balance|m-pesa|mpesa/.test(q)) return { intent: "CHECK_PAYMENT", confidence: 0.9 };
  if (/invoice/.test(q)) return { intent: "GET_INVOICE", confidence: 0.9 };
  if (/statement/.test(q)) return { intent: "GET_STATEMENT", confidence: 0.9 };
  if (/^[3]$|internet|connection|offline|online|not working/.test(q) && !/restart|reboot|refresh/.test(q)) return { intent: "CHECK_CONNECTION", confidence: 0.86 };
  if (/diagnostic/.test(q)) return { intent: "RUN_CONNECTION_DIAGNOSTIC", confidence: 0.8 };
  if (/refresh|reconnect/.test(q)) return { intent: "REFRESH_CONNECTION", confidence: 0.9 };
  if (/disconnect/.test(q)) return { intent: "DISCONNECT_SESSION", confidence: 0.9 };
  if (/restart|reboot/.test(q)) return { intent: "REBOOT_CPE", confidence: 0.9 };
  if (/wifi password|wi-fi password/.test(q)) return { intent: "CHANGE_WIFI_PASSWORD", confidence: 0.9 };
  if (/pppoe password|change.*password|reset.*password/.test(q)) return { intent: "CHANGE_PPPOE_PASSWORD", confidence: 0.9 };
  if (/upgrade/.test(q)) return { intent: "REQUEST_SERVICE_UPGRADE", confidence: 0.85 };
  if (/renew/.test(q)) return { intent: "RENEW_SERVICE", confidence: 0.85 };
  if (/technician/.test(q)) return { intent: "REQUEST_TECHNICIAN", confidence: 0.9 };
  if (/^[5]$|talk to support|human|agent/.test(q)) return { intent: "CREATE_TICKET", confidence: 0.8 };
  if (/^[4]$|my service|service status/.test(q)) return { intent: "CHECK_SERVICE", confidence: 0.9 };
  if (INFRA.test(raw)) return { intent: "CLARIFY", confidence: 0.2 };
  return { intent: "CLARIFY", confidence: 0.3 };
}

/** A request to send an STK prompt. Claims that money was already sent stay a payment lookup. */
export function isPayRequest(q: string) {
  if (/\b(i paid|paid already|already paid|have paid)\b/.test(q)) return false;
  if (/^[6]$/.test(q)) return true;
  if (/\blipa\b|\bstk\b|payment prompt|pay now|pay my|pay the|pay for|pay invoice|send (me )?(a |an )?(mpesa |m-pesa )?prompt/.test(q)) return true;
  return /\bpay\b/.test(q) && !/\bbalance\b/.test(q);
}

export function actionAllowed(settings: WaSettings, id: string) {
  const action = waAction(id);
  if (!action) return false;
  if (!settings.enabled) return false;
  if (settings.actions[id] === false) return false;
  if (settings.kill_switch && action.executable) return false;
  if (settings.actions[id] === true) return true;
  if (action.group === "read" && !settings.read_only_enabled) return false;
  if (action.group === "connection" && !settings.connection_actions_enabled) return false;
  if (action.group === "cpe" && !settings.cpe_actions_enabled) return false;
  if (action.group === "password" && !settings.password_actions_enabled) return false;
  if (action.group === "service" && !settings.service_actions_enabled) return false;
  if (action.group === "payment" && !settings.payment_prompt_enabled) return false;
  return true;
}

type Conversation = {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  phone_e164: string;
  verification_level: number;
  verification_expires_at: string | null;
  pending_action_id: string | null;
  automation_paused: boolean;
  otp_failures: number;
  level2_blocked_until: string | null;
};

type ActionRow = {
  id: string;
  action: string;
  parameters: string;
  status: string;
  confirmation_expires_at: string | null;
  customer_id: string | null;
  conversation_id: string;
};

function safeText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 1800);
}

function storedContent(text: string) {
  if (/^\d{6}$/.test(text.trim())) return "[verification code]";
  return safeText(text);
}

async function audit(sql: Sql, tenantId: string, action: string, entityId: string) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id)
    values (${nid("aud")}, ${tenantId}, 'whatsapp', ${action}, 'whatsapp', ${entityId})`;
}

async function securityEvent(sql: Sql, tenantId: string, kind: string, phone: string, customerId = "", detail = "") {
  const clean = detail.replace(/[0-9]{6}/g, "######").slice(0, 180);
  await sql`insert into whatsapp_security_events (id, tenant_id, kind, phone_e164, customer_id, detail)
    values (${nid("wse")}, ${tenantId}, ${kind}, ${phone}, ${customerId}, ${clean})`;
}

export async function getWhatsAppAgentSettings(sql: Sql, tenantId: string): Promise<WaSettings> {
  const [row] = await sql<{
    enabled: boolean;
    ai_enabled: boolean;
    read_only_enabled: boolean;
    connection_actions_enabled: boolean;
    cpe_actions_enabled: boolean;
    password_actions_enabled: boolean;
    service_actions_enabled: boolean;
    payment_prompt_enabled: boolean;
    kill_switch: boolean;
    link_mode: string;
    otp_ttl_seconds: number;
    level2_ttl_seconds: number;
    business_hours: string;
    handoff_phone: string;
    actions_json: string;
  }>`select enabled, ai_enabled, read_only_enabled, connection_actions_enabled, cpe_actions_enabled,
            password_actions_enabled, service_actions_enabled, payment_prompt_enabled, kill_switch, link_mode, otp_ttl_seconds,
            level2_ttl_seconds, business_hours, handoff_phone, actions_json
     from whatsapp_agent_settings where tenant_id = ${tenantId}`;
  if (!row) return { ...DEFAULT_SETTINGS };
  let actions: Record<string, boolean> = {};
  try {
    const parsed = JSON.parse(row.actions_json || "{}") as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (waAction(key)) actions[key] = value === true;
    }
  } catch {
    actions = {};
  }
  return {
    enabled: Boolean(row.enabled),
    ai_enabled: Boolean(row.ai_enabled),
    read_only_enabled: Boolean(row.read_only_enabled),
    connection_actions_enabled: Boolean(row.connection_actions_enabled),
    cpe_actions_enabled: Boolean(row.cpe_actions_enabled),
    password_actions_enabled: Boolean(row.password_actions_enabled),
    service_actions_enabled: Boolean(row.service_actions_enabled),
    payment_prompt_enabled: Boolean(row.payment_prompt_enabled),
    kill_switch: Boolean(row.kill_switch),
    link_mode: row.link_mode === "meta" ? "meta" : "web",
    otp_ttl_seconds: clampOtpTtl(Number(row.otp_ttl_seconds)),
    level2_ttl_seconds: clampLevel2Ttl(Number(row.level2_ttl_seconds)),
    business_hours: row.business_hours || "",
    handoff_phone: row.handoff_phone || "",
    actions,
  };
}

export async function saveWhatsAppAgentSettings(sql: Sql, tenantId: string, patch: Partial<WaSettings>) {
  const current = await getWhatsAppAgentSettings(sql, tenantId);
  const next: WaSettings = {
    ...current,
    ...patch,
    otp_ttl_seconds: clampOtpTtl(patch.otp_ttl_seconds ?? current.otp_ttl_seconds),
    level2_ttl_seconds: clampLevel2Ttl(patch.level2_ttl_seconds ?? current.level2_ttl_seconds),
    link_mode: patch.link_mode === "meta" ? "meta" : patch.link_mode === "web" ? "web" : current.link_mode,
    actions: patch.actions || current.actions,
  };
  const actionsJson = JSON.stringify(next.actions);
  await sql`insert into whatsapp_agent_settings (
      tenant_id, enabled, ai_enabled, read_only_enabled, connection_actions_enabled, cpe_actions_enabled,
      password_actions_enabled, service_actions_enabled, payment_prompt_enabled, kill_switch, link_mode, otp_ttl_seconds,
      level2_ttl_seconds, business_hours, handoff_phone, actions_json, updated_at
    ) values (
      ${tenantId}, ${next.enabled}, ${next.ai_enabled}, ${next.read_only_enabled}, ${next.connection_actions_enabled},
      ${next.cpe_actions_enabled}, ${next.password_actions_enabled}, ${next.service_actions_enabled}, ${next.payment_prompt_enabled}, ${next.kill_switch},
      ${next.link_mode}, ${next.otp_ttl_seconds}, ${next.level2_ttl_seconds}, ${next.business_hours.slice(0, 40)},
      ${next.handoff_phone.slice(0, 40)}, ${actionsJson}, now()
    )
    on conflict (tenant_id) do update set
      enabled = excluded.enabled,
      ai_enabled = excluded.ai_enabled,
      read_only_enabled = excluded.read_only_enabled,
      connection_actions_enabled = excluded.connection_actions_enabled,
      cpe_actions_enabled = excluded.cpe_actions_enabled,
      password_actions_enabled = excluded.password_actions_enabled,
      service_actions_enabled = excluded.service_actions_enabled,
      payment_prompt_enabled = excluded.payment_prompt_enabled,
      kill_switch = excluded.kill_switch,
      link_mode = excluded.link_mode,
      otp_ttl_seconds = excluded.otp_ttl_seconds,
      level2_ttl_seconds = excluded.level2_ttl_seconds,
      business_hours = excluded.business_hours,
      handoff_phone = excluded.handoff_phone,
      actions_json = excluded.actions_json,
      updated_at = now()`;
  return getWhatsAppAgentSettings(sql, tenantId);
}

async function ensureWebhookSecret(sql: Sql, tenantId: string) {
  const [row] = await sql<{ webhook_secret: string }>`select webhook_secret from whatsapp_agent_settings where tenant_id = ${tenantId}`;
  if (row?.webhook_secret) return open(row.webhook_secret);
  const secret = randomBytes(24).toString("base64url");
  await saveWhatsAppAgentSettings(sql, tenantId, {});
  await sql`update whatsapp_agent_settings set webhook_secret = ${seal(secret)} where tenant_id = ${tenantId}`;
  return secret;
}

export async function whatsAppWebhookSecret(sql: Sql, tenantId: string) {
  return ensureWebhookSecret(sql, tenantId);
}

async function countSince(sql: Sql, tenantId: string, phone: string, kind: string, seconds: number) {
  const [row] = await sql<{ n: number }>`select count(*)::int as n from whatsapp_security_events
    where tenant_id = ${tenantId} and phone_e164 = ${phone} and kind = ${kind}
      and created_at > now() - (${seconds} * interval '1 second')`;
  return Number(row?.n || 0);
}

async function findCustomer(sql: Sql, tenantId: string, phone: string) {
  const tail = last9(phone);
  if (!tail) return { status: "unknown" as const, customer: null };
  const rows = await sql<{ id: string; name: string; phone: string }>`
    select id, name, phone from customers
    where tenant_id = ${tenantId} and deleted_at is null
      and right(regexp_replace(phone, '\\D', '', 'g'), 9) = ${tail}
    limit 3`;
  if (rows.length === 1) return { status: "one" as const, customer: rows[0] };
  if (rows.length > 1) return { status: "ambiguous" as const, customer: null };
  return { status: "unknown" as const, customer: null };
}

function levelOf(convo: Conversation, now = Date.now()) {
  if (convo.verification_level >= 2 && convo.verification_expires_at && new Date(convo.verification_expires_at).getTime() > now) return 2;
  if (convo.customer_id) return 1;
  return 0;
}

async function loadConversation(sql: Sql, tenantId: string, phone: string) {
  const [row] = await sql<Conversation>`select id, tenant_id, customer_id, phone_e164, verification_level,
      verification_expires_at::text, pending_action_id, automation_paused, otp_failures, level2_blocked_until::text
    from whatsapp_conversations where tenant_id = ${tenantId} and phone_e164 = ${phone}`;
  return row || null;
}

async function touchConversation(sql: Sql, tenantId: string, phone: string) {
  const existing = await loadConversation(sql, tenantId, phone);
  if (existing) {
    await sql`update whatsapp_conversations set last_message_at = now(), updated_at = now() where id = ${existing.id}`;
    return existing;
  }
  const id = nid("wac");
  await sql`insert into whatsapp_conversations (id, tenant_id, phone_e164) values (${id}, ${tenantId}, ${phone})`;
  return (await loadConversation(sql, tenantId, phone))!;
}

async function insertMessage(sql: Sql, input: {
  tenantId: string;
  conversationId: string;
  provider: string;
  providerMessageId: string;
  direction: "in" | "out";
  content: string;
  intent?: string;
}) {
  const id = nid("wam");
  try {
    await sql`insert into whatsapp_messages
      (id, tenant_id, conversation_id, provider, provider_message_id, direction, content, intent, processing_status)
      values (${id}, ${input.tenantId}, ${input.conversationId}, ${input.provider}, ${input.providerMessageId},
        ${input.direction}, ${storedContent(input.content)}, ${input.intent || ""}, 'stored')`;
    return { id, duplicate: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/unique|duplicate/i.test(message)) return { id: "", duplicate: true };
    throw err;
  }
}

function isYes(text: string) {
  return /^(yes|y|confirm|ndio|sawa)$/i.test(text.trim());
}
function isNo(text: string) {
  return /^(no|n|cancel|stop|hapana)$/i.test(text.trim());
}

async function issueOtp(sql: Sql, tenantId: string, convo: Conversation, action: string, settings: WaSettings) {
  if (!convo.customer_id) return { ok: false as const, reply: WA_UNVERIFIED };
  if (convo.level2_blocked_until && new Date(convo.level2_blocked_until).getTime() > Date.now()) {
    await securityEvent(sql, tenantId, "otp_blocked", convo.phone_e164, convo.customer_id);
    return { ok: false as const, reply: WA_OTP_LOCKED };
  }
  const recent = await sql<{ n: number }>`select count(*)::int as n from whatsapp_otp_challenges
    where tenant_id = ${tenantId} and customer_id = ${convo.customer_id}
      and created_at > now() - interval '15 minutes'`;
  if (Number(recent[0]?.n || 0) >= OTP_PER_15_MIN) {
    await securityEvent(sql, tenantId, "otp_rate", convo.phone_e164, convo.customer_id);
    return { ok: false as const, reply: WA_OTP_LOCKED };
  }
  const [last] = await sql<{ created_at: string }>`select created_at::text from whatsapp_otp_challenges
    where tenant_id = ${tenantId} and conversation_id = ${convo.id}
    order by created_at desc limit 1`;
  if (last && Date.now() - new Date(last.created_at).getTime() < OTP_COOLDOWN_MS) {
    return { ok: false as const, reply: "Please wait a moment before requesting another SMS code." };
  }
  const messaging = await getMessagingSettings(sql, tenantId);
  const id = nid("waotp");
  const code = messaging.sms_sandbox ? "000000" : String(randomInt(0, 1_000_000)).padStart(6, "0");
  const hash = hashWhatsAppOtp(id, code);
  await sql`update whatsapp_otp_challenges set used_at = now(), otp_hash = ''
    where tenant_id = ${tenantId} and conversation_id = ${convo.id} and used_at is null`;
  await sql`insert into whatsapp_otp_challenges
    (id, tenant_id, customer_id, conversation_id, action_context, otp_hash, max_attempts, expires_at)
    values (${id}, ${tenantId}, ${convo.customer_id}, ${convo.id}, ${action}, ${hash}, ${OTP_MAX_ATTEMPTS},
      now() + (${settings.otp_ttl_seconds} * interval '1 second'))`;
  const sms = await deliverSms(messaging, convo.phone_e164, `Your ISP verification code is ${code}. It expires in 5 minutes.`);
  await audit(sql, tenantId, "WHATSAPP_OTP_ISSUED", id);
  if (sms.status === "failed") return { ok: false as const, reply: "I couldn't send the SMS code. Please contact support." };
  return { ok: true as const, reply: WA_OTP_ASK };
}

async function verifyOtp(sql: Sql, tenantId: string, convo: Conversation, code: string, settings: WaSettings) {
  const [row] = await sql<{ id: string; otp_hash: string; attempts: number; action_context: string }>`
    select id, otp_hash, attempts, action_context from whatsapp_otp_challenges
    where tenant_id = ${tenantId} and conversation_id = ${convo.id} and used_at is null and expires_at > now()
    order by created_at desc limit 1`;
  if (!row || !row.otp_hash) {
    await audit(sql, tenantId, "WHATSAPP_OTP_FAILED", convo.id);
    return { ok: false as const, reply: WA_OTP_BAD, action: "" };
  }
  if (row.attempts >= OTP_MAX_ATTEMPTS) {
    await sql`update whatsapp_otp_challenges set used_at = now(), otp_hash = '' where id = ${row.id}`;
    return { ok: false as const, reply: WA_OTP_BAD, action: "" };
  }
  const match = hashesMatch(row.otp_hash, hashWhatsAppOtp(row.id, code));
  if (!match) {
    const attempts = row.attempts + 1;
    await sql`update whatsapp_otp_challenges set attempts = ${attempts} where id = ${row.id}`;
    const failures = convo.otp_failures + 1;
    if (attempts >= OTP_MAX_ATTEMPTS) {
      await sql`update whatsapp_otp_challenges set used_at = now(), otp_hash = '' where id = ${row.id}`;
    }
    if (failures >= 3) {
      await sql`update whatsapp_conversations set otp_failures = ${failures}, level2_blocked_until = now() + interval '24 hours', updated_at = now()
        where id = ${convo.id}`;
      await securityEvent(sql, tenantId, "otp_lockout", convo.phone_e164, convo.customer_id || "");
      await audit(sql, tenantId, "WHATSAPP_OTP_FAILED", row.id);
      return { ok: false as const, reply: WA_OTP_LOCKED, action: "" };
    }
    await sql`update whatsapp_conversations set otp_failures = ${failures}, updated_at = now() where id = ${convo.id}`;
    await audit(sql, tenantId, "WHATSAPP_OTP_FAILED", row.id);
    return { ok: false as const, reply: WA_OTP_BAD, action: "" };
  }
  await sql`update whatsapp_otp_challenges set used_at = now(), otp_hash = '' where id = ${row.id}`;
  await sql`update whatsapp_conversations set verification_level = 2, otp_failures = 0,
      verification_expires_at = now() + (${settings.level2_ttl_seconds} * interval '1 second'), updated_at = now()
    where id = ${convo.id}`;
  await audit(sql, tenantId, "WHATSAPP_OTP_VERIFIED", row.id);
  return { ok: true as const, reply: "You're verified for the next few minutes.", action: row.action_context };
}

async function activeService(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{
    id: string;
    status: string;
    access_method: string;
    username: string | null;
    period_end: string | null;
    package_name: string;
    download_mbps: number;
    price_kes: number;
  }>`select s.id, s.status, s.access_method, s.username, s.period_end::text, p.name as package_name,
            p.download_mbps, p.price_kes
     from services s
     join packages p on p.id = s.package_id
     where s.tenant_id = ${tenantId} and s.customer_id = ${customerId} and s.deleted_at is null
     order by s.created_at desc limit 1`;
  return row || null;
}

async function customerCpe(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{ id: string; status: string; serial: string }>`
    select id, status, serial from cpe_devices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
    order by last_inform desc nulls last limit 1`;
  return row || null;
}

function customerError(code: string) {
  if (code === "RADIUS_COA_NAK" || code === "COA_UNAVAILABLE") {
    return "I couldn't refresh your connection automatically. I can try restarting your router instead, or connect you to support.";
  }
  if (code === "NO_CPE") return "I couldn't find a router linked to this account, so I didn't change anything.";
  if (code === "NO_PPPOE") return "This account doesn't have a PPPoE service I can change.";
  if (code === "DISABLED") return "That action is turned off. I can connect you to support instead.";
  if (code === "RATE") return "That action was used recently. Please wait before trying again.";
  if (code === "LEVEL") return "I need to verify you by SMS before I can do that.";
  if (code === "NO_INVOICE") return "I couldn't find an unpaid invoice, so I didn't send a payment prompt. Nothing was charged.";
  if (code === "NO_PHONE") return "I couldn't send a payment prompt because this account has no M-Pesa number. Nothing was charged.";
  if (code === "NO_PROVIDER") return "I couldn't send a payment prompt. M-Pesa isn't set up yet. Nothing was charged.";
  if (code === "PROMPT_FAILED") return "I couldn't send a payment prompt. Nothing was charged.";
  return "I couldn't complete that automatically. I can connect you to support.";
}

async function withinOffice(settings: WaSettings) {
  const raw = settings.business_hours.trim();
  const match = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw);
  if (!match) return true;
  const now = new Date();
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 180;
  const local = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60);
  const start = Number(match[1]) * 60 + Number(match[2]);
  const end = Number(match[3]) * 60 + Number(match[4]);
  return local >= start && local <= end;
}

async function createAction(sql: Sql, input: {
  tenantId: string;
  customerId: string | null;
  conversationId: string;
  messageId: string;
  action: string;
  status: string;
  confirmTtlSec?: number;
}) {
  const id = nid("waact");
  const nonce = input.status === "AWAITING_CONFIRMATION" ? randomBytes(18).toString("base64url") : "";
  await sql`insert into whatsapp_action_requests
    (id, tenant_id, customer_id, conversation_id, message_id, action, parameters, verification_level, status, confirmation_nonce, confirmation_expires_at)
    values (${id}, ${input.tenantId}, ${input.customerId}, ${input.conversationId}, ${input.messageId}, ${input.action},
      '{}', 0, ${input.status}, ${nonce},
      ${input.confirmTtlSec ? new Date(Date.now() + input.confirmTtlSec * 1000).toISOString() : null})`;
  if (input.status === "AWAITING_CONFIRMATION") {
    await sql`update whatsapp_conversations set pending_action_id = ${id}, updated_at = now() where id = ${input.conversationId}`;
  }
  await audit(sql, input.tenantId, "CUSTOMER_ACTION_REQUESTED", id);
  return id;
}

async function rateOk(sql: Sql, tenantId: string, customerId: string, action: WaActionDef) {
  const [row] = await sql<{ n: number }>`select count(*)::int as n from whatsapp_action_requests
    where tenant_id = ${tenantId} and customer_id = ${customerId} and action = ${action.id}
      and status in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'AWAITING_CONFIRMATION')
      and requested_at > now() - interval '1 hour'`;
  return Number(row?.n || 0) < action.ratePerHour;
}

async function readReply(sql: Sql, tenantId: string, customerId: string, action: string) {
  const [customer] = await sql<{ name: string; status: string }>`select name, status from customers
    where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  if (!customer) return WA_UNVERIFIED;
  const service = await activeService(sql, tenantId, customerId);
  if (action === "CHECK_ACCOUNT" || action === "CHECK_SERVICE") {
    if (!service) return `${customer.name}, I couldn't find an active service on this account.`;
    const until = service.period_end ? service.period_end.slice(0, 10) : "not set";
    return `Your service is ${service.status}.\n\nPackage: ${service.package_name}\nSpeed: ${service.download_mbps} Mbps\nExpiry: ${until}`;
  }
  if (action === "CHECK_PAYMENT" || action === "CHECK_BALANCE") {
    const payments = await sql<{ amount_kes: number; status: string; reference: string; paid_at: string }>`
      select amount_kes, status, reference, paid_at::text from payments
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by paid_at desc limit 3`;
    if (!payments.length) return "I can't see a confirmed payment on this account yet. A message that you paid is not treated as proof.";
    const latest = payments[0];
    return `Latest payment on this account: Ksh ${latest.amount_kes} · ${latest.status}. Reference ${latest.reference}.`;
  }
  if (action === "GET_INVOICE" || action === "GET_STATEMENT") {
    const [invoice] = await sql<{ number: string; amount_kes: number; status: string }>`
      select number, amount_kes, status from invoices
      where tenant_id = ${tenantId} and customer_id = ${customerId}
      order by issued_at desc limit 1`;
    if (!invoice) return "I couldn't find an invoice on this account.";
    return `Latest invoice ${invoice.number}: Ksh ${invoice.amount_kes} · ${invoice.status}.`;
  }
  if (action === "CHECK_CONNECTION" || action === "RUN_CONNECTION_DIAGNOSTIC" || action === "CHECK_CPE_STATUS" || action === "RUN_CPE_DIAGNOSTIC") {
    if (!service) return "I couldn't find a service to check.";
    const [session] = service.username
      ? await sql<{ started_at: string }>`select started_at::text from radius_sessions
          where tenant_id = ${tenantId} and username = ${service.username} and stopped_at is null
          order by started_at desc limit 1`
      : [];
    const cpe = await customerCpe(sql, tenantId, customerId);
    const online = session ? `Online since ${session.started_at.slice(11, 16)}` : "No active session";
    const router = cpe ? `Router ${cpe.status}` : "No router linked";
    return `Your service is ${service.status}.\n\nPackage: ${service.package_name}\nStatus: ${online}\n${router}`;
  }
  return "I can check the account, payments, or connection.";
}

async function finishAction(sql: Sql, id: string, status: string, result: string, errorCode = "") {
  const terminal = status === "SUCCEEDED" || status === "FAILED" || status === "DENIED" || status === "EXPIRED" || status === "CANCELLED";
  await sql`update whatsapp_action_requests set status = ${status}, result_text = ${result.slice(0, 400)},
      error_code = ${errorCode}, completed_at = ${terminal ? new Date().toISOString() : null}, confirmation_nonce = ''
    where id = ${id}`;
  const [row] = await sql<{ tenant_id: string }>`select tenant_id from whatsapp_action_requests where id = ${id}`;
  if (row && terminal) {
    const auditName = status === "SUCCEEDED" ? "CUSTOMER_ACTION_SUCCEEDED" : status === "FAILED" ? "CUSTOMER_ACTION_FAILED" : "CUSTOMER_ACTION_DENIED";
    await audit(sql, row.tenant_id, auditName, id);
  }
}

export async function executeQueuedWhatsAppAction(sql: Sql, tenantId: string, actionId: string, opts?: { notify?: boolean }) {
  const [row] = await sql<ActionRow>`select id, action, parameters, status, confirmation_expires_at::text, customer_id, conversation_id
    from whatsapp_action_requests where id = ${actionId} and tenant_id = ${tenantId}`;
  if (!row || !row.customer_id) return { ok: false, detail: "missing", customerText: "" };
  if (row.status !== "QUEUED") return { ok: row.status === "SUCCEEDED" || row.status === "RUNNING", detail: row.status, customerText: "" };
  await sql`update whatsapp_action_requests set status = 'RUNNING', started_at = coalesce(started_at, now()) where id = ${row.id} and status = 'QUEUED'`;
  const settings = await getWhatsAppAgentSettings(sql, tenantId);
  if (!actionAllowed(settings, row.action)) {
    await finishAction(sql, row.id, "DENIED", "disabled", "DISABLED");
    return { ok: false, detail: "DISABLED", customerText: customerError("DISABLED") };
  }
  const result = await performExecutable(sql, tenantId, row.customer_id, row.action);
  await finishAction(sql, row.id, result.status === "QUEUED" ? "RUNNING" : result.status, result.publicText, result.errorCode);
  if (opts?.notify !== false) {
    const [convo] = await sql<{ phone_e164: string }>`select phone_e164 from whatsapp_conversations where id = ${row.conversation_id}`;
    if (convo) await deliverActionReply(sql, tenantId, convo.phone_e164, result.customerText, result.sensitive);
  }
  return { ok: result.status !== "FAILED", detail: result.errorCode || result.status, customerText: result.customerText };
}

async function performExecutable(sql: Sql, tenantId: string, customerId: string, action: string): Promise<{
  status: "SUCCEEDED" | "FAILED" | "QUEUED";
  customerText: string;
  publicText: string;
  errorCode: string;
  sensitive: boolean;
}> {
  const service = await activeService(sql, tenantId, customerId);
  if (action === "CREATE_TICKET" || action === "REQUEST_TECHNICIAN" || action === "RENEW_SERVICE" || action === "REQUEST_SERVICE_UPGRADE") {
    const title =
      action === "REQUEST_TECHNICIAN"
        ? "Technician requested from WhatsApp"
        : action === "RENEW_SERVICE"
          ? "Renewal requested from WhatsApp"
          : action === "REQUEST_SERVICE_UPGRADE"
            ? "Upgrade requested from WhatsApp"
            : "Support requested from WhatsApp";
    const ticket = await openTicket(sql, tenantId, {
      title,
      category: action === "REQUEST_TECHNICIAN" ? "field" : "support",
      priority: "normal",
      customer_id: customerId,
      service_id: service?.id || null,
    });
    const text =
      action === "RENEW_SERVICE" || action === "REQUEST_SERVICE_UPGRADE"
        ? `I recorded that request (${ticket.id}). It is not applied until staff confirm it.`
        : `I've opened a support request (${ticket.id}). A person can see this conversation.`;
    return { status: "SUCCEEDED", customerText: text, publicText: text, errorCode: "", sensitive: false };
  }
  if (action === "REFRESH_CONNECTION" || action === "DISCONNECT_SESSION" || action === "RECONNECT_SESSION") {
    return {
      status: "FAILED",
      customerText: customerError("COA_UNAVAILABLE"),
      publicText: "CoA not available",
      errorCode: "COA_UNAVAILABLE",
      sensitive: false,
    };
  }
  if (action === "REBOOT_CPE") {
    const cpe = await customerCpe(sql, tenantId, customerId);
    if (!cpe) return { status: "FAILED", customerText: customerError("NO_CPE"), publicText: "No CPE", errorCode: "NO_CPE", sensitive: false };
    try {
      const ran = await runAcsDeviceAction(sql, tenantId, cpe.id, "reboot", {}, { confirm: true, actor: { label: "whatsapp" } });
      if (!ran.nbi_accepted) {
        return { status: "FAILED", customerText: customerError("FAILED"), publicText: "ACS did not accept reboot", errorCode: "CPE_REJECTED", sensitive: false };
      }
      return {
        status: "QUEUED",
        customerText: "I've requested a router restart. I'll let you know when it completes.",
        publicText: "Reboot requested",
        errorCode: "",
        sensitive: false,
      };
    } catch {
      return { status: "FAILED", customerText: customerError("FAILED"), publicText: "Reboot failed", errorCode: "CPE_FAILED", sensitive: false };
    }
  }
  if (action === "CHANGE_PPPOE_PASSWORD" || action === "RESET_PPPOE_PASSWORD") {
    if (!service || service.access_method !== "pppoe") {
      return { status: "FAILED", customerText: customerError("NO_PPPOE"), publicText: "No PPPoE", errorCode: "NO_PPPOE", sensitive: false };
    }
    try {
      const rotated = await rotatePppoeCredentials(sql, tenantId, service.id);
      const password = String(rotated.password || "");
      const customerText = password
        ? `Your PPPoE username is ${rotated.username}. The new password is ${password}. It is not stored in the chat log.`
        : "I couldn't issue a new PPPoE password.";
      return {
        status: password ? "SUCCEEDED" : "FAILED",
        customerText,
        publicText: password ? "PPPoE password rotated" : "PPPoE rotate failed",
        errorCode: password ? "" : "PASSWORD_FAILED",
        sensitive: Boolean(password),
      };
    } catch {
      return { status: "FAILED", customerText: customerError("FAILED"), publicText: "Password change failed", errorCode: "PASSWORD_FAILED", sensitive: false };
    }
  }
  if (action === "CHANGE_WIFI_PASSWORD") {
    const cpe = await customerCpe(sql, tenantId, customerId);
    if (!cpe) return { status: "FAILED", customerText: customerError("NO_CPE"), publicText: "No CPE", errorCode: "NO_CPE", sensitive: false };
    return {
      status: "FAILED",
      customerText: "WiFi changes from WhatsApp stay off until this router confirms it supports them.",
      publicText: "WiFi change not confirmed",
      errorCode: "WIFI_UNSUPPORTED",
      sensitive: false,
    };
  }
  if (action === "PAY_INVOICE") return promptInvoicePayment(sql, tenantId, customerId);
  return { status: "FAILED", customerText: customerError("DISABLED"), publicText: "Unsupported", errorCode: "DENIED", sensitive: false };
}

async function accountPayPhone(sql: Sql, tenantId: string, customerId: string) {
  const [row] = await sql<{ phone: string }>`select phone from customers
    where id = ${customerId} and tenant_id = ${tenantId} and deleted_at is null`;
  const phone = (row?.phone || "").trim();
  return last9(phone).length >= 9 ? phone : "";
}

async function unpaidInvoice(sql: Sql, tenantId: string, customerId: string) {
  const [invoice] = await sql<{ id: string; number: string; amount_kes: number; paid_kes: number; status: string }>`
    select id, number, amount_kes, paid_kes, status from invoices
    where tenant_id = ${tenantId} and customer_id = ${customerId}
      and status in ('issued', 'due', 'overdue', 'partial')
    order by issued_at desc limit 1`;
  if (!invoice) return null;
  const remaining = remainingKes(Number(invoice.amount_kes), Number(invoice.paid_kes), invoice.status);
  if (remaining <= 0) return null;
  return { ...invoice, remaining };
}

async function readyStkProvider(sql: Sql, tenantId: string) {
  const { loadMpesa } = await import("./mpesa.ts");
  const mpesa = await loadMpesa(sql, tenantId);
  if (mpesa?.enabled && mpesa.client_id && mpesa.client_secret && mpesa.passkey && mpesa.till_number) return "mpesa" as const;
  const { loadKopo } = await import("./kopokopo.ts");
  const kopo = await loadKopo(sql, tenantId);
  if (kopo?.enabled && kopo.client_id && kopo.client_secret) return "kopokopo" as const;
  return "";
}

function maskedTail(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.slice(-4);
}

/** Local placeholders are `ws_` plus 12 hex chars. A live Daraja CheckoutRequestID is `ws_CO_...` and must be kept so the callback can credit the invoice. */
export function isSimulatedCheckout(checkoutId: string, note = "") {
  const id = checkoutId.trim();
  if (/^ws_CO_/i.test(id)) return false;
  if (!id || /^ws_[0-9a-f]{12}$/i.test(id)) return true;
  return /simulated|no keys/i.test(note);
}

async function promptInvoicePayment(sql: Sql, tenantId: string, customerId: string): Promise<{
  status: "SUCCEEDED" | "FAILED";
  customerText: string;
  publicText: string;
  errorCode: string;
  sensitive: boolean;
}> {
  const fail = (errorCode: string) => ({
    status: "FAILED" as const,
    customerText: customerError(errorCode),
    publicText: "Payment prompt not sent",
    errorCode,
    sensitive: false,
  });
  const phone = await accountPayPhone(sql, tenantId, customerId);
  if (!phone) return fail("NO_PHONE");
  const invoice = await unpaidInvoice(sql, tenantId, customerId);
  if (!invoice) return fail("NO_INVOICE");
  const provider = await readyStkProvider(sql, tenantId);
  if (!provider) return fail("NO_PROVIDER");
  const [pending] = await sql<{ checkout_id: string }>`select checkout_id from payment_intents
    where tenant_id = ${tenantId} and customer_id = ${customerId} and invoice_id = ${invoice.id}
      and status = 'pending' and checkout_id <> '' and checkout_id !~ '^ws_[0-9a-f]{12}$'
      and created_at > now() - interval '5 minutes'
    order by created_at desc limit 1`;
  if (pending) {
    const text = `A payment prompt for invoice ${invoice.number} is already on your phone. Enter your PIN there. This chat does not mark the invoice paid until M-Pesa confirms.`;
    return { status: "SUCCEEDED", customerText: text, publicText: "Payment prompt already pending", errorCode: "", sensitive: false };
  }
  try {
    const intent = await createStkIntent(sql, {
      tenantId,
      invoiceId: invoice.id,
      provider,
      phone,
      amountKes: invoice.remaining,
    });
    if (isSimulatedCheckout(intent.checkout_id, intent.note || "")) {
      await sql`delete from payment_intents where id = ${intent.id} and tenant_id = ${tenantId} and status = 'pending'`;
      return fail("NO_PROVIDER");
    }
    if (last9(intent.phone) !== last9(phone)) return fail("PROMPT_FAILED");
    const text = `I've sent a payment prompt for Ksh ${intent.amount_kes} on invoice ${invoice.number} to the number saved on this account, ending ${maskedTail(phone)}. Enter your PIN on the phone. This chat does not mark the invoice paid until M-Pesa confirms.`;
    return { status: "SUCCEEDED", customerText: text, publicText: "Payment prompt sent", errorCode: "", sensitive: false };
  } catch {
    return fail("PROMPT_FAILED");
  }
}

async function deliverActionReply(sql: Sql, tenantId: string, phone: string, text: string, sensitive: boolean) {
  const [session] = await sql<{ status: string }>`select status from whatsapp_web_sessions where tenant_id = ${tenantId}`;
  if (session?.status === "connected") {
    try {
      const link = await import("./whatsapp-link.ts");
      await link.sendWebText(tenantId, phone, text);
    } catch {
      /* socket may be down; fall through to Cloud API */
    }
  }
  const messaging = await getMessagingSettings(sql, tenantId);
  if (messaging.wa_phone_id && messaging.wa_access_token) await deliverWhatsapp(messaging, phone, sensitive ? "Your request was updated." : text);
  const convo = await loadConversation(sql, tenantId, normalizeWhatsAppPhone(phone));
  if (convo) {
    await insertMessage(sql, {
      tenantId,
      conversationId: convo.id,
      provider: "web",
      providerMessageId: `out-${nid("wout")}`,
      direction: "out",
      content: sensitive ? "Credentials were sent to the customer and are not stored." : text,
    });
  }
}

async function maybeAiIntent(tenantId: string, text: string, settings: WaSettings): Promise<WaIntent | null> {
  if (!settings.ai_enabled) return null;
  const key = (process.env.XAI_API_KEY || "").trim();
  if (!key) return null;
  const limited = rateLimit(`wa-ai:${tenantId}`, 20, 60 * 60_000);
  if (!limited.ok) return null;
  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "grok-4.5",
        max_tokens: 80,
        messages: [
          {
            role: "system",
            content:
              "You classify ISP customer WhatsApp messages. You cannot execute anything, reveal balances, or accept payment claims. Reply with JSON only: {\"intent\":\"MENU\"}. intent must be one of MENU, CLARIFY, " +
              ACTION_IDS.join(", ") +
              ". Do not include ids, passwords, or extra keys.",
          },
          { role: "user", content: text.slice(0, 500) },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseModelIntent(body.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}

export async function handleCustomerWhatsApp(
  sql: Sql,
  input: { tenantId: string; provider: "web" | "meta"; providerMessageId: string; from: string; text: string },
) {
  const phone = normalizeWhatsAppPhone(input.from);
  const settings = await getWhatsAppAgentSettings(sql, tenantIdSafe(input.tenantId));
  if (!phone) return { duplicate: false, replies: [WA_UNVERIFIED] };
  const convo = await touchConversation(sql, input.tenantId, phone);
  const stored = await insertMessage(sql, {
    tenantId: input.tenantId,
    conversationId: convo.id,
    provider: input.provider,
    providerMessageId: input.providerMessageId,
    direction: "in",
    content: input.text,
  });
  if (stored.duplicate) return { duplicate: true, replies: [] as string[] };
  const replies: string[] = [];
  const say = async (text: string, intent = "") => {
    replies.push(text);
    await insertMessage(sql, {
      tenantId: input.tenantId,
      conversationId: convo.id,
      provider: input.provider,
      providerMessageId: `out-${stored.id}-${replies.length}`,
      direction: "out",
      content: text,
      intent,
    });
  };

  if (!settings.enabled) {
    await say("WhatsApp self-service is not turned on for this ISP. Please contact support.");
    return { duplicate: false, replies };
  }
  if (convo.automation_paused) {
    await say("A support agent has this chat. You don't need to repeat your details.");
    return { duplicate: false, replies };
  }

  const text = input.text.trim();
  if (/^\d{6}$/.test(text)) {
    const checked = await verifyOtp(sql, input.tenantId, convo, text, settings);
    await say(checked.reply);
    if (checked.ok && checked.action && waAction(checked.action)) {
      const fresh = (await loadConversation(sql, input.tenantId, phone)) || convo;
      await routeAction(sql, input.tenantId, fresh, settings, checked.action, stored.id, say);
    }
    return { duplicate: false, replies };
  }

  if (convo.pending_action_id && (isYes(text) || isNo(text))) {
    const consumed = await consumeConfirmation(sql, input.tenantId, convo, isYes(text));
    await say(consumed.reply);
    return { duplicate: false, replies };
  }
  if (convo.pending_action_id && !isYes(text)) {
    await say("A confirmation is still waiting. Reply Yes to continue, No to cancel, or wait for it to expire. I won't extend the timer.");
  }

  let intent = classifyIntent(text);
  if (intent.intent === "CLARIFY") {
    const ai = await maybeAiIntent(input.tenantId, text, settings);
    if (ai) intent = ai;
  }
  if (intent.intent === "MENU" || intent.intent === "CLARIFY") {
    const [tenant] = await sql<{ support_phone: string }>`select support_phone from tenants where id = ${input.tenantId}`;
    const extra = intent.intent === "CLARIFY" ? "I didn't catch that.\n\n" : "";
    const phoneBit = tenant?.support_phone ? `\n\nSupport: ${tenant.support_phone}` : "";
    await say(`${extra}${WA_MENU}${phoneBit}`, intent.intent);
    return { duplicate: false, replies };
  }

  if (intent.intent === "CHECK_PAYMENT" && /paid|i paid|sent/i.test(text)) {
    await securityEvent(sql, input.tenantId, "payment_claim", phone, convo.customer_id || "", "claim");
  }

  const identified = await ensureIdentity(sql, input.tenantId, convo, phone);
  if (!identified.ok) {
    await say(identified.reply);
    return { duplicate: false, replies };
  }
  const fresh = (await loadConversation(sql, input.tenantId, phone)) || convo;
  await routeAction(sql, input.tenantId, fresh, settings, intent.intent, stored.id, say);
  return { duplicate: false, replies };
}

function tenantIdSafe(id: string) {
  return id;
}

async function ensureIdentity(sql: Sql, tenantId: string, convo: Conversation, phone: string) {
  if (convo.customer_id) return { ok: true as const, reply: "" };
  const tries = await countSince(sql, tenantId, phone, "identify", 3600);
  if (tries >= IDENTIFY_PER_HOUR) {
    await securityEvent(sql, tenantId, "identify_limited", phone);
    return { ok: false as const, reply: WA_UNVERIFIED };
  }
  await securityEvent(sql, tenantId, "identify", phone);
  const found = await findCustomer(sql, tenantId, phone);
  if (found.status !== "one" || !found.customer) {
    await audit(sql, tenantId, "WHATSAPP_IDENTIFICATION_FAILED", convo.id);
    return { ok: false as const, reply: WA_UNVERIFIED };
  }
  await sql`update whatsapp_conversations set customer_id = ${found.customer.id}, verification_level = 1, updated_at = now()
    where id = ${convo.id} and tenant_id = ${tenantId}`;
  await audit(sql, tenantId, "WHATSAPP_CUSTOMER_IDENTIFIED", found.customer.id);
  const touched = await sql<{ n: number }>`select count(distinct customer_id)::int as n from whatsapp_security_events
    where tenant_id = ${tenantId} and phone_e164 = ${phone} and customer_id <> '' and created_at > now() - interval '24 hours'`;
  if (Number(touched[0]?.n || 0) >= 3) await securityEvent(sql, tenantId, "cross_account", phone, found.customer.id);
  return { ok: true as const, reply: "" };
}

async function routeAction(
  sql: Sql,
  tenantId: string,
  convo: Conversation,
  settings: WaSettings,
  intent: string,
  messageId: string,
  say: (text: string, intent?: string) => Promise<void>,
) {
  const action = waAction(intent);
  if (!action || !actionAllowed(settings, action.id)) {
    await audit(sql, tenantId, "CUSTOMER_ACTION_DENIED", convo.id);
    await say(customerError("DISABLED"), intent);
    return;
  }
  if (!convo.customer_id) {
    await say(WA_UNVERIFIED);
    return;
  }
  const level = levelOf(convo);
  if (level < action.level) {
    if (convo.level2_blocked_until && new Date(convo.level2_blocked_until).getTime() > Date.now()) {
      await say(WA_OTP_LOCKED);
      return;
    }
    const otp = await issueOtp(sql, tenantId, convo, action.id, settings);
    await say(otp.reply, "OTP");
    return;
  }
  if (!(await withinOffice(settings)) && action.executable) {
    await say("The office is closed for live changes. I can still check your account, or open a support request.");
    return;
  }
  if (!(await rateOk(sql, tenantId, convo.customer_id, action))) {
    await say(customerError("RATE"));
    return;
  }
  if (action.confirm) {
    let detail = "";
    if (action.id === "PAY_INVOICE") {
      const invoice = await unpaidInvoice(sql, tenantId, convo.customer_id);
      const phone = await accountPayPhone(sql, tenantId, convo.customer_id);
      if (!invoice) {
        await say(customerError("NO_INVOICE"));
        return;
      }
      if (!phone) {
        await say(customerError("NO_PHONE"));
        return;
      }
      detail = ` This sends an M-Pesa prompt for Ksh ${invoice.remaining} on invoice ${invoice.number} to the number saved on this account, ending ${maskedTail(phone)}. It does not mark the invoice paid.`;
    }
    await createAction(sql, {
      tenantId,
      customerId: convo.customer_id,
      conversationId: convo.id,
      messageId,
      action: action.id,
      status: "AWAITING_CONFIRMATION",
      confirmTtlSec: action.confirmTtlSec,
    });
    const detailSuffix = detail;
    await say(`Please confirm ${action.name}.${detailSuffix} Reply Yes within ${Math.round(action.confirmTtlSec / 60)} minutes. Reply No to cancel.`, action.id);
    return;
  }
  if (!action.executable) {
    const id = await createAction(sql, {
      tenantId,
      customerId: convo.customer_id,
      conversationId: convo.id,
      messageId,
      action: action.id,
      status: "RUNNING",
    });
    const text = await readReply(sql, tenantId, convo.customer_id, action.id);
    await finishAction(sql, id, "SUCCEEDED", text.slice(0, 180));
    await say(text, action.id);
    return;
  }
  const id = await createAction(sql, {
    tenantId,
    customerId: convo.customer_id,
    conversationId: convo.id,
    messageId,
    action: action.id,
    status: "QUEUED",
  });
  await enqueueJob(sql, {
    queue: "notifications",
    kind: "whatsapp.action",
    tenantId,
    payload: { actionId: id },
    idempotencyKey: `wa-action:${id}`,
    maxAttempts: 1,
  });
  const ran = await executeQueuedWhatsAppAction(sql, tenantId, id, { notify: false });
  await say(ran.customerText || "I've requested that. I'll let you know when it completes.", action.id);
}

async function consumeConfirmation(sql: Sql, tenantId: string, convo: Conversation, accept: boolean) {
  const [row] = await sql<ActionRow>`select id, action, parameters, status, confirmation_expires_at::text, customer_id, conversation_id
    from whatsapp_action_requests where id = ${convo.pending_action_id} and tenant_id = ${tenantId}`;
  if (!row || row.status !== "AWAITING_CONFIRMATION") {
    await sql`update whatsapp_conversations set pending_action_id = null where id = ${convo.id}`;
    return { reply: "That confirmation is no longer active. Please start again." };
  }
  if (!row.confirmation_expires_at || new Date(row.confirmation_expires_at).getTime() <= Date.now()) {
    await sql`update whatsapp_action_requests set status = 'EXPIRED', confirmation_nonce = '', completed_at = now() where id = ${row.id} and status = 'AWAITING_CONFIRMATION'`;
    await sql`update whatsapp_conversations set pending_action_id = null where id = ${convo.id}`;
    await audit(sql, tenantId, "CUSTOMER_ACTION_EXPIRED", row.id);
    return { reply: "That confirmation expired. Please start the request again." };
  }
  if (!accept) {
    await sql`update whatsapp_action_requests set status = 'CANCELLED', confirmation_nonce = '', completed_at = now()
      where id = ${row.id} and status = 'AWAITING_CONFIRMATION'`;
    await sql`update whatsapp_conversations set pending_action_id = null where id = ${convo.id}`;
    await audit(sql, tenantId, "CUSTOMER_ACTION_CANCELLED", row.id);
    return { reply: "Cancelled. Nothing was changed." };
  }
  const [updated] = await sql<{ id: string }>`update whatsapp_action_requests
    set status = 'QUEUED', confirmed_at = now(), confirmation_nonce = ''
    where id = ${row.id} and tenant_id = ${tenantId} and status = 'AWAITING_CONFIRMATION' and confirmation_expires_at > now()
    returning id`;
  if (!updated) return { reply: "That confirmation was already used. Nothing else will run." };
  await sql`update whatsapp_conversations set pending_action_id = null where id = ${convo.id}`;
  await audit(sql, tenantId, "CUSTOMER_ACTION_CONFIRMED", row.id);
  await enqueueJob(sql, {
    queue: "notifications",
    kind: "whatsapp.action",
    tenantId,
    payload: { actionId: row.id },
    idempotencyKey: `wa-action:${row.id}`,
    maxAttempts: 1,
  });
  const ran = await executeQueuedWhatsAppAction(sql, tenantId, row.id, { notify: false });
  return { reply: ran.customerText || "I've requested that. I'll let you know when it completes." };
}

export async function listWhatsAppConversations(sql: Sql, tenantId: string) {
  return sql<{ id: string; phone_e164: string; customer_id: string | null; customer_name: string; automation_paused: boolean; last_message_at: string }>`
    select c.id, c.phone_e164, c.customer_id, coalesce(cu.name, '') as customer_name, c.automation_paused, c.last_message_at::text
    from whatsapp_conversations c
    left join customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
    where c.tenant_id = ${tenantId}
    order by c.last_message_at desc limit 20`;
}

export async function setWhatsAppHandoff(sql: Sql, tenantId: string, conversationId: string, paused: boolean) {
  await sql`update whatsapp_conversations set automation_paused = ${paused}, updated_at = now()
    where id = ${conversationId} and tenant_id = ${tenantId}`;
}

export function publicWhatsAppActions(settings: WaSettings) {
  return WA_ACTIONS.map((action) => ({
    id: action.id,
    name: action.name,
    level: action.level,
    executable: action.executable,
    enabled: settings.actions[action.id] === true || (settings.actions[action.id] !== false && actionAllowed({ ...settings, enabled: true }, action.id)),
  }));
}

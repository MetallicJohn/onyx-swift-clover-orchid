/** SMS gateway schemas and request builders. No credential guessing. Bytewave stays listed without invented fields. */

export const SMS_GATEWAY_SAVE_OK = "SMS gateway settings saved successfully.";
export const SMS_GATEWAY_SAVE_FAIL = "Unable to save SMS gateway settings.";
export const SMS_TEST_OK = "SMS gateway connection successful.";
export const SMS_TEST_FAIL = "Connection failed. Please verify the gateway configuration.";
export const SMS_TEST_BUSY = "Testing connection...";
export const SMS_SEND_OK = "Test SMS sent successfully.";
export const SMS_SEND_FAIL = "Unable to send the test SMS.";

export const NEW_SMS_GATEWAYS = [
  { id: "hostpinnacle", label: "HostPinnacle" },
  { id: "texin", label: "Texin" },
  { id: "mobilesasa", label: "Mobile Sasa" },
  { id: "bytewave", label: "Bytewave" },
  { id: "celcomafrica", label: "Celcom Africa" },
  { id: "afrokatt", label: "Afrokatt" },
  { id: "textsms", label: "TextSMS" },
] as const;

export const EXISTING_SMS_GATEWAYS = [
  { id: "africastalking", label: "Africa's Talking" },
  { id: "talksasa", label: "Talksasa" },
  { id: "blessedtexts", label: "Blessed Texts" },
  { id: "webfam", label: "Webfam SMS" },
  { id: "advanta", label: "Advanta SMS" },
  { id: "twilio", label: "Twilio" },
] as const;

export const SMS_GATEWAYS = [...NEW_SMS_GATEWAYS, ...EXISTING_SMS_GATEWAYS] as const;

export type SmsGatewayId = (typeof SMS_GATEWAYS)[number]["id"];

export type SmsGatewayConfig = {
  auth: "apikey" | "password";
  apiKey: string;
  token: string;
  password: string;
  userId: string;
  partnerId: string;
  senderId: string;
  messageType: string;
};

export type SmsFieldKey = "apiKey" | "token" | "password" | "userId" | "partnerId" | "senderId" | "messageType";

export type SmsField = {
  key: SmsFieldKey;
  label: string;
  secret?: boolean;
  required?: boolean;
  hint?: string;
  options?: { value: string; label: string }[];
};

export const EMPTY_SMS_GATEWAY: SmsGatewayConfig = {
  auth: "apikey",
  apiKey: "",
  token: "",
  password: "",
  userId: "",
  partnerId: "",
  senderId: "",
  messageType: "",
};

const SECRET_KEYS = ["apiKey", "token", "password"] as const;

export function isSmsGatewayId(value: string): value is SmsGatewayId {
  return SMS_GATEWAYS.some((gateway) => gateway.id === value);
}

export function smsGatewayLabel(id: string) {
  return SMS_GATEWAYS.find((gateway) => gateway.id === id)?.label || id;
}

export function emptyGateway(id: SmsGatewayId): SmsGatewayConfig {
  return {
    ...EMPTY_SMS_GATEWAY,
    messageType: id === "afrokatt" ? "plain" : id === "hostpinnacle" ? "text" : "",
  };
}

export function smsGatewayFields(id: SmsGatewayId, config: SmsGatewayConfig): SmsField[] {
  if (id === "bytewave") return [];
  if (id === "hostpinnacle") {
    const authFields: SmsField[] =
      config.auth === "password"
        ? [
            { key: "userId", label: "User ID", required: true },
            { key: "password", label: "Password", secret: true, required: true, hint: "Leave blank to keep the saved password." },
          ]
        : [{ key: "apiKey", label: "API Key", secret: true, required: true, hint: "Leave blank to keep the saved API key." }];
    return [
      ...authFields,
      { key: "senderId", label: "Default Sender ID", required: true },
      {
        key: "messageType",
        label: "Message Type",
        options: [
          { value: "text", label: "Text" },
          { value: "unicode", label: "Unicode" },
        ],
      },
    ];
  }
  if (id === "texin") {
    return [
      { key: "apiKey", label: "API Key", secret: true, required: true, hint: "Leave blank to keep the saved API key." },
      { key: "senderId", label: "Default Sender ID", hint: "Optional. Texin uses the sender configured on the account when this is empty." },
    ];
  }
  if (id === "mobilesasa") {
    return [
      { key: "token", label: "API Token", secret: true, required: true, hint: "Bearer token. Leave blank to keep the saved token." },
      { key: "senderId", label: "Default Sender ID", required: true },
    ];
  }
  if (id === "celcomafrica" || id === "textsms" || id === "blessedtexts" || id === "advanta") {
    return [
      { key: "apiKey", label: "API Key", secret: true, required: true, hint: "Leave blank to keep the saved API key." },
      { key: "partnerId", label: "Partner ID", required: true },
      { key: "senderId", label: "Default Sender ID / Shortcode", required: true },
    ];
  }
  if (id === "afrokatt") {
    return [
      { key: "token", label: "API Token", secret: true, required: true, hint: "Leave blank to keep the saved token." },
      { key: "senderId", label: "Default Sender ID", required: true },
      {
        key: "messageType",
        label: "Message Type",
        options: [
          { value: "plain", label: "Plain" },
          { value: "unicode", label: "Unicode" },
        ],
      },
    ];
  }
  if (id === "talksasa") {
    return [
      { key: "token", label: "API Token", secret: true, required: true, hint: "Leave blank to keep the saved token. Sender ID max 11 characters." },
      { key: "senderId", label: "Default Sender ID", hint: "Optional. Maximum 11 characters." },
    ];
  }
  if (id === "webfam") {
    return [
      { key: "token", label: "API key", secret: true, required: true, hint: "Bearer key (WFK-…). Leave blank to keep the saved key." },
      { key: "senderId", label: "Default Sender ID", hint: "Optional approved sender." },
    ];
  }
  if (id === "twilio") {
    return [
      { key: "userId", label: "Account SID", required: true },
      { key: "apiKey", label: "Auth token", secret: true, required: true, hint: "Leave blank to keep the saved token." },
      { key: "senderId", label: "From number", required: true },
    ];
  }
  return [
    { key: "userId", label: "Username", required: true },
    { key: "apiKey", label: "API Key", secret: true, required: true, hint: "Leave blank to keep the saved API key." },
    { key: "senderId", label: "Default Sender ID", hint: "Optional approved sender." },
  ];
}

export function smsGatewayNote(id: SmsGatewayId) {
  if (id === "bytewave") {
    return "Bytewave Bulk SMS is available as a gateway, but its public API credential contract is not documented. No credential fields are shown until that contract is verified.";
  }
  if (id === "hostpinnacle") return "Configure your HostPinnacle account. Choose one authentication method.";
  if (id === "texin") return "Configure your Texin account. The API key is sent only to Texin.";
  if (id === "mobilesasa") return "Configure your Mobile Sasa account. The token is sent as a bearer credential.";
  if (id === "celcomafrica") return "Configure your Celcom Africa account.";
  if (id === "afrokatt") return "Configure your Afrokatt account.";
  if (id === "textsms") return "Configure your TextSMS account.";
  return `Configure ${smsGatewayLabel(id)} for this ISP.`;
}

function secretValue(config: SmsGatewayConfig, key: (typeof SECRET_KEYS)[number]) {
  return config[key].trim();
}

export function gatewayConfigured(id: SmsGatewayId, config: SmsGatewayConfig) {
  if (id === "bytewave") return false;
  if (id === "hostpinnacle") {
    if (!config.senderId.trim()) return false;
    return config.auth === "password" ? Boolean(config.userId.trim() && secretValue(config, "password")) : Boolean(secretValue(config, "apiKey"));
  }
  return smsGatewayFields(id, config)
    .filter((field) => field.required)
    .every((field) => {
      if (field.secret) return Boolean(secretValue(config, field.key as (typeof SECRET_KEYS)[number]));
      return Boolean(String(config[field.key] || "").trim());
    });
}

export function validateGateway(id: SmsGatewayId, config: SmsGatewayConfig) {
  if (!isSmsGatewayId(id)) throw new Error("Unknown SMS gateway");
  if (id === "bytewave") throw new Error("Bytewave cannot be saved until its API contract is verified.");
  if (id === "talksasa" && config.senderId.trim().length > 11) throw new Error("Talksasa sender ID must be 11 characters or fewer.");
  if (!gatewayConfigured(id, config)) throw new Error("Enter the required fields for this gateway.");
}

export function normalizeGateway(raw: Partial<SmsGatewayConfig> | null | undefined, id: SmsGatewayId = "africastalking"): SmsGatewayConfig {
  const base = emptyGateway(id);
  if (!raw) return base;
  const auth = raw.auth === "password" ? "password" : "apikey";
  return {
    auth,
    apiKey: String(raw.apiKey || ""),
    token: String(raw.token || ""),
    password: String(raw.password || ""),
    userId: String(raw.userId || ""),
    partnerId: String(raw.partnerId || ""),
    senderId: String(raw.senderId || ""),
    messageType: String(raw.messageType || base.messageType),
  };
}

export function parseGatewayStore(raw: string): Partial<Record<SmsGatewayId, SmsGatewayConfig>> {
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<SmsGatewayConfig>>;
    const out: Partial<Record<SmsGatewayId, SmsGatewayConfig>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isSmsGatewayId(key) || !value || typeof value !== "object") continue;
      out[key] = normalizeGateway(value, key);
    }
    return out;
  } catch {
    return {};
  }
}

/** Keep a saved secret when the form submits a blank or masked value. */
export function mergeGatewayConfig(previous: SmsGatewayConfig, incoming: SmsGatewayConfig, id: SmsGatewayId): SmsGatewayConfig {
  const next = normalizeGateway(incoming, id);
  for (const key of SECRET_KEYS) {
    const value = next[key].trim();
    if (!value || value.startsWith("••••")) next[key] = previous[key];
  }
  return next;
}

export function mergeGatewayStore(
  store: Partial<Record<SmsGatewayId, SmsGatewayConfig>>,
  id: SmsGatewayId,
  incoming: SmsGatewayConfig,
) {
  const previous = store[id] || emptyGateway(id);
  return { ...store, [id]: mergeGatewayConfig(previous, incoming, id) };
}

function hint(secret: string) {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export type PublicSmsGateway = {
  id: SmsGatewayId;
  senderId: string;
  partnerId: string;
  userId: string;
  auth: "apikey" | "password";
  messageType: string;
  apiKeySet: boolean;
  tokenSet: boolean;
  passwordSet: boolean;
  apiKeyHint: string;
  tokenHint: string;
  passwordHint: string;
  configured: boolean;
};

export function toPublicGateway(id: SmsGatewayId, config: SmsGatewayConfig): PublicSmsGateway {
  return {
    id,
    senderId: config.senderId,
    partnerId: config.partnerId,
    userId: config.userId,
    auth: config.auth,
    messageType: config.messageType,
    apiKeySet: Boolean(config.apiKey),
    tokenSet: Boolean(config.token),
    passwordSet: Boolean(config.password),
    apiKeyHint: hint(config.apiKey),
    tokenHint: hint(config.token),
    passwordHint: hint(config.password),
    configured: gatewayConfigured(id, config),
  };
}

export type SmsHttpRequest = {
  url: string;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Record<string, string>;
  form?: boolean;
};

export type SmsSendInput = { mobile: string; to: string; message: string };

function jsonPost(url: string, body: Record<string, string>, headers: Record<string, string> = {}): SmsHttpRequest {
  return { url, method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json", ...headers }, body };
}

export function buildSmsRequest(id: SmsGatewayId, config: SmsGatewayConfig, input: SmsSendInput): SmsHttpRequest {
  validateGateway(id, config);
  const message = input.message;
  const mobile = input.mobile;
  if (id === "hostpinnacle") {
    const body: Record<string, string> =
      config.auth === "password"
        ? { userid: config.userId.trim(), password: config.password, mobile, msg: message, senderid: config.senderId.trim(), msgType: config.messageType || "text", output: "json" }
        : { apikey: config.apiKey, mobile, msg: message, senderid: config.senderId.trim(), msgType: config.messageType || "text", output: "json" };
    return { url: "https://smsportal.hostpinnacle.co.ke/SMSApi/send", method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, form: true };
  }
  if (id === "texin") {
    const body: Record<string, string> = { api_key: config.apiKey, recipient: mobile, message };
    if (config.senderId.trim()) body.sender_id = config.senderId.trim();
    return jsonPost("https://sms.texin.co.ke/api/send_sms", body);
  }
  if (id === "mobilesasa") {
    return jsonPost(
      "https://api.mobilesasa.com/v1/send/message",
      { senderID: config.senderId.trim(), phone: mobile, message },
      { Authorization: `Bearer ${config.token}` },
    );
  }
  if (id === "advanta") {
    return jsonPost(
      "https://api.advantasms.com/v1/send",
      {
        partnerID: config.partnerId.trim(),
        shortcode: config.senderId.trim(),
        mobile,
        message,
      },
      { "X-Api-Key": config.apiKey },
    );
  }
  if (id === "celcomafrica" || id === "textsms" || id === "blessedtexts") {
    const host =
      id === "celcomafrica"
        ? "https://isms.celcomafrica.com/api/services/sendsms/"
        : id === "textsms"
          ? "https://sms.textsms.co.ke/api/services/sendsms/"
          : "https://sms.blessedtexts.com/api/services/sendsms/";
    return jsonPost(host, {
      partnerID: config.partnerId.trim(),
      apikey: config.apiKey,
      mobile,
      message,
      shortcode: config.senderId.trim(),
    });
  }
  if (id === "afrokatt") {
    return jsonPost("https://portal.afrokatt.com/api/http/sms/send", {
      api_token: config.token,
      recipient: mobile,
      sender_id: config.senderId.trim(),
      type: config.messageType || "plain",
      message,
    });
  }
  if (id === "talksasa") {
    return jsonPost(
      "https://bulksms.talksasa.com/api/v3/sms/send",
      { recipient: input.to, sender_id: config.senderId.trim(), type: "plain", message },
      { Authorization: `Bearer ${config.token}` },
    );
  }
  if (id === "webfam") {
    const body: Record<string, string> = { to: mobile, message };
    if (config.senderId.trim()) body.sender_id = config.senderId.trim();
    return jsonPost("https://sms.webfam.co.ke/api/v1/sms/send", body, { Authorization: `Bearer ${config.token}` });
  }
  if (id === "twilio") {
    return {
      url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(config.userId.trim())}/Messages.json`,
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${config.userId.trim()}:${config.apiKey}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: { To: input.to, From: config.senderId.trim(), Body: message },
      form: true,
    };
  }
  const body = new URLSearchParams({ username: config.userId.trim(), to: input.to, message });
  if (config.senderId.trim()) body.set("from", config.senderId.trim());
  return {
    url: "https://api.africastalking.com/version1/messaging",
    method: "POST",
    headers: { apiKey: config.apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: Object.fromEntries(body.entries()),
    form: true,
  };
}

export function buildSmsProbe(id: SmsGatewayId, config: SmsGatewayConfig): SmsHttpRequest | null {
  validateGateway(id, config);
  if (id === "texin") return jsonPost("https://sms.texin.co.ke/api/get_balance", { api_key: config.apiKey });
  if (id === "mobilesasa") {
    return { url: "https://api.mobilesasa.com/v1/get-balance", method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${config.token}` } };
  }
  if (id === "celcomafrica") return jsonPost("https://isms.celcomafrica.com/api/services/getbalance/", { partnerID: config.partnerId.trim(), apikey: config.apiKey });
  if (id === "textsms") return jsonPost("https://sms.textsms.co.ke/api/services/getbalance/", { partnerID: config.partnerId.trim(), apikey: config.apiKey });
  if (id === "afrokatt") return jsonPost("https://portal.afrokatt.com/api/http/balance", { api_token: config.token });
  if (id === "hostpinnacle") {
    const body: Record<string, string> =
      config.auth === "password"
        ? { userid: config.userId.trim(), password: config.password, output: "json" }
        : { apikey: config.apiKey, output: "json" };
    return { url: "https://smsportal.hostpinnacle.co.ke/SMSApi/account/readstatus", method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body, form: true };
  }
  if (id === "webfam") {
    return { url: "https://sms.webfam.co.ke/api/v1/account/balance", method: "GET", headers: { Accept: "application/json", Authorization: `Bearer ${config.token}` } };
  }
  return null;
}

export function projectGateway(id: SmsGatewayId, config: SmsGatewayConfig) {
  if (id === "hostpinnacle" && config.auth === "password") {
    return { sms_api_key: config.password, sms_username: config.userId.trim(), sms_sender_id: config.senderId.trim() };
  }
  if (id === "mobilesasa" || id === "afrokatt" || id === "talksasa" || id === "webfam") {
    return { sms_api_key: config.token, sms_username: "", sms_sender_id: config.senderId.trim() };
  }
  if (id === "celcomafrica" || id === "textsms" || id === "blessedtexts" || id === "advanta") {
    return { sms_api_key: config.apiKey, sms_username: config.partnerId.trim(), sms_sender_id: config.senderId.trim() };
  }
  if (id === "twilio" || id === "africastalking") {
    return { sms_api_key: config.apiKey, sms_username: config.userId.trim(), sms_sender_id: config.senderId.trim() };
  }
  return { sms_api_key: config.apiKey, sms_username: config.userId.trim() || config.partnerId.trim(), sms_sender_id: config.senderId.trim() };
}

export function configFromFlat(id: SmsGatewayId, flat: { sms_api_key: string; sms_username: string; sms_sender_id: string }): SmsGatewayConfig {
  const config = emptyGateway(id);
  config.senderId = flat.sms_sender_id || "";
  config.userId = flat.sms_username || "";
  config.partnerId = flat.sms_username || "";
  if (id === "mobilesasa" || id === "afrokatt" || id === "talksasa" || id === "webfam") config.token = flat.sms_api_key || "";
  else if (id === "hostpinnacle") config.apiKey = flat.sms_api_key || "";
  else config.apiKey = flat.sms_api_key || "";
  return config;
}

export function scrubSecrets(text: string, secrets: string[]) {
  let out = text;
  for (const secret of secrets) {
    const value = secret.trim();
    if (value.length >= 4) out = out.split(value).join("••••");
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function responseSummary(provider: string, status: number, text: string) {
  const label = smsGatewayLabel(provider);
  let messageId = "";
  try {
    const json = JSON.parse(text) as Record<string, unknown>;
    const nested = json.response && typeof json.response === "object" ? (json.response as Record<string, unknown>) : json;
    const id = nested.messageid || nested.message_id || nested.messageId || json.messageid;
    if (typeof id === "string" || typeof id === "number") messageId = String(id);
    const responses = json.responses;
    if (!messageId && Array.isArray(responses) && responses[0] && typeof responses[0] === "object") {
      const row = responses[0] as Record<string, unknown>;
      if (row.messageid) messageId = String(row.messageid);
    }
  } catch {
    /* non-json provider body */
  }
  const idBit = messageId ? ` · id ${messageId}` : "";
  return `${label} ${status}${idBit}`.slice(0, 180);
}

export async function executeSmsRequest(request: SmsHttpRequest) {
  const headers = { ...request.headers };
  let body: string | undefined;
  if (request.body) {
    body = request.form ? new URLSearchParams(request.body).toString() : JSON.stringify(request.body);
  }
  const res = await fetch(request.url, { method: request.method, headers, body });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

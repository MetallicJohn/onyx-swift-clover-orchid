import { open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type LiveSession = {
  status: "disconnected" | "qr" | "connecting" | "connected";
  qr: string;
  phone: string;
  error: string;
  gen: number;
  reconnects: number;
  intentional: boolean;
  send: ((jid: string, text: string) => Promise<void>) | null;
  close: (() => void) | null;
};

const live = new Map<string, LiveSession>();
const reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
let epoch = 0;
const MAX_RECONNECTS = 6;

function session(tenantId: string): LiveSession {
  const existing = live.get(tenantId);
  if (existing) return existing;
  const created: LiveSession = {
    status: "disconnected",
    qr: "",
    phone: "",
    error: "",
    gen: 0,
    reconnects: 0,
    intentional: false,
    send: null,
    close: null,
  };
  live.set(tenantId, created);
  return created;
}

/** 515 after a scan is a required restart, not a failed link. 401/403/500 drop the saved login. */
export function linkCloseAction(code: number | undefined): "logout" | "replaced" | "reconnect" {
  if (code === 401 || code === 403 || code === 411 || code === 500) return "logout";
  if (code === 440) return "replaced";
  return "reconnect";
}

type InboundKey = {
  fromMe?: boolean | null;
  id?: string | null;
  remoteJid?: string | null;
  remoteJidAlt?: string | null;
};

function nestedMessage(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const message = (value as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  return message as Record<string, unknown>;
}

function unwrapContent(message: Record<string, unknown> | null | undefined) {
  let current = message;
  for (let i = 0; i < 6 && current; i += 1) {
    const next =
      nestedMessage(current.ephemeralMessage) ||
      nestedMessage(current.viewOnceMessage) ||
      nestedMessage(current.viewOnceMessageV2) ||
      nestedMessage(current.documentWithCaptionMessage) ||
      nestedMessage(current.editedMessage) ||
      nestedMessage(current.deviceSentMessage);
    if (!next) break;
    current = next;
  }
  return current;
}

function fieldText(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const text = (value as Record<string, unknown>)[key];
  return typeof text === "string" ? text : "";
}

export function webMessageText(message: Record<string, unknown> | null | undefined) {
  const content = unwrapContent(message);
  const text =
    (typeof content?.conversation === "string" ? content.conversation : "") ||
    fieldText(content?.extendedTextMessage, "text") ||
    fieldText(content?.imageMessage, "caption") ||
    fieldText(content?.videoMessage, "caption") ||
    fieldText(content?.documentMessage, "caption") ||
    fieldText(content?.buttonsResponseMessage, "selectedDisplayText") ||
    fieldText(content?.listResponseMessage, "title") ||
    fieldText(content?.templateButtonReplyMessage, "selectedDisplayText");
  return text.trim();
}

/** Phone identity is the @s.whatsapp.net jid. A @lid alone is not a customer number. */
export function phoneJidFromKey(key: InboundKey) {
  const remote = key.remoteJid || "";
  const alt = key.remoteJidAlt || "";
  if (remote.endsWith("@g.us") || remote === "status@broadcast") return "";
  if (remote.endsWith("@s.whatsapp.net")) return remote;
  if (alt.endsWith("@s.whatsapp.net")) return alt;
  return "";
}

export function shouldHandleUpsert(type: string | undefined, key: InboundKey) {
  if (key.fromMe) return false;
  if (type && type !== "notify") return false;
  const remote = key.remoteJid || "";
  if (!remote || remote.endsWith("@g.us") || remote === "status@broadcast") return false;
  return remote.endsWith("@s.whatsapp.net") || remote.endsWith("@lid") || (key.remoteJidAlt || "").endsWith("@s.whatsapp.net");
}

async function tenantSql<T>(tenantId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const { withDbSession } = await import("../db-session.ts");
  const { getSql } = await import("../db.ts");
  const { applyRls } = await import("./rls.ts");
  return withDbSession(async () => {
    const sql = await getSql();
    await applyRls(sql, { tenantId, bypass: false });
    return fn(sql);
  });
}

async function persist(sql: Sql, tenantId: string, patch: Partial<{ status: string; phone: string; qr: string; error: string }>) {
  const current = session(tenantId);
  const status = patch.status || current.status;
  const phone = patch.phone ?? current.phone;
  const qr = patch.qr ?? current.qr;
  const error = patch.error ?? current.error;
  await sql`insert into whatsapp_web_sessions (tenant_id, status, phone_e164, qr_text, last_error, updated_at)
    values (${tenantId}, ${status}, ${phone}, ${qr}, ${error.slice(0, 180)}, now())
    on conflict (tenant_id) do update set
      status = excluded.status,
      phone_e164 = excluded.phone_e164,
      qr_text = excluded.qr_text,
      last_error = excluded.last_error,
      updated_at = now()`;
}

export async function whatsAppLinkStatus(sql: Sql, tenantId: string) {
  const memory = live.get(tenantId);
  const [row] = await sql<{ status: string; phone_e164: string; qr_text: string; last_error: string; linked: boolean }>`
    select status, phone_e164, qr_text, last_error, (auth_sealed <> '') as linked from whatsapp_web_sessions where tenant_id = ${tenantId}`;
  if (!memory && row?.linked && row.status === "connected") {
    void startWebLink(sql, tenantId, { reconnect: true }).catch(() => undefined);
    return { status: "connecting", phone: row.phone_e164 || "", qrDataUrl: "", error: "" };
  }
  const status = memory?.status && memory.status !== "disconnected" ? memory.status : row?.status || "disconnected";
  const qr = memory?.qr || row?.qr_text || "";
  let qrDataUrl = "";
  if (status === "qr" && qr) {
    const qrcode = await import("qrcode");
    qrDataUrl = await qrcode.toDataURL(qr, { margin: 1, width: 280 });
  }
  return {
    status,
    phone: memory?.phone || row?.phone_e164 || "",
    qrDataUrl,
    error: memory?.error || (status === "connected" || status === "connecting" || status === "qr" ? "" : row?.last_error || ""),
  };
}

function clearReconnect(tenantId: string) {
  const timer = reconnectTimers.get(tenantId);
  if (timer) clearTimeout(timer);
  reconnectTimers.delete(tenantId);
}

function scheduleReconnect(sql: Sql, tenantId: string) {
  const current = live.get(tenantId);
  if (!current || current.intentional) return;
  if (current.reconnects >= MAX_RECONNECTS) {
    current.status = "disconnected";
    current.qr = "";
    current.send = null;
    current.error = "WhatsApp link closed. Scan again to reconnect.";
    void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "disconnected", qr: "", error: current.error }));
    return;
  }
  current.reconnects += 1;
  current.status = "connecting";
  current.error = "";
  void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "connecting", qr: current.qr, error: "" }));
  clearReconnect(tenantId);
  const wait = current.reconnects === 1 ? 400 : 1200;
  reconnectTimers.set(
    tenantId,
    setTimeout(() => {
      reconnectTimers.delete(tenantId);
      void startWebLink(sql, tenantId, { reconnect: true }).catch(() => {
        const failed = live.get(tenantId);
        if (!failed || failed.intentional) return;
        failed.status = "disconnected";
        failed.error = "WhatsApp link closed. Scan again to reconnect.";
        void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "disconnected", qr: "", error: failed.error }));
      });
    }, wait),
  );
}

export async function startWebLink(sql: Sql, tenantId: string, opts?: { reconnect?: boolean }) {
  clearReconnect(tenantId);
  const previous = live.get(tenantId);
  const reconnects = opts?.reconnect ? previous?.reconnects || 0 : 0;
  if (previous) {
    previous.intentional = true;
    previous.close?.();
  }
  live.delete(tenantId);
  const current = session(tenantId);
  const gen = ++epoch;
  current.gen = gen;
  current.reconnects = reconnects;
  current.intentional = false;
  current.status = opts?.reconnect && previous?.status === "connected" ? "connecting" : "qr";
  current.qr = "";
  current.error = "";
  if (!opts?.reconnect) current.phone = "";
  await tenantSql(tenantId, (db) => persist(db, tenantId, { status: current.status, qr: "", error: "", phone: current.phone }));

  const baileys = await import("@whiskeysockets/baileys");
  const pino = (await import("pino")).default;
  const logger = pino({ level: "silent" });
  const [stored] = await tenantSql(
    tenantId,
    (db) => db<{ auth_sealed: string }>`select auth_sealed from whatsapp_web_sessions where tenant_id = ${tenantId}`,
  );
  const dump = readDump(stored?.auth_sealed || "", baileys.BufferJSON);
  const creds = (dump.creds || baileys.initAuthCreds()) as ReturnType<typeof baileys.initAuthCreds>;
  const keys = dump.keys;
  const save = async () => {
    const sealed = seal(JSON.stringify({ creds, keys }, baileys.BufferJSON.replacer));
    await tenantSql(
      tenantId,
      (db) => db`update whatsapp_web_sessions set auth_sealed = ${sealed}, updated_at = now() where tenant_id = ${tenantId}`,
    );
  };
  const { version } = await baileys.fetchLatestBaileysVersion();
  const sock = baileys.makeWASocket({
    version,
    logger,
    auth: {
      creds,
      keys: {
        get: async (type: string, ids: string[]) => {
          const out: Record<string, unknown> = {};
          for (const id of ids) {
            let value = keys[`${type}:${id}`];
            if (type === "app-state-sync-key" && value) value = baileys.proto.Message.AppStateSyncKeyData.fromObject(value);
            if (value) out[id] = value;
          }
          return out;
        },
        set: async (data: Record<string, Record<string, unknown>>) => {
          for (const category of Object.keys(data)) {
            for (const id of Object.keys(data[category] || {})) {
              const value = data[category][id];
              const key = `${category}:${id}`;
              if (value) keys[key] = value;
              else delete keys[key];
            }
          }
          await save();
        },
      },
    } as Parameters<typeof baileys.makeWASocket>[0]["auth"],
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    browser: baileys.Browsers.ubuntu("Chrome"),
  });
  current.close = () => {
    try {
      sock.end(undefined);
    } catch {
      /* already closed */
    }
  };
  current.send = async (jid, text) => {
    await sock.sendMessage(jid, { text });
  };
  sock.ev.on("creds.update", () => {
    void save();
  });
  sock.ev.on("connection.update", (update) => {
    if (current.gen !== gen || current.intentional) return;
    if (update.qr) {
      current.status = "qr";
      current.qr = update.qr;
      current.error = "";
      void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "qr", qr: update.qr, error: "" }));
    }
    if (update.connection === "open") {
      const jid = sock.user?.id || "";
      const phone = jid.replace(/:\d+@/, "@").replace(/@.*/, "");
      current.status = "connected";
      current.qr = "";
      current.reconnects = 0;
      current.phone = phone.startsWith("+") ? phone : phone ? `+${phone.replace(/\D/g, "")}` : "";
      current.error = "";
      void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "connected", qr: "", phone: current.phone, error: "" }));
      void save();
    }
    if (update.connection === "close") {
      const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const action = linkCloseAction(code);
      current.send = null;
      if (action === "logout") {
        current.status = "disconnected";
        current.qr = "";
        current.error = "The phone unlinked this device. Scan again to reconnect.";
        void tenantSql(tenantId, async (db) => {
          await db`update whatsapp_web_sessions set auth_sealed = '' where tenant_id = ${tenantId}`;
          await persist(db, tenantId, { status: "disconnected", qr: "", error: current.error });
        });
        return;
      }
      if (action === "replaced") {
        current.status = "disconnected";
        current.qr = "";
        current.error = "This WhatsApp was linked somewhere else. Scan again to reconnect.";
        void tenantSql(tenantId, (db) => persist(db, tenantId, { status: "disconnected", qr: "", error: current.error }));
        return;
      }
      void save().then(() => {
        if (current.gen !== gen || current.intentional) return;
        scheduleReconnect(sql, tenantId);
      });
    }
  });
  sock.ev.on("messages.upsert", (payload) => {
    if (current.gen !== gen || current.intentional) return;
    const kind = (payload as { type?: string }).type;
    for (const message of payload.messages || []) {
      const key = message.key || {};
      if (!shouldHandleUpsert(kind, key)) continue;
      const text = webMessageText(message.message as Record<string, unknown> | null);
      if (!text || !key.id) continue;
      const replyJid = key.remoteJid || "";
      void (async () => {
        try {
          if (current.gen !== gen) return;
          let phoneJid = phoneJidFromKey(key);
          if (!phoneJid && replyJid.endsWith("@lid")) {
            const pn = await sock.signalRepository?.lidMapping?.getPNForLID(replyJid);
            phoneJid = pn?.endsWith("@s.whatsapp.net") ? pn : pn ? `${pn.replace(/@.*/, "")}@s.whatsapp.net` : "";
          }
          if (current.gen !== gen) return;
          if (!phoneJid) {
            if (!replyJid) return;
            await sock.sendMessage(replyJid, { text: "We could not verify this WhatsApp number. Please contact support for assistance." });
            return;
          }
          const agent = await import("./whatsapp-agent.ts");
          const result = await tenantSql(tenantId, (db) =>
            agent.handleCustomerWhatsApp(db, {
              tenantId,
              provider: "web",
              providerMessageId: key.id || "",
              from: phoneJid,
              text,
            }),
          );
          for (const reply of result.replies) {
            if (current.gen !== gen) return;
            await sock.sendMessage(replyJid, { text: reply });
          }
        } catch {
          console.error("[whatsapp] reply failed");
          if (current.gen !== gen || !replyJid) return;
          try {
            await sock.sendMessage(replyJid, { text: "I couldn't answer just now. Please try again in a moment." });
          } catch {
            /* socket already closed */
          }
        }
      })();
    }
  });
  return whatsAppLinkStatus(sql, tenantId);
}

function readDump(sealed: string, bufferJson: { reviver: (key: string, value: unknown) => unknown }) {
  if (!sealed) return { creds: null as unknown, keys: {} as Record<string, unknown> };
  try {
    const parsed = JSON.parse(open(sealed), bufferJson.reviver) as { creds?: unknown; keys?: Record<string, unknown> };
    return { creds: parsed.creds || null, keys: parsed.keys || {} };
  } catch {
    return { creds: null, keys: {} };
  }
}

export async function stopWebLink(sql: Sql, tenantId: string, clearAuth: boolean) {
  clearReconnect(tenantId);
  const current = live.get(tenantId);
  if (current) current.intentional = true;
  if (current?.close) current.close();
  live.delete(tenantId);
  if (clearAuth) {
    await sql`insert into whatsapp_web_sessions (tenant_id, status, phone_e164, qr_text, auth_sealed, last_error, updated_at)
      values (${tenantId}, 'disconnected', '', '', '', '', now())
      on conflict (tenant_id) do update set status = 'disconnected', phone_e164 = '', qr_text = '', auth_sealed = '', last_error = '', updated_at = now()`;
  }
}

export async function sendWebText(tenantId: string, phone: string, text: string) {
  const current = live.get(tenantId);
  if (!current?.send || current.status !== "connected") return false;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return false;
  await current.send(`${digits}@s.whatsapp.net`, text);
  return true;
}

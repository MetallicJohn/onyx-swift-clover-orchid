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
  const [row] = await sql<{ status: string; phone_e164: string; qr_text: string; last_error: string }>`
    select status, phone_e164, qr_text, last_error from whatsapp_web_sessions where tenant_id = ${tenantId}`;
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
    void persist(sql, tenantId, { status: "disconnected", qr: "", error: current.error });
    return;
  }
  current.reconnects += 1;
  current.status = "connecting";
  current.error = "";
  void persist(sql, tenantId, { status: "connecting", qr: current.qr, error: "" });
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
        void persist(sql, tenantId, { status: "disconnected", qr: "", error: failed.error });
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
  await persist(sql, tenantId, { status: current.status, qr: "", error: "", phone: current.phone });

  const baileys = await import("@whiskeysockets/baileys");
  const pino = (await import("pino")).default;
  const logger = pino({ level: "silent" });
  const [stored] = await sql<{ auth_sealed: string }>`select auth_sealed from whatsapp_web_sessions where tenant_id = ${tenantId}`;
  const dump = readDump(stored?.auth_sealed || "", baileys.BufferJSON);
  const creds = (dump.creds || baileys.initAuthCreds()) as ReturnType<typeof baileys.initAuthCreds>;
  const keys = dump.keys;
  const save = async () => {
    const sealed = seal(JSON.stringify({ creds, keys }, baileys.BufferJSON.replacer));
    await sql`update whatsapp_web_sessions set auth_sealed = ${sealed}, updated_at = now() where tenant_id = ${tenantId}`;
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
      void persist(sql, tenantId, { status: "qr", qr: update.qr, error: "" });
    }
    if (update.connection === "open") {
      const jid = sock.user?.id || "";
      const phone = jid.replace(/:\d+@/, "@").replace(/@.*/, "");
      current.status = "connected";
      current.qr = "";
      current.reconnects = 0;
      current.phone = phone.startsWith("+") ? phone : phone ? `+${phone.replace(/\D/g, "")}` : "";
      current.error = "";
      void persist(sql, tenantId, { status: "connected", qr: "", phone: current.phone, error: "" });
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
        void sql`update whatsapp_web_sessions set auth_sealed = '' where tenant_id = ${tenantId}`;
        void persist(sql, tenantId, { status: "disconnected", qr: "", error: current.error });
        return;
      }
      if (action === "replaced") {
        current.status = "disconnected";
        current.qr = "";
        current.error = "This WhatsApp was linked somewhere else. Scan again to reconnect.";
        void persist(sql, tenantId, { status: "disconnected", qr: "", error: current.error });
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
    for (const message of payload.messages || []) {
      if (message.key?.fromMe) continue;
      const remote = message.key?.remoteJid || "";
      if (!remote.endsWith("@s.whatsapp.net")) continue;
      const text = message.message?.conversation || message.message?.extendedTextMessage?.text || "";
      if (!text || !message.key?.id) continue;
      void import("./whatsapp-agent.ts").then(async (agent) => {
        const result = await agent.handleCustomerWhatsApp(sql, {
          tenantId,
          provider: "web",
          providerMessageId: message.key?.id || "",
          from: remote,
          text,
        });
        for (const reply of result.replies) {
          if (current.gen !== gen) return;
          await sock.sendMessage(remote, { text: reply });
        }
      });
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

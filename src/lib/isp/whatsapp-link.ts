import { open, seal } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

type LiveSession = {
  status: "disconnected" | "qr" | "connected";
  qr: string;
  phone: string;
  error: string;
  send: ((jid: string, text: string) => Promise<void>) | null;
  close: (() => void) | null;
};

const live = new Map<string, LiveSession>();

function session(tenantId: string): LiveSession {
  const existing = live.get(tenantId);
  if (existing) return existing;
  const created: LiveSession = { status: "disconnected", qr: "", phone: "", error: "", send: null, close: null };
  live.set(tenantId, created);
  return created;
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
    error: memory?.error || row?.last_error || "",
  };
}

export async function startWebLink(sql: Sql, tenantId: string) {
  await stopWebLink(sql, tenantId, false);
  const current = session(tenantId);
  current.status = "qr";
  current.qr = "";
  current.error = "";
  current.phone = "";
  await persist(sql, tenantId, { status: "qr", qr: "", error: "", phone: "" });

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
    browser: ["ISP Solutions", "Chrome", "1.0.0"],
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
    if (update.qr) {
      current.status = "qr";
      current.qr = update.qr;
      void persist(sql, tenantId, { status: "qr", qr: update.qr, error: "" });
    }
    if (update.connection === "open") {
      const jid = sock.user?.id || "";
      const phone = jid.replace(/:\d+@/, "@").replace(/@.*/, "");
      current.status = "connected";
      current.qr = "";
      current.phone = phone.startsWith("+") ? phone : phone ? `+${phone.replace(/\D/g, "")}` : "";
      current.error = "";
      void persist(sql, tenantId, { status: "connected", qr: "", phone: current.phone, error: "" });
      void save();
    }
    if (update.connection === "close") {
      const code = (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
      const loggedOut = code === baileys.DisconnectReason.loggedOut;
      current.status = "disconnected";
      current.qr = "";
      current.send = null;
      current.error = loggedOut ? "The phone unlinked this device." : "WhatsApp link closed. Scan again to reconnect.";
      void persist(sql, tenantId, { status: "disconnected", qr: "", error: current.error });
      if (loggedOut) {
        void sql`update whatsapp_web_sessions set auth_sealed = '' where tenant_id = ${tenantId}`;
      }
    }
  });
  sock.ev.on("messages.upsert", (payload) => {
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
  const current = live.get(tenantId);
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

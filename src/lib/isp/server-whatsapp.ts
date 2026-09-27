import { createHmac, timingSafeEqual } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";
import {
  getWhatsAppAgentSettings,
  handleCustomerWhatsApp,
  listWhatsAppConversations,
  publicWhatsAppActions,
  saveWhatsAppAgentSettings,
  setWhatsAppHandoff,
  WA_ACTIONS,
  whatsAppWebhookSecret,
  type WaSettings,
} from "./whatsapp-agent.ts";

export const getWhatsAppAgent = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const settings = await getWhatsAppAgentSettings(sql, tenantId);
    const { whatsAppLinkStatus } = await import("./whatsapp-link.ts");
    const link = await whatsAppLinkStatus(sql, tenantId);
    const conversations = await listWhatsAppConversations(sql, tenantId);
    return { settings, actions: publicWhatsAppActions(settings), link, conversations };
  });

export const saveWhatsAppAgent = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: Partial<WaSettings>) => data)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const actions: Record<string, boolean> = {};
    for (const action of WA_ACTIONS) {
      if (typeof data.actions?.[action.id] === "boolean") actions[action.id] = Boolean(data.actions[action.id]);
    }
    const saved = await saveWhatsAppAgentSettings(sql, tenantId, { ...data, actions });
    return { settings: saved, actions: publicWhatsAppActions(saved) };
  });

export const startWhatsAppLink = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const { startWebLink } = await import("./whatsapp-link.ts");
    return startWebLink(sql, tenantId);
  });

export const refreshWhatsAppLink = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const { whatsAppLinkStatus } = await import("./whatsapp-link.ts");
    return whatsAppLinkStatus(sql, tenantId);
  });

export const unlinkWhatsApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const { stopWebLink } = await import("./whatsapp-link.ts");
    await stopWebLink(sql, tenantId, true);
    return { status: "disconnected" as const };
  });

export const pauseWhatsAppConversation = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id: string; paused: boolean }) => ({ id: String(data.id || "").slice(0, 80), paused: data.paused === true }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await setWhatsAppHandoff(sql, tenantId, data.id, data.paused);
    return { ok: true as const };
  });

export async function verifyMetaWebhook(sql: Awaited<ReturnType<typeof getSql>>, tenantId: string, header: string, body: string) {
  const secret = await whatsAppWebhookSecret(sql, tenantId);
  const expected = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header || "");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function ingestMetaMessages(
  sql: Awaited<ReturnType<typeof getSql>>,
  tenantId: string,
  body: { entry?: Array<{ changes?: Array<{ value?: { messages?: Array<{ id?: string; from?: string; text?: { body?: string } }> } }> }> },
) {
  const replies: string[] = [];
  for (const entry of body.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        if (!message.id || !message.from || !message.text?.body) continue;
        const result = await handleCustomerWhatsApp(sql, {
          tenantId,
          provider: "meta",
          providerMessageId: message.id,
          from: message.from,
          text: message.text.body,
        });
        replies.push(...result.replies);
      }
    }
  }
  return replies;
}

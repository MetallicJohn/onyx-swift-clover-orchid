import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { applyRls } from "@/lib/isp/rls";
import { ingestMetaMessages, verifyMetaWebhook } from "@/lib/isp/server-whatsapp";
import { whatsAppWebhookSecret } from "@/lib/isp/whatsapp-agent";

async function tenantBySlug(slug: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const [row] = await sql<{ id: string }>`select id from tenants where slug = ${slug}`;
  if (!row) return null;
  await applyRls(sql, { tenantId: row.id });
  return { sql, tenantId: row.id };
}

export const Route = createFileRoute("/api/webhooks/whatsapp/$slug")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const found = await tenantBySlug(params.slug);
        if (!found) return new Response("Not found", { status: 404 });
        const url = new URL(request.url);
        const mode = url.searchParams.get("hub.mode");
        const token = url.searchParams.get("hub.verify_token") || "";
        const challenge = url.searchParams.get("hub.challenge") || "";
        const secret = await whatsAppWebhookSecret(found.sql, found.tenantId);
        if (mode === "subscribe" && token && token === secret) return new Response(challenge, { status: 200 });
        return new Response("Forbidden", { status: 403 });
      },
      POST: async ({ request, params }) => {
        const found = await tenantBySlug(params.slug);
        if (!found) return new Response("Not found", { status: 404 });
        const raw = await request.text();
        const signature = request.headers.get("x-hub-signature-256") || "";
        const ok = await verifyMetaWebhook(found.sql, found.tenantId, signature, raw);
        if (!ok) return new Response("Forbidden", { status: 403 });
        const body = JSON.parse(raw || "{}") as Parameters<typeof ingestMetaMessages>[2];
        await ingestMetaMessages(found.sql, found.tenantId, body);
        return Response.json({ ok: true });
      },
    },
  },
});

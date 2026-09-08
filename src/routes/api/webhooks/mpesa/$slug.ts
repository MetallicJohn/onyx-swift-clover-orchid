import { createFileRoute } from "@tanstack/react-router";
import { handleMpesaCallback } from "@/lib/isp/webhooks";

export const Route = createFileRoute("/api/webhooks/mpesa/$slug")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json({ ok: true, provider: "mpesa", slug: params.slug }),
      POST: async ({ request, params }) => {
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const result = await handleMpesaCallback(params.slug, body);
        return Response.json(result);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/isp/rate-limit";
import { handleMpesaCallback } from "@/lib/isp/webhooks";

export const Route = createFileRoute("/api/webhooks/mpesa/$slug")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json({ ok: true, provider: "mpesa", slug: params.slug }),
      POST: async ({ request, params }) => {
        const lim = rateLimit(`mpesa:${params.slug}`);
        if (!lim.ok) return Response.json({ ResultCode: 1, ResultDesc: "Slow down" }, { status: 429 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const result = await handleMpesaCallback(params.slug, body);
        return Response.json(result);
      },
    },
  },
});

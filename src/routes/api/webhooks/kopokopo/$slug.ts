import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/isp/rate-limit";
import { handleKopokopoCallback } from "@/lib/isp/webhooks";

export const Route = createFileRoute("/api/webhooks/kopokopo/$slug")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json({ ok: true, provider: "kopokopo", slug: params.slug }),
      POST: async ({ request, params }) => {
        const lim = rateLimit(`kopo:${params.slug}`);
        if (!lim.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const result = await handleKopokopoCallback(params.slug, body);
        return Response.json(result);
      },
    },
  },
});

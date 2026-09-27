import { createFileRoute } from "@tanstack/react-router";
import { rateLimit } from "@/lib/isp/rate-limit";
import { handleKopokopoCallback, kopokopoSignatureOk } from "@/lib/isp/webhooks";

export const Route = createFileRoute("/api/webhooks/kopokopo/$slug")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json({ ok: true, provider: "kopokopo", slug: params.slug }),
      POST: async ({ request, params }) => {
        const lim = await rateLimit(`kopo:${params.slug}`);
        if (!lim.ok) return Response.json({ ok: false, error: "rate_limited" }, { status: 429 });
        const raw = await request.text();
        const ok = await kopokopoSignatureOk(params.slug, raw, request.headers.get("x-kopokopo-signature"));
        if (!ok) return Response.json({ ok: false }, { status: 401 });
        let body: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return Response.json({ ok: false }, { status: 400 });
          }
          body = parsed as Record<string, unknown>;
        } catch {
          return Response.json({ ok: false }, { status: 400 });
        }
        const result = await handleKopokopoCallback(params.slug, body);
        return Response.json(result);
      },
    },
  },
});

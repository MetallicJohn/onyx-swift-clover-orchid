import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { corsHeaders, publicPurchaseError, startHotspotPurchase } from "@/lib/isp/hotspot-purchase";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";

export const Route = createFileRoute("/api/v1/hotspot/purchase")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const ip = clientIp(request);
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const slug = String(body.slug || "");
        const phone = String(body.phone || "");
        const lim = rateLimit(`hs-buy:${ip}:${phone}`, 8, 15 * 60_000);
        if (!lim.ok) return Response.json({ error: "Too many payment attempts. Try again later." }, { status: 429, headers: corsHeaders() });
        try {
          const sql = await getSql();
          const started = await startHotspotPurchase(sql, {
            slug,
            packageId: String(body.package_id || ""),
            phone,
            amountKes: typeof body.amount_kes === "number" ? body.amount_kes : undefined,
          });
          return Response.json(started, { headers: corsHeaders() });
        } catch (err) {
          const out = publicPurchaseError(err);
          return Response.json({ error: out.error }, { status: out.status, headers: corsHeaders() });
        }
      },
    },
  },
});

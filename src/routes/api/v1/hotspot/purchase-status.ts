import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { corsHeaders, pollHotspotPurchase, publicPurchaseError } from "@/lib/isp/hotspot-purchase";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";

export const Route = createFileRoute("/api/v1/hotspot/purchase-status")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        const lim = rateLimit(`hs-poll:${ip}`, 60, 60_000);
        if (!lim.ok) return Response.json({ error: "Too many requests" }, { status: 429, headers: corsHeaders() });
        const url = new URL(request.url);
        try {
          const sql = await getSql();
          const status = await pollHotspotPurchase(sql, {
            slug: url.searchParams.get("slug") || "",
            purchaseId: url.searchParams.get("id") || "",
          });
          return Response.json(status, { headers: corsHeaders() });
        } catch (err) {
          const out = publicPurchaseError(err);
          return Response.json({ error: out.error }, { status: out.status, headers: corsHeaders() });
        }
      },
    },
  },
});

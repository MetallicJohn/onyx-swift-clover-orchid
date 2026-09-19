import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { corsHeaders, listHotspotCatalog, publicPurchaseError } from "@/lib/isp/hotspot-purchase";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";

export const Route = createFileRoute("/api/v1/hotspot/catalog")({
  server: {
    handlers: {
      OPTIONS: () => new Response(null, { status: 204, headers: corsHeaders() }),
      GET: async ({ request }) => {
        const ip = clientIp(request);
        const lim = rateLimit(`hs-cat:${ip}`, 60, 60_000);
        if (!lim.ok) return Response.json({ error: "Too many requests" }, { status: 429, headers: corsHeaders() });
        const slug = new URL(request.url).searchParams.get("slug") || "";
        try {
          const sql = await getSql();
          const catalog = await listHotspotCatalog(sql, slug);
          return Response.json(catalog, { headers: corsHeaders() });
        } catch (err) {
          const out = publicPurchaseError(err);
          return Response.json({ error: out.error }, { status: out.status, headers: corsHeaders() });
        }
      },
    },
  },
});

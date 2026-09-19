import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { serveHotspotHtmlFile } from "@/lib/isp/hotspot-portal";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";

export const Route = createFileRoute("/api/v1/hotspot/html/$file")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const file = params.file || "";
        const ip = clientIp(request);
        const lim = rateLimit(`hs-html:${ip}`, 60, 60_000);
        if (!lim.ok) {
          return new Response("rate limited", { status: 429, headers: { "Content-Type": "text/plain; charset=utf-8" } });
        }
        const sql = await getSql();
        const out = await serveHotspotHtmlFile(sql, token, file);
        return new Response(out.body, {
          status: out.status,
          headers: {
            "Content-Type": out.contentType,
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});

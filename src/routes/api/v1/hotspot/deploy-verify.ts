import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { confirmHotspotDeploy } from "@/lib/isp/hotspot-portal";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";

export const Route = createFileRoute("/api/v1/hotspot/deploy-verify")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const id = url.searchParams.get("id") || "";
        const ok = url.searchParams.get("ok") === "1";
        const ip = clientIp(request);
        const lim = rateLimit(`hs-verify:${ip}`, 30, 60_000);
        if (!lim.ok) {
          return new Response("rate limited", { status: 429 });
        }
        const sql = await getSql();
        const out = await confirmHotspotDeploy(sql, token, id, ok);
        return Response.json({ ok: out.ok, verified: "verified" in out ? out.verified : false }, { status: out.status });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { rateLimit } from "@/lib/isp/rate-limit";
import { clientIp } from "@/lib/isp/router-http";
import { hashProvisionToken, serveBootstrapRsc } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/vpn/routers/$token/bootstrap.rsc")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const ip = clientIp(request);
        const token = params.token || "";
        const ipLim = rateLimit(`bootstrap-ip:${ip}`, 30, 60_000);
        const tokLim = rateLimit(`bootstrap-tok:${hashProvisionToken(token).slice(0, 16)}`, 12, 60_000);
        if (!ipLim.ok || !tokLim.ok) {
          return new Response("# rate limited\n", {
            status: 429,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        const sql = await getSql();
        const out = await serveBootstrapRsc(sql, token);
        return new Response(out.body, {
          status: out.status,
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Content-Disposition": 'attachment; filename="bootstrap.rsc"',
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});

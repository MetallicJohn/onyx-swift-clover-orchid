import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { listAcsPortMap } from "@/lib/isp/acs-ports";
import { applyRls } from "@/lib/isp/rls";

function authorized(request: Request) {
  const token = (process.env.ACS_EDGE_TOKEN || "").trim();
  if (!token) return false;
  const header = request.headers.get("authorization") || "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (request.headers.get("x-acs-edge-token") || "").trim();
  return presented.length > 0 && presented === token;
}

export const Route = createFileRoute("/api/internal/acs-ports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorized(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        try {
          const ports = await listAcsPortMap(sql);
          return Response.json({
            ok: true,
            target: process.env.GENIEACS_CWMP_URL || "http://genieacs:7547",
            ports: ports.map((p) => ({
              port: p.cwmp_port,
              tenant_id: p.tenant_id,
              slug: p.slug,
              username: p.username,
            })),
          });
        } finally {
          await applyRls(sql, { bypass: false });
        }
      },
    },
  },
});

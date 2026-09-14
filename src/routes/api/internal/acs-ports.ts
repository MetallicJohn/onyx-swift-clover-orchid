import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { authorizedAcsEdge } from "@/lib/isp/acs-security";
import { listAcsPortMap } from "@/lib/isp/acs-ports";
import { applyRls } from "@/lib/isp/rls";

export const Route = createFileRoute("/api/internal/acs-ports")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizedAcsEdge(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        try {
          const ports = await listAcsPortMap(sql);
          return Response.json({
            ok: true,
            target: process.env.GENIEACS_CWMP_URL || "",
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

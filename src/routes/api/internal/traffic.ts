import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { authorizedInternal, requestIdOf } from "@/lib/isp/internal-auth";
import { applyRls } from "@/lib/isp/rls";
import { collectTrafficSnapshot, collectorHealth } from "@/lib/isp/traffic-collector";

export const Route = createFileRoute("/api/internal/traffic")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizedInternal(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        const health = await collectorHealth(sql);
        return Response.json({ ok: true, requestId: requestIdOf(request), ...health });
      },
      POST: async ({ request }) => {
        if (!authorizedInternal(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        let body: { collectorId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        const collectorId =
          String(body.collectorId || request.headers.get("x-collector-id") || process.env.COLLECTOR_ID || "default").slice(
            0,
            80,
          ) || "default";
        const out = await collectTrafficSnapshot(sql, { collectorId });
        return Response.json({ ok: true, requestId: requestIdOf(request), ...out });
      },
    },
  },
});

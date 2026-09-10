import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ingestNodeTelemetry } from "@/lib/isp/platform";
import { applyRls } from "@/lib/isp/rls";

export const Route = createFileRoute("/api/platform/telemetry")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const auth = request.headers.get("authorization") || "";
        const url = new URL(request.url);
        const token =
          (auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "") ||
          url.searchParams.get("token") ||
          "";
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        try {
          const out = await ingestNodeTelemetry(sql, token, {
            cpu_pct: body.cpu_pct as number | undefined,
            ram_pct: body.ram_pct as number | undefined,
            disk_pct: body.disk_pct as number | undefined,
            load_1: body.load_1 as number | undefined,
            net_rx_bytes: body.net_rx_bytes as number | undefined,
            net_tx_bytes: body.net_tx_bytes as number | undefined,
            uptime_seconds: body.uptime_seconds as number | undefined,
            postgres_ok: body.postgres_ok as boolean | undefined,
            redis_ok: body.redis_ok as boolean | undefined,
            genieacs_ok: body.genieacs_ok as boolean | undefined,
            reported_at: body.reported_at as string | undefined,
          });
          return Response.json(out);
        } catch (err) {
          const message = err instanceof Error ? err.message : "Rejected";
          const status = message === "Unauthorized" ? 401 : 400;
          return Response.json({ error: message }, { status });
        }
      },
    },
  },
});

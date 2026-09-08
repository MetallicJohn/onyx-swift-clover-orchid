import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { heartbeatRouter } from "@/lib/isp/mikrotik";

export const Route = createFileRoute("/api/agent/heartbeat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as {
          token?: string;
          cpu?: number;
          uptime_hours?: number;
          version?: string;
        };
        const token = body.token || url.searchParams.get("token") || "";
        const sql = await getSql();
        const out = await heartbeatRouter(sql, token, body);
        return Response.json(out);
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const sql = await getSql();
        const out = await heartbeatRouter(sql, token, {
          cpu: Number(url.searchParams.get("cpu") || 8),
          uptime_hours: Number(url.searchParams.get("uptime") || 1),
        });
        return Response.json(out);
      },
    },
  },
});

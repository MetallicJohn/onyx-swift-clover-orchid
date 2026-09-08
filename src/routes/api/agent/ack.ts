import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { ackCommands } from "@/lib/isp/mikrotik";

export const Route = createFileRoute("/api/agent/ack")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const body = (await request.json().catch(() => ({}))) as {
          token?: string;
          ids?: string[];
          result?: string;
        };
        const token = body.token || url.searchParams.get("token") || "";
        const ids = body.ids || (url.searchParams.get("ids") || "").split(",").filter(Boolean);
        const sql = await getSql();
        const out = await ackCommands(sql, token, ids, body.result || "ok");
        return Response.json(out);
      },
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const ids = (url.searchParams.get("ids") || "").split(",").filter(Boolean);
        const sql = await getSql();
        const out = await ackCommands(sql, token, ids, "ok");
        return Response.json(out);
      },
    },
  },
});

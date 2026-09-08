import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { renderAgentScript } from "@/lib/isp/mikrotik";

export const Route = createFileRoute("/api/agent/script")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") || "";
        const sql = await getSql();
        const out = await renderAgentScript(sql, token);
        return new Response(out.script, {
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});

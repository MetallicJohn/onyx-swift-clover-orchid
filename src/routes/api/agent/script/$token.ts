import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { renderAgentScript } from "@/lib/isp/mikrotik";

export const Route = createFileRoute("/api/agent/script/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = params.token || "";
        try {
          const sql = await getSql();
          const out = await renderAgentScript(sql, token);
          return new Response(out.script, {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        } catch {
          return new Response("# unknown token\n", {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
      },
    },
  },
});

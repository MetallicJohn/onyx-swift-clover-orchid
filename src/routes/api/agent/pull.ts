import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { pullCommands } from "@/lib/isp/mikrotik";

function tokenOf(request: Request, url: URL) {
  const q = url.searchParams.get("token") || "";
  const auth = request.headers.get("authorization") || "";
  return q || auth.replace(/^Bearer\s+/i, "");
}

export const Route = createFileRoute("/api/agent/pull")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = tokenOf(request, new URL(request.url));
        const sql = await getSql();
        const pulled = await pullCommands(sql, token, true);
        return Response.json(pulled);
      },
      POST: async ({ request }) => {
        const token = tokenOf(request, new URL(request.url));
        const sql = await getSql();
        const pulled = await pullCommands(sql, token, true);
        return Response.json(pulled);
      },
    },
  },
});

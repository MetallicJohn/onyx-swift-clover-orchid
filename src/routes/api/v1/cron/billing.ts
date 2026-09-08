import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { runBillingCycle } from "@/lib/isp/notifications";

export const Route = createFileRoute("/api/v1/cron/billing")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return Response.json({ ok: false, error: "CRON_SECRET not set" }, { status: 503 });
        const auth = request.headers.get("authorization") || "";
        if (auth !== `Bearer ${secret}`) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const sql = await getSql();
        const tenants = await sql<{ id: string; name: string }>`select id, name from tenants`;
        const results = [];
        for (const t of tenants) {
          results.push({ tenant: t.name, ...(await runBillingCycle(sql, t.id, t.name)) });
        }
        return Response.json({ ok: true, ran: results.length, results });
      },
    },
  },
});

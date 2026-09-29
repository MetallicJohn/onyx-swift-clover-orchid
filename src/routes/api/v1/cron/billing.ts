import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { enqueueBillingForAllTenants, enqueueTicketSlaScan, processQueuedJobs } from "@/lib/isp/jobs";
import { applyRls } from "@/lib/isp/rls";

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
        await applyRls(sql, { bypass: true });
        const queued = await enqueueBillingForAllTenants(sql);
        await enqueueTicketSlaScan(sql).catch(() => null);
        const processed = await processQueuedJobs(sql, { workerId: "cron-billing", queue: "billing", limit: 32 });
        const sla = await processQueuedJobs(sql, { workerId: "cron-sla", queue: "notifications", limit: 4 }).catch(() => null);
        return Response.json({ ok: true, ran: queued.tenants, queued, processed, sla });
      },
    },
  },
});

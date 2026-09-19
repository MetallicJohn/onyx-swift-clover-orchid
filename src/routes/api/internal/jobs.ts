import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { authorizedInternal, requestIdOf } from "@/lib/isp/internal-auth";
import { enqueueJob, jobHealth, processQueuedJobs } from "@/lib/isp/jobs";
import { applyRls } from "@/lib/isp/rls";
import { loadServiceConfig } from "@/lib/isp/runtime-config";

export const Route = createFileRoute("/api/internal/jobs")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorizedInternal(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        const stats = await jobHealth(sql);
        return Response.json({ ok: true, requestId: requestIdOf(request), ...stats });
      },
      POST: async ({ request }) => {
        if (!authorizedInternal(request)) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        let body: { queue?: string; limit?: number; workerId?: string } = {};
        try {
          body = (await request.json()) as typeof body;
        } catch {
          body = {};
        }
        const cfg = loadServiceConfig();
        const queue = String(body.queue || cfg.jobQueueName || "").trim();
        await enqueueJob(sql, {
          queue: "mikrotik",
          kind: "mikrotik.health",
          idempotencyKey: `mikrotik.health:${new Date().toISOString().slice(0, 16)}`,
        }).catch(() => null);
        const out = await processQueuedJobs(sql, {
          workerId: String(body.workerId || request.headers.get("x-worker-id") || "worker"),
          queue,
          limit: Number(body.limit || cfg.workerConcurrency),
        });
        return Response.json({ ok: true, requestId: requestIdOf(request), ...out });
      },
    },
  },
});

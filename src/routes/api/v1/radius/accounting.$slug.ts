import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { recordAccounting } from "@/lib/isp/access-policy";
import { rateLimit } from "@/lib/isp/rate-limit";
import { applyRls } from "@/lib/isp/rls";

export const Route = createFileRoute("/api/v1/radius/accounting/$slug")({
  server: {
    handlers: {
      GET: ({ params }) => Response.json({ ok: true, accounting: true, slug: params.slug }),
      POST: async ({ request, params }) => {
        const lim = rateLimit(`acct:${params.slug}`);
        if (!lim.ok) return Response.json({ ok: false, error: "slow down" }, { status: 429 });
        const body = (await request.json().catch(() => ({}))) as {
          username?: string;
          bytes_in?: number;
          bytes_out?: number;
          nas_ip?: string;
          session_id?: string;
        };
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        const [t] = await sql<{ id: string }>`select id from tenants where slug = ${params.slug}`;
        if (!t) return Response.json({ ok: false, error: "unknown tenant" }, { status: 404 });
        await applyRls(sql, { tenantId: t.id, bypass: false });
        try {
          const result = await recordAccounting(sql, t.id, {
            username: String(body.username || ""),
            bytes_in: Number(body.bytes_in) || 0,
            bytes_out: Number(body.bytes_out) || 0,
            nas_ip: body.nas_ip,
            session_id: body.session_id,
          });
          return Response.json({ ok: true, ...result });
        } catch (e) {
          return Response.json({ ok: false, error: e instanceof Error ? e.message : "failed" }, { status: 400 });
        }
      },
    },
  },
});

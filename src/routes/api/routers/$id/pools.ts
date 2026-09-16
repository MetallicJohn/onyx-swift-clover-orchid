import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, readJson, requireRouterApi } from "@/lib/isp/router-http";
import { setRouterPools } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/pools")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(request, "routers.manage", "pools", 20);
          const body = await readJson(request);
          const poolIds = Array.isArray(body.pool_ids)
            ? body.pool_ids.map((id) => String(id))
            : [];
          const out = await setRouterPools(sql, {
            tenantId,
            routerId: params.id,
            poolIds,
            actorUserId: userId,
            push: body.push !== false,
          });
          return json(out);
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

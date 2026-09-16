import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, requireRouterApi } from "@/lib/isp/router-http";
import { routerStatus } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/status")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { sql, tenantId } = await requireRouterApi(request, "routers.read", "status");
          return json(await routerStatus(sql, tenantId, params.id));
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

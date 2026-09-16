import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, requireRouterApi } from "@/lib/isp/router-http";
import { configurationHistory } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/configuration-history")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { sql, tenantId } = await requireRouterApi(request, "routers.read", "history");
          const history = await configurationHistory(sql, tenantId, params.id);
          return json({ history });
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

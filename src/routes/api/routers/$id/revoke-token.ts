import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, requireRouterApi } from "@/lib/isp/router-http";
import { revokeProvisioningToken } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/revoke-token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(request, "routers.manage", "revoke-token", 20);
          const router = await revokeProvisioningToken(sql, {
            tenantId,
            routerId: params.id,
            actorUserId: userId,
          });
          return json({ router });
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

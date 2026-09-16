import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, requireRouterApi } from "@/lib/isp/router-http";
import { issueProvisioningToken } from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/provisioning-token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(
            request,
            "routers.manage",
            "provision-token",
            10,
          );
          const issued = await issueProvisioningToken(sql, {
            tenantId,
            routerId: params.id,
            actorUserId: userId,
          });
          return json({
            token: issued.token,
            hint: issued.hint,
            expires_at: issued.expires_at,
            ttl_hours: issued.ttl_hours,
            bootstrap: issued.bootstrap,
            router: issued.router,
          });
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

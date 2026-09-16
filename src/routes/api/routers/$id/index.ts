import { createFileRoute } from "@tanstack/react-router";
import { apiError, json, readJson, requireRouterApi } from "@/lib/isp/router-http";
import {
  deleteRouter,
  listAssignedPools,
  listProvisionEvents,
  routerStatus,
  updateRouterFields,
} from "@/lib/isp/router-provisioning";

export const Route = createFileRoute("/api/routers/$id/")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { sql, tenantId } = await requireRouterApi(request, "routers.read", "get");
          const status = await routerStatus(sql, tenantId, params.id);
          const [events, assigned] = await Promise.all([
            listProvisionEvents(sql, tenantId, params.id, 20),
            listAssignedPools(sql, tenantId, params.id),
          ]);
          return json({ router: status, events, assigned });
        } catch (err) {
          return apiError(err);
        }
      },
      PATCH: async ({ request, params }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(request, "routers.manage", "update", 30);
          const body = await readJson(request);
          const router = await updateRouterFields(sql, {
            tenantId,
            routerId: params.id,
            actorUserId: userId,
            fields: {
              name: body.name != null ? String(body.name) : undefined,
              identity: body.identity != null ? String(body.identity) : undefined,
              location: body.location != null ? String(body.location) : undefined,
              role: body.role != null ? String(body.role) : undefined,
              model: body.model != null ? String(body.model) : undefined,
              ros_version: body.ros_version != null ? String(body.ros_version) : undefined,
              site_pop: body.site_pop != null ? String(body.site_pop) : undefined,
              management_ip: body.management_ip != null ? String(body.management_ip) : undefined,
            },
          });
          return json({ router });
        } catch (err) {
          return apiError(err);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(request, "routers.manage", "delete", 20);
          const out = await deleteRouter(sql, { tenantId, routerId: params.id, actorUserId: userId });
          return json(out);
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { enrollFields, nextWgAddress } from "@/lib/isp/agent";
import { nid } from "@/lib/utils";
import { assertFeature } from "@/lib/isp/plans";
import { assertRouterQuota } from "@/lib/isp/saas";
import { apiError, json, readJson, requireRouterApi } from "@/lib/isp/router-http";
import { issueProvisioningToken, listTenantRouters, recordProvisionEvent } from "@/lib/isp/router-provisioning";
import { seal } from "@/lib/isp/secrets";

export const Route = createFileRoute("/api/routers/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { sql, tenantId } = await requireRouterApi(request, "routers.read", "list");
          const routers = await listTenantRouters(sql, tenantId);
          return json({ routers });
        } catch (err) {
          return apiError(err);
        }
      },
      POST: async ({ request }) => {
        try {
          const { sql, tenantId, userId } = await requireRouterApi(request, "routers.manage", "create", 20);
          await assertRouterQuota(sql, tenantId);
          await assertFeature(sql, tenantId, "mikrotik");
          const body = await readJson(request);
          const name = String(body.name || "").trim();
          if (!name) return json({ error: "Name is required" }, 400);
          const id = nid("rtr");
          const enroll = enrollFields(name);
          const wgAddress = await nextWgAddress(sql, tenantId);
          const site = String(body.site_pop || body.location || "").trim();
          const identity = String(body.identity || "").trim() || name.toLowerCase();
          await sql`insert into routers (
              id, tenant_id, name, location, identity, role, wg_status, last_seen, cpu_pct, uptime_hours,
              enroll_token, wg_public, wg_address, agent_version, wg_private_ref,
              model, ros_version, site_pop, management_ip, provisioning_status,
              api_user, api_password
            ) values (
              ${id}, ${tenantId}, ${name}, ${site}, ${identity}, ${String(body.role || "access")},
              'pending', null, 0, 0, ${enroll.token}, ${enroll.wg_public}, ${wgAddress}, '0.2.0',
              ${enroll.wg_private_sealed}, ${String(body.model || "").trim()}, ${String(body.ros_version || "").trim()},
              ${site}, ${String(body.management_ip || "").trim()}, 'pending',
              ${enroll.api_user}, ${seal(enroll.api_password)}
            )`;
          await recordProvisionEvent(sql, {
            tenantId,
            routerId: id,
            event: "created",
            actorUserId: userId,
            detail: { name },
          });
          const issued = await issueProvisioningToken(sql, { tenantId, routerId: id, actorUserId: userId });
          return json(
            {
              id,
              router: issued.router,
              bootstrap: issued.bootstrap,
              provision_token: issued.token,
              provision_expires_at: issued.expires_at,
            },
            201,
          );
        } catch (err) {
          return apiError(err);
        }
      },
    },
  },
});

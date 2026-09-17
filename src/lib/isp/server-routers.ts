import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { agentPullUrl, agentScript, enrollFields } from "./agent";
import { wgEnrollContext } from "./wireguard";
import { requireWorkspace as requireWs } from "./workspace";
import { assertPermission, hasPermission } from "./rbac";
import {
  configurationHistory,
  createIpPool,
  deleteIpPool,
  deleteRouter as removeRouter,
  ensureTenantProvisioning,
  issueProvisioningToken,
  listAssignedPools,
  listAvailablePools,
  listProvisionEvents,
  listTenantRouters,
  reconfigureRouter,
  revokeProvisioningToken,
  routerStatus,
  setRouterPools,
  updateRouterFields,
} from "./router-provisioning";

type RouterEnroll = {
  id: string;
  name: string;
  identity: string;
  location: string;
  role: string;
  enroll_token: string;
  wg_public: string;
  wg_address: string;
  wg_private_ref: string;
};

async function loadEnroll(sql: Awaited<ReturnType<typeof requireWs>>["sql"], tenantId: string, id: string) {
  const [r] = await sql<RouterEnroll>`
    select id, name, identity, location, role, enroll_token, wg_public, wg_address, wg_private_ref
    from routers where id = ${id} and tenant_id = ${tenantId}`;
  if (!r) throw new Error("Router not found");
  return r;
}

async function scriptFor(
  sql: Awaited<ReturnType<typeof requireWs>>["sql"],
  tenantId: string,
  r: RouterEnroll,
) {
  const { tenantPublicOriginOrEmpty } = await import("./domain-resolve");
  const base = await tenantPublicOriginOrEmpty(sql, tenantId, "public_api");
  const ctx = await wgEnrollContext(sql, tenantId, {
    id: r.id,
    name: r.name,
    identity: r.identity,
    token: r.enroll_token,
    wg_public: r.wg_public,
    wg_private_ref: r.wg_private_ref,
    wg_address: r.wg_address || "10.200.0.2/32",
    pullUrl: agentPullUrl(base, r.enroll_token),
  });
  return agentScript(ctx);
}

export const updateRouter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: string;
      name: string;
      location?: string;
      identity?: string;
      role?: string;
      model?: string;
      ros_version?: string;
      site_pop?: string;
      management_ip?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, userId } = await requireWs(context.userId).then((w) => ({
      ...w,
      userId: context.userId,
    }));
    assertPermission(role, "routers.manage");
    const router = await updateRouterFields(sql, {
      tenantId,
      routerId: data.id,
      actorUserId: userId,
      fields: data,
    });
    const enroll = await loadEnroll(sql, tenantId, data.id);
    return { ok: true, router, script: await scriptFor(sql, tenantId, enroll) };
  });

export const copyRouterScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; rotate?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const r = await loadEnroll(sql, tenantId, data.id);
    if (data.rotate) {
      const enroll = enrollFields(r.name);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_status = 'pending'
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadEnroll(sql, tenantId, r.id);
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    if (!r.enroll_token) {
      const enroll = enrollFields(r.name);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadEnroll(sql, tenantId, r.id);
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    return { script: await scriptFor(sql, tenantId, r), token: r.enroll_token, rotated: false };
  });

export const getRouterDetailFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const status = await routerStatus(sql, tenantId, data.id);
    const [events, history, assigned, pools] = await Promise.all([
      listProvisionEvents(sql, tenantId, data.id),
      configurationHistory(sql, tenantId, data.id),
      listAssignedPools(sql, tenantId, data.id),
      listAvailablePools(sql, tenantId),
    ]);
    return { workspace, router: status, events, history, assigned, pools };
  });

export const issueRouterTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return issueProvisioningToken(sql, {
      tenantId,
      routerId: data.id,
      actorUserId: context.userId,
    });
  });

export const revokeRouterTokenFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const router = await revokeProvisioningToken(sql, {
      tenantId,
      routerId: data.id,
      actorUserId: context.userId,
    });
    return { router };
  });

export const deleteRouterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return removeRouter(sql, { tenantId, routerId: data.id, actorUserId: context.userId });
  });

export const reconfigureRouterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return reconfigureRouter(sql, { tenantId, routerId: data.id, actorUserId: context.userId });
  });

export const pushRouterPoolsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; pool_ids: string[]; push?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return setRouterPools(sql, {
      tenantId,
      routerId: data.id,
      poolIds: data.pool_ids,
      actorUserId: context.userId,
      push: data.push !== false,
    });
  });

export const createIpPoolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { name: string; cidr: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return createIpPool(sql, {
      tenantId,
      name: data.name,
      cidr: data.cidr,
      actorUserId: context.userId,
    });
  });

export const deleteIpPoolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return deleteIpPool(sql, { tenantId, poolId: data.id });
  });

export const listRoutersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const [routers, pools, provisioning] = await Promise.all([
      listTenantRouters(sql, tenantId),
      listAvailablePools(sql, tenantId),
      ensureTenantProvisioning(sql, tenantId),
    ]);
    return { workspace, routers, pools, provisioning };
  });

export const getRouterConfigHistoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; include_script?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    return {
      history: await configurationHistory(sql, tenantId, data.id, {
        includeScript: false,
      }),
    };
  });

export const getRouterStatusFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    return routerStatus(sql, tenantId, data.id);
  });

export const routerTelemetryFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    if (!hasPermission(role, "traffic.view") && !hasPermission(role, "routers.read")) {
      throw new Error("Forbidden");
    }
    const { routerTelemetry } = await import("./traffic-router.ts");
    return routerTelemetry(sql, tenantId, data.router_id);
  });

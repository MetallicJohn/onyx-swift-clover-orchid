import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { agentPullUrl, agentScript, enrollFields } from "./agent";
import { apiUserEnsureRos } from "./routeros";
import { wgEnrollContext } from "./wireguard";
import { requireWorkspace as requireWs } from "./workspace";
import { assertPermission, hasPermission } from "./rbac";
import {
  configurationHistory,
  createIpPool,
  deleteIpPool,
  deleteRouter as removeRouter,
  ensureRouterApiCredentials,
  ensureTenantProvisioning,
  issueProvisioningToken,
  listAssignedPools,
  listAvailablePools,
  listProvisionEvents,
  listTenantRouters,
  reconfigureRouter,
  recordProvisionEvent,
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
  const api = await ensureRouterApiCredentials(sql, tenantId, r.id);
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
  return agentScript({ ...ctx, apiUser: api.user, apiPassword: api.password });
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
      const enroll = enrollFields(r.name, r.wg_address);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}, wg_status = 'pending'
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadEnroll(sql, tenantId, r.id);
      await recordProvisionEvent(sql, {
        tenantId,
        routerId: r.id,
        event: "enroll_script_generated",
        detail: { rotated: true },
      });
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    if (!r.enroll_token) {
      const enroll = enrollFields(r.name, r.wg_address);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_private_ref = ${enroll.wg_private_sealed}
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadEnroll(sql, tenantId, r.id);
      await recordProvisionEvent(sql, {
        tenantId,
        routerId: r.id,
        event: "enroll_script_generated",
        detail: { rotated: true },
      });
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    await recordProvisionEvent(sql, {
      tenantId,
      routerId: r.id,
      event: "enroll_script_generated",
      detail: { rotated: false },
    });
    return { script: await scriptFor(sql, tenantId, r), token: r.enroll_token, rotated: false };
  });

export const copyRouterApiUser = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const r = await loadEnroll(sql, tenantId, data.id);
    const api = await ensureRouterApiCredentials(sql, tenantId, r.id);
    const script = apiUserEnsureRos({ user: api.user, password: api.password, wgAddress: r.wg_address });
    await recordProvisionEvent(sql, {
      tenantId,
      routerId: r.id,
      event: "api_user_script",
      detail: { api_user: api.user },
    });
    return { script, user: api.user };
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

export const queryRoutersDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: Record<string, unknown> | undefined) => d ?? {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const { queryRoutersDesk } = await import("./router-desk");
    const { normalizeRouterDeskQuery } = await import("./router-desk-format");
    const { ensureTenantProvisioning } = await import("./router-provisioning");
    const { previewTenantDomain } = await import("./domain-resolve");
    const { ensureTenantHub } = await import("./wireguard");
    const filters = normalizeRouterDeskQuery({
      q: typeof data.q === "string" ? data.q : "",
      status: data.status as never,
      location: typeof data.location === "string" ? data.location : "",
      vendor: typeof data.vendor === "string" ? data.vendor : "",
      hasPools: data.hasPools === true || data.hasPools === "true",
      hasServices: data.hasServices === true || data.hasServices === "true",
      page: Number(data.page) || 1,
    });
    const [desk, provisioning, hub, domain] = await Promise.all([
      queryRoutersDesk(sql, tenantId, filters),
      ensureTenantProvisioning(sql, tenantId),
      ensureTenantHub(sql, tenantId).catch(() => null),
      previewTenantDomain(sql, tenantId, "router_bootstrap").catch(() => null),
    ]);
    return {
      workspace,
      provisioning,
      hubReady: Boolean(hub?.ready),
      domain,
      ...desk,
    };
  });

export const getRouterDeskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const { listRouterPools } = await import("./router-desk");
    const [status, events, history, pools] = await Promise.all([
      routerStatus(sql, tenantId, data.id),
      listProvisionEvents(sql, tenantId, data.id),
      configurationHistory(sql, tenantId, data.id),
      listRouterPools(sql, tenantId, data.id),
    ]);
    return {
      workspace,
      router: status,
      events,
      history,
      pools,
      service_count: pools.reduce((n, p) => n + p.assigned_services, 0),
    };
  });

export const listRouterPoolsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const { listRouterPools } = await import("./router-desk");
    return { pools: await listRouterPools(sql, tenantId, data.id) };
  });

export const listRouterPoolAssignmentsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { pool_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const { listPoolAssignments } = await import("./router-desk");
    return { assignments: await listPoolAssignments(sql, tenantId, data.pool_id) };
  });

export const createRouterPoolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string } & Record<string, unknown>) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { createRouterPool } = await import("./router-desk");
    return createRouterPool(sql, {
      tenantId,
      routerId: data.router_id,
      actorUserId: context.userId,
      draft: {
        name: String(data.name || ""),
        code: String(data.code || ""),
        cidr: String(data.cidr || ""),
        gateway: String(data.gateway || ""),
        first_ip: String(data.first_ip || ""),
        last_ip: String(data.last_ip || ""),
        access_type: String(data.access_type || ""),
        vlan_id: data.vlan_id as string | number | null,
        site_pop: String(data.site_pop || ""),
        description: String(data.description || ""),
        status: String(data.status || "active"),
        dns_servers: String(data.dns_servers || ""),
        package_id: String(data.package_id || ""),
      },
    });
  });

export const updateRouterPoolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; pool_id: string; confirm_impact?: boolean } & Record<string, unknown>) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { updateRouterPool } = await import("./router-desk");
    return updateRouterPool(sql, {
      tenantId,
      routerId: data.router_id,
      poolId: data.pool_id,
      actorUserId: context.userId,
      confirmImpact: Boolean(data.confirm_impact),
      draft: {
        name: String(data.name || ""),
        code: String(data.code || ""),
        cidr: String(data.cidr || ""),
        gateway: String(data.gateway || ""),
        first_ip: String(data.first_ip || ""),
        last_ip: String(data.last_ip || ""),
        access_type: String(data.access_type || ""),
        vlan_id: data.vlan_id as string | number | null,
        site_pop: String(data.site_pop || ""),
        description: String(data.description || ""),
        status: String(data.status || "active"),
        dns_servers: String(data.dns_servers || ""),
        package_id: String(data.package_id || ""),
      },
    });
  });

export const archiveRouterPoolFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; pool_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { archiveRouterPool } = await import("./router-desk");
    return archiveRouterPool(sql, {
      tenantId,
      routerId: data.router_id,
      poolId: data.pool_id,
      actorUserId: context.userId,
    });
  });

export const setPoolEnabledFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; pool_id: string; enabled: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { setPoolEnabled } = await import("./router-desk");
    return setPoolEnabled(sql, {
      tenantId,
      routerId: data.router_id,
      poolId: data.pool_id,
      actorUserId: context.userId,
      enabled: data.enabled,
    });
  });

export const setRouterEnabledFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; enabled: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { setRouterEnabled } = await import("./router-desk");
    return setRouterEnabled(sql, {
      tenantId,
      routerId: data.id,
      actorUserId: context.userId,
      enabled: data.enabled,
    });
  });

export const archiveRouterFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { archiveRouter } = await import("./router-desk");
    return archiveRouter(sql, {
      tenantId,
      routerId: data.id,
      actorUserId: context.userId,
    });
  });

export const testRouterConnectionFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const { testRouterConnection } = await import("./router-desk");
    return testRouterConnection(sql, tenantId, data.id);
  });


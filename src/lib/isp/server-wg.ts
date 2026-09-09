import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { assertPermission } from "./rbac";
import {
  ensureTenantHub,
  renderServerConfig,
  rotateTenantHub,
  saveTenantHub,
} from "./wireguard";
import { vpsPublishSteps } from "./vps-publish";
import { requireWorkspace as requireWs } from "./workspace";

export const getWireGuardHub = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.read");
    const hub = await ensureTenantHub(sql, tenantId);
    return hub;
  });

export const saveWireGuardHub = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { endpoint_host: string; listen_port: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "wireguard.manage");
    return saveTenantHub(sql, tenantId, {
      endpointHost: data.endpoint_host,
      listenPort: Number(data.listen_port) || 51820,
    });
  });

export const rotateWireGuardHub = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "wireguard.manage");
    return rotateTenantHub(sql, tenantId);
  });

export const downloadWireGuardServer = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "wireguard.manage");
    return renderServerConfig(sql, tenantId);
  });

export const getVpsPublishGuide = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role, tenantName } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const [ten] = await sql<{ public_base_url: string; support_email: string; wg_endpoint_host: string }>`
      select public_base_url, support_email, wg_endpoint_host from tenants where id = ${tenantId}`;
    return {
      tenantName,
      ...vpsPublishSteps({
        domain: ten?.public_base_url || ten?.wg_endpoint_host || "",
        email: ten?.support_email || "",
      }),
    };
  });


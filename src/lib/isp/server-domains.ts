import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  disableTenantDomain,
  enableTenantDomain,
  generateTenantSubdomain,
  loadDomainDesk,
  removeTenantDomain,
  revokeTenantDomain,
  saveCentralDomainSettings,
  serializeDomain,
  setDomainPrimary,
  setTenantCustomDomain,
  testPublicUrl,
  verifyTenantDomainDns,
  verifyTenantDomainHttps,
} from "./domain-manage";
import { previewTenantDomain } from "./domain-resolve";
import { assertPermission } from "./rbac";
import { requirePlatformActor } from "./platform";
import { applyRls } from "./rls";
import { requireWorkspace } from "./workspace";
import { getSql } from "@/lib/db";

async function platformSql(userId: string) {
  const sql = await getSql();
  await applyRls(sql, { bypass: true });
  const actor = await requirePlatformActor(sql, userId);
  return { sql, ...actor };
}

export const getDomainDeskFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql } = await platformSql(context.userId);
    return loadDomainDesk(sql);
  });

export const saveCentralDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { app_public_url?: string; tenant_subdomain_base?: string; central_domain_only?: boolean }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const cfg = await saveCentralDomainSettings(sql, context.userId, data);
    return { ...cfg, desk: await loadDomainDesk(sql) };
  });

export const generateSubdomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; slug?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await generateTenantSubdomain(sql, {
      tenantId: data.tenant_id,
      actorUserId: context.userId,
      slug: data.slug,
    });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const setCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { tenant_id: string; hostname: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await setTenantCustomDomain(sql, {
      tenantId: data.tenant_id,
      hostname: data.hostname,
      actorUserId: context.userId,
    });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const verifyDomainDnsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const result = await verifyTenantDomainDns(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { ...result, desk: await loadDomainDesk(sql) };
  });

export const verifyDomainHttpsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const result = await verifyTenantDomainHttps(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { ...result, desk: await loadDomainDesk(sql) };
  });

export const setDomainPrimaryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await setDomainPrimary(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const disableDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await disableTenantDomain(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const revokeDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await revokeTenantDomain(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const enableDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const row = await enableTenantDomain(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { domain: serializeDomain(row, true), desk: await loadDomainDesk(sql) };
  });

export const removeDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { domain_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    const result = await removeTenantDomain(sql, { domainId: data.domain_id, actorUserId: context.userId });
    return { ...result, desk: await loadDomainDesk(sql) };
  });

export const testDomainUrlFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { origin?: string; domain_id?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql } = await platformSql(context.userId);
    return testPublicUrl(sql, { origin: data.origin, domainId: data.domain_id });
  });

export const previewWorkspaceDomainFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "routers.read");
    return previewTenantDomain(sql, tenantId, "router_bootstrap");
  });

export const requestTenantCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { hostname: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "settings.manage");
    const row = await setTenantCustomDomain(sql, {
      tenantId,
      hostname: data.hostname,
      actorUserId: context.userId,
    });
    return {
      domain: serializeDomain(row, true),
      preview: await previewTenantDomain(sql, tenantId, "public_api"),
    };
  });

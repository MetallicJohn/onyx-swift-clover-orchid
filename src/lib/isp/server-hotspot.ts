import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { loadHotspotDashboard } from "./hotspot-dashboard";
import {
  getHotspotPortalSettings,
  saveHotspotPortalSettings,
  generateHotspotFiles,
  loadHotspotPackages,
  loadHotspotBuyContext,
  listHotspotPortalRouters,
  recordHotspotDeployment,
  latestHotspotDeployment,
  interpretHotspotDeploy,
  hotspotDeployVerifyUrl,
  substituteHotspotVars,
  type HotspotPortalPatch,
} from "./hotspot-portal";
import { HOTSPOT_HTML_FILES } from "./hotspot-dashboard-format";
import { queueCompiledCommand } from "./mikrotik";
import { assertPermission, hasPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

async function publicOrigin(sql: Awaited<ReturnType<typeof requireWs>>["sql"], tenantId: string) {
  const { tenantPublicOriginOrEmpty } = await import("./domain-resolve");
  return (await tenantPublicOriginOrEmpty(sql, tenantId, "public_api")).replace(/\/$/, "");
}

export const getHotspotDashboardFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const canRevenue = hasPermission(role, "payments.read");
    const canRouters = hasPermission(role, "routers.read");
    const canSessions = hasPermission(role, "radius.manage");
    const dashboard = await loadHotspotDashboard(sql, {
      tenantId,
      canRevenue,
      canRouters,
      canSessions,
    });
    return {
      dashboard,
      can: {
        revenue: canRevenue,
        routers: canRouters,
        sessions: canSessions,
        customers: hasPermission(role, "customers.read"),
        deploy: hasPermission(role, "routers.manage"),
        vouchers: hasPermission(role, "services.manage"),
      },
    };
  });

export const getHotspotPortalFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const [settings, packages, routers, deployment, origin, buy] = await Promise.all([
      getHotspotPortalSettings(sql, tenantId),
      loadHotspotPackages(sql, tenantId),
      listHotspotPortalRouters(sql, tenantId),
      latestHotspotDeployment(sql, tenantId),
      publicOrigin(sql, tenantId),
      loadHotspotBuyContext(sql, tenantId),
    ]);
    let verdict = deployment
      ? interpretHotspotDeploy({ commandStatus: deployment.status, commandResult: deployment.result, verified: deployment.verified })
      : null;
    if (deployment?.command_id) {
      const [cmd] = await sql<{ status: string; result: string }>`
        select status, coalesce(result,'') as result from agent_commands
        where id = ${deployment.command_id} and tenant_id = ${tenantId}`;
      if (cmd) {
        verdict = interpretHotspotDeploy({
          commandStatus: cmd.status,
          commandResult: cmd.result,
          verified: deployment.verified,
          simulated: /simulated REST/i.test(cmd.result),
        });
      }
    }
    const files = generateHotspotFiles(settings, packages, buy);
    return {
      settings,
      packages,
      routers,
      files,
      file_names: HOTSPOT_HTML_FILES,
      deployment: deployment
        ? {
            ...deployment,
            verdict,
          }
        : null,
      html_base: origin ? `${origin}/api/v1/hotspot/html` : "",
      can_deploy: hasPermission(role, "routers.manage"),
    };
  });

export const saveHotspotPortalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: HotspotPortalPatch) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const saved = await saveHotspotPortalSettings(sql, tenantId, data);
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${context.userId}, ${"hotspot.portal.saved"}, ${"hotspot_portal"}, ${tenantId}, ${"Hotspot login page saved"})`;
    const packages = await loadHotspotPackages(sql, tenantId);
    const buy = await loadHotspotBuyContext(sql, tenantId);
    return { settings: saved, files: generateHotspotFiles(saved, packages, buy) };
  });

export const previewHotspotPortalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: HotspotPortalPatch & { file?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const current = await getHotspotPortalSettings(sql, tenantId);
    const merged = { ...current, ...data };
    const packages = await loadHotspotPackages(sql, tenantId);
    const buy = await loadHotspotBuyContext(sql, tenantId);
    const files = generateHotspotFiles(merged, packages, buy);
    const file = data.file && data.file in files ? data.file : "login.html";
    const raw = files[file as keyof typeof files];
    return { file, html: file === "md5.js" ? raw : substituteHotspotVars(raw), files };
  });

export const deployHotspotPortalFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    assertPermission(role, "routers.manage");
    const [router] = await sql<{
      id: string;
      name: string;
      enroll_token: string;
      role: string;
    }>`select id, name, coalesce(enroll_token,'') as enroll_token, role
       from routers where id = ${data.router_id} and tenant_id = ${tenantId} and archived_at is null`;
    if (!router) throw new Error("Router not found");
    if (router.role !== "hotspot") throw new Error("Select a router whose role is Hotspot.");
    if (!router.enroll_token) throw new Error("This router has no enroll token. Bootstrap it first.");
    const origin = await publicOrigin(sql, tenantId);
    if (!origin) throw new Error("Set a public API domain before deploying hotspot pages.");
    const settings = await getHotspotPortalSettings(sql, tenantId);
    const packages = await loadHotspotPackages(sql, tenantId);
    const buy = await loadHotspotBuyContext(sql, tenantId);
    const files = generateHotspotFiles(settings, packages, { ...buy, origin });
    const depId = await recordHotspotDeployment(sql, {
      tenantId,
      routerId: router.id,
      commandId: null,
      status: "queued",
      result: "",
      verified: false,
    });
    const payload = {
      files: HOTSPOT_HTML_FILES,
      html_base: `${origin}/api/v1/hotspot/html`,
      token: router.enroll_token,
      dst_dir: "hotspot",
      deployment_id: depId,
      verify_ok: hotspotDeployVerifyUrl(origin, { token: router.enroll_token, id: depId, ok: true }),
      verify_fail: hotspotDeployVerifyUrl(origin, { token: router.enroll_token, id: depId, ok: false }),
    };
    const queued = await queueCompiledCommand(sql, tenantId, router.id, "hotspot.portal.deploy", payload, context.userId);
    await sql`update hotspot_deployments set command_id = ${queued.id}, updated_at = now()
      where id = ${depId} and tenant_id = ${tenantId}`;
    await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
      values (${nid("aud")}, ${tenantId}, ${context.userId}, ${"hotspot.portal.deploy"}, ${"router"}, ${router.id}, ${`Queued hotspot page deploy to ${router.name}`})`;
    const verdict = interpretHotspotDeploy({ commandStatus: queued.status, commandResult: "", verified: false });
    return {
      id: depId,
      command_id: queued.id,
      router_id: router.id,
      router_name: router.name,
      status: verdict.status,
      verified: false,
      message: verdict.message,
      files: Object.keys(files),
    };
  });

export const pollHotspotDeployFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d?: { router_id?: string }) => d || {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "radius.manage");
    const row = await latestHotspotDeployment(sql, tenantId, data.router_id);
    if (!row) return { deployment: null, verdict: null };
    let commandStatus = row.status;
    let commandResult = row.result;
    let simulated = false;
    if (row.command_id) {
      const [cmd] = await sql<{ status: string; result: string }>`
        select status, coalesce(result,'') as result from agent_commands
        where id = ${row.command_id} and tenant_id = ${tenantId}`;
      if (cmd) {
        commandStatus = cmd.status;
        commandResult = cmd.result;
        simulated = /simulated REST/i.test(cmd.result);
      }
    }
    const verdict = interpretHotspotDeploy({
      commandStatus,
      commandResult,
      verified: row.verified,
      simulated,
    });
    if (verdict.verified && !row.verified) {
      await sql`update hotspot_deployments set verified = true, status = 'verified', result = ${verdict.message}, updated_at = now()
        where id = ${row.id} and tenant_id = ${tenantId}`;
    } else if (verdict.status !== row.status) {
      await sql`update hotspot_deployments set status = ${verdict.status}, result = ${verdict.message}, updated_at = now()
        where id = ${row.id} and tenant_id = ${tenantId}`;
    }
    return {
      deployment: { ...row, status: verdict.status, verified: verdict.verified, result: verdict.message },
      verdict,
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { compileMikrotik, compileRow, curlForOps, executeRestOps, queueCompiledCommand, approveCommand } from "./mikrotik";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

function hint(secret: string) {
  if (!secret) return "";
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export const getRouterApi = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [r] = await sql<{
      id: string;
      name: string;
      identity: string;
      enroll_token: string;
      api_user: string;
      api_password: string;
      api_port: number;
      api_host: string;
      wg_address: string;
    }>`select id, name, identity, enroll_token, api_user, api_password, api_port, api_host, wg_address
       from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
    if (!r) throw new Error("Router not found");
    const [t] = await sql<{ public_base_url: string }>`select public_base_url from tenants where id = ${tenantId}`;
    const base = (t?.public_base_url || "").replace(/\/$/, "");
    return {
      id: r.id,
      name: r.name,
      identity: r.identity,
      api_user: r.api_user || "gridline",
      api_port: r.api_port || 443,
      api_host: r.api_host,
      wg_address: r.wg_address,
      api_password_set: Boolean(r.api_password),
      api_password_hint: hint(r.api_password),
      json_pull: base ? `${base}/api/agent/pull?token=${encodeURIComponent(r.enroll_token)}` : "",
      script_pull: base ? `${base}/api/agent/script?token=${encodeURIComponent(r.enroll_token)}` : "",
    };
  });

export const saveRouterApi = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; api_user: string; api_password: string; api_port: number; api_host: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [r] = await sql<{ id: string; api_password: string }>`
      select id, api_password from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
    if (!r) throw new Error("Router not found");
    const password =
      !data.api_password || data.api_password.startsWith("••••") ? r.api_password : data.api_password;
    await sql`update routers set
      api_user = ${data.api_user.trim() || "gridline"},
      api_password = ${password},
      api_port = ${data.api_port || 443},
      api_host = ${data.api_host.trim()}
      where id = ${r.id}`;
    return { ok: true };
  });

export const queueRouterCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; kind: string; payload: Record<string, unknown> }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const [r] = await sql<{ id: string }>`select id from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
    if (!r) throw new Error("Router not found");
    return queueCompiledCommand(sql, tenantId, r.id, data.kind, data.payload, context.userId);
  });

export const approveRouterCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    return approveCommand(sql, tenantId, data.id, context.userId);
  });

export const previewRouterCommand = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: string; payload: Record<string, unknown>; host?: string; user?: string }) => d)
  .handler(async ({ data }) => {
    const compiled = compileMikrotik(data.kind, data.payload);
    return {
      ...compiled,
      curl: curlForOps(data.host || "https://10.200.0.2", data.user || "gridline", compiled.rest),
    };
  });

export const runRouterApi = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { router_id: string; command_id?: string; kind?: string; payload?: Record<string, unknown> }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "routers.manage");
    const [r] = await sql<{
      id: string;
      api_user: string;
      api_password: string;
      api_port: number;
      api_host: string;
      wg_address: string;
    }>`select id, api_user, api_password, api_port, api_host, wg_address
       from routers where id = ${data.router_id} and tenant_id = ${tenantId}`;
    if (!r) throw new Error("Router not found");

    let compiled = data.kind ? compileMikrotik(data.kind, data.payload || {}) : null;
    if (data.command_id) {
      const [cmd] = await sql<{ id: string; kind: string; payload: string }>`
        select id, kind, payload from agent_commands where id = ${data.command_id} and tenant_id = ${tenantId}`;
      if (!cmd) throw new Error("Command not found");
      compiled = compileRow(cmd.id, cmd.kind, cmd.payload);
    }
    if (!compiled) throw new Error("Nothing to run");

    const host = r.api_host || r.wg_address.replace(/\/\d+$/, "");
    if (!host || !r.api_password) {
      if (data.command_id) {
        await sql`update agent_commands set status = 'acked', acked_at = now(), result = 'simulated REST (no api_host)'
          where id = ${data.command_id}`;
      }
      return { simulated: true, rest: compiled.rest, note: "No API host — command compiled and marked simulated." };
    }

    const results = await executeRestOps(host, r.api_user || "gridline", r.api_password, r.api_port || 443, compiled.rest);
    if (data.command_id) {
      await sql`update agent_commands set status = 'acked', acked_at = now(), result = ${JSON.stringify(results).slice(0, 2000)}
        where id = ${data.command_id}`;
    }
    return { simulated: false, results, rest: compiled.rest };
  });

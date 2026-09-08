import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { agentPullUrl, agentScript, enrollFields } from "./agent";
import { ensureOpsSchema } from "./ops-schema";

async function requireWs(userId: string) {
  const sql = await getSql();
  await ensureOpsSchema(sql);
  const members = await sql<{ tenant_id: string }>`
    select tenant_id from tenant_members where user_id = ${userId} order by created_at asc limit 1`;
  if (!members[0]) throw new Error("No workspace");
  return { sql, tenantId: members[0].tenant_id };
}

type RouterEnroll = {
  id: string;
  name: string;
  identity: string;
  location: string;
  role: string;
  enroll_token: string;
  wg_public: string;
  wg_address: string;
};

async function loadRouter(sql: Awaited<ReturnType<typeof requireWs>>["sql"], tenantId: string, id: string) {
  const [r] = await sql<RouterEnroll>`
    select id, name, identity, location, role, enroll_token, wg_public, wg_address
    from routers where id = ${id} and tenant_id = ${tenantId}`;
  if (!r) throw new Error("Router not found");
  return r;
}

async function scriptFor(
  sql: Awaited<ReturnType<typeof requireWs>>["sql"],
  tenantId: string,
  r: RouterEnroll,
) {
  const [t] = await sql<{ public_base_url: string }>`select public_base_url from tenants where id = ${tenantId}`;
  return agentScript({
    name: r.name,
    identity: r.identity,
    token: r.enroll_token,
    wgPublic: r.wg_public,
    wgAddress: r.wg_address || "10.200.0.2/32",
    pullUrl: agentPullUrl(t?.public_base_url || "", r.enroll_token),
  });
}

export const updateRouter = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; name: string; location: string; identity: string; role: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    if (!data.name.trim()) throw new Error("Name is required");
    const r = await loadRouter(sql, tenantId, data.id);
    const identity = data.identity.trim() || data.name.trim().toLowerCase();
    await sql`update routers set
      name = ${data.name.trim()},
      location = ${data.location.trim()},
      identity = ${identity},
      role = ${data.role || r.role}
      where id = ${r.id} and tenant_id = ${tenantId}`;
    const next = await loadRouter(sql, tenantId, r.id);
    return { ok: true, script: await scriptFor(sql, tenantId, next) };
  });

export const copyRouterScript = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; rotate?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const r = await loadRouter(sql, tenantId, data.id);
    if (data.rotate) {
      const enroll = enrollFields(r.name);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}, wg_status = 'pending'
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadRouter(sql, tenantId, r.id);
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    if (!r.enroll_token) {
      const enroll = enrollFields(r.name);
      await sql`update routers set enroll_token = ${enroll.token}, wg_public = ${enroll.wg_public}
        where id = ${r.id} and tenant_id = ${tenantId}`;
      const next = await loadRouter(sql, tenantId, r.id);
      return { script: await scriptFor(sql, tenantId, next), token: next.enroll_token, rotated: true };
    }
    return { script: await scriptFor(sql, tenantId, r), token: r.enroll_token, rotated: false };
  });

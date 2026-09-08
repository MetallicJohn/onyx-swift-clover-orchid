import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { nid } from "@/lib/utils";
import { kopoAccessToken, loadKopo } from "./kopokopo";
import { ensureOpsSchema } from "./ops-schema";

async function requireWs(userId: string) {
  const sql = await getSql();
  await ensureOpsSchema(sql);
  const members = await sql<{ tenant_id: string }>`
    select tenant_id from tenant_members where user_id = ${userId} order by created_at asc limit 1`;
  if (!members[0]) throw new Error("No workspace");
  return { sql, tenantId: members[0].tenant_id };
}

export const getKopokopo = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const [row] = await sql<{
      id: string;
      enabled: boolean;
      sandbox: boolean;
      client_id: string;
      client_secret: string;
      till_number: string;
    }>`select id, enabled, sandbox, client_id, client_secret, till_number
       from payment_providers where tenant_id = ${tenantId} and kind = 'kopokopo'`;
    if (!row) {
      await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox)
        values (${nid("prv")}, ${tenantId}, 'kopokopo', 'Kopo Kopo', true, true)`;
      return {
        enabled: true,
        sandbox: true,
        client_id: "",
        till_number: "",
        client_secret_set: false,
        client_secret_hint: "",
      };
    }
    const secret = row.client_secret;
    return {
      enabled: row.enabled,
      sandbox: row.sandbox,
      client_id: row.client_id,
      till_number: row.till_number,
      client_secret_set: Boolean(secret),
      client_secret_hint: secret ? (secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`) : "",
    };
  });

export const saveKopokopo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    enabled: boolean;
    sandbox: boolean;
    client_id: string;
    client_secret: string;
    till_number: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    await ensureOpsSchema(sql);
    const [row] = await sql<{ id: string; client_secret: string }>`
      select id, client_secret from payment_providers where tenant_id = ${tenantId} and kind = 'kopokopo'`;
    const keep = !data.client_secret || data.client_secret.startsWith("••••");
    const secret = keep ? (row?.client_secret ?? "") : data.client_secret;
    if (!row) {
      await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number)
        values (${nid("prv")}, ${tenantId}, 'kopokopo', 'Kopo Kopo', ${data.enabled}, ${data.sandbox}, ${data.client_id.trim()}, ${secret}, ${data.till_number.trim()})`;
    } else {
      await sql`update payment_providers set
        enabled = ${data.enabled},
        sandbox = ${data.sandbox},
        client_id = ${data.client_id.trim()},
        client_secret = ${secret},
        till_number = ${data.till_number.trim()}
        where id = ${row.id}`;
    }
    return { ok: true };
  });

export const testKopokopo = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId } = await requireWs(context.userId);
    const cfg = await loadKopo(sql, tenantId);
    if (!cfg?.client_id || !cfg.client_secret) throw new Error("Save client id and secret first");
    const token = await kopoAccessToken(cfg);
    return { ok: true, host: cfg.sandbox ? "sandbox.kopokopo.com" : "api.kopokopo.com", token_prefix: token.slice(0, 8) };
  });

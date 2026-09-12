import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { clearTenantOriginCache } from "./auth-origins";
import { loadMpesa, mpesaAccessToken } from "./mpesa";
import { hint, seal } from "./secrets";
import { tenantPayUrls } from "./webhooks";
import { requireWorkspace as requireWs } from "./workspace";
import { assertPermission } from "./rbac";

export const getMpesa = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const [row] = await sql<{
      enabled: boolean;
      sandbox: boolean;
      client_id: string;
      client_secret: string;
      till_number: string;
      passkey: string;
      stk_type: string;
    }>`select enabled, sandbox, client_id, client_secret, till_number, passkey, stk_type
       from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`;
    if (!row) {
      await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, stk_type)
        values (${nid("prv")}, ${tenantId}, 'mpesa', 'M-Pesa Daraja', true, true, 'paybill')`;
    }
    const cfg = row ?? {
      enabled: true,
      sandbox: true,
      client_id: "",
      client_secret: "",
      till_number: "",
      passkey: "",
      stk_type: "paybill",
    };
    const urls = await tenantPayUrls(sql, tenantId);
    return {
      enabled: cfg.enabled,
      sandbox: cfg.sandbox,
      client_id: cfg.client_id,
      till_number: cfg.till_number,
      stk_type: cfg.stk_type || "paybill",
      client_secret_set: Boolean(cfg.client_secret),
      client_secret_hint: hint(cfg.client_secret),
      passkey_set: Boolean(cfg.passkey),
      passkey_hint: hint(cfg.passkey),
      public_base_url: urls.public_base_url,
      callback_url: urls.mpesa,
      kopokopo_callback_url: urls.kopokopo,
      slug: urls.slug,
    };
  });

export const saveMpesa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: {
    enabled: boolean;
    sandbox: boolean;
    client_id: string;
    client_secret: string;
    till_number: string;
    passkey: string;
    stk_type: string;
  }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const [row] = await sql<{ id: string; client_secret: string; passkey: string }>`
      select id, client_secret, passkey from payment_providers where tenant_id = ${tenantId} and kind = 'mpesa'`;
    const keep = (incoming: string, existing: string) =>
      !incoming || incoming.startsWith("••••") ? existing : incoming;
    const secret = seal(keep(data.client_secret, row?.client_secret ?? ""));
    const passkey = seal(keep(data.passkey, row?.passkey ?? ""));
    const stk = data.stk_type === "till" ? "till" : "paybill";
    if (!row) {
      await sql`insert into payment_providers (id, tenant_id, kind, label, enabled, sandbox, client_id, client_secret, till_number, passkey, stk_type)
        values (${nid("prv")}, ${tenantId}, 'mpesa', 'M-Pesa Daraja', ${data.enabled}, ${data.sandbox}, ${data.client_id.trim()}, ${secret}, ${data.till_number.trim()}, ${passkey}, ${stk})`;
    } else {
      await sql`update payment_providers set
        enabled = ${data.enabled},
        sandbox = ${data.sandbox},
        client_id = ${data.client_id.trim()},
        client_secret = ${secret},
        till_number = ${data.till_number.trim()},
        passkey = ${passkey},
        stk_type = ${stk}
        where id = ${row.id}`;
    }
    return { ok: true };
  });

export const testMpesa = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const cfg = await loadMpesa(sql, tenantId);
    if (!cfg?.client_id || !cfg.client_secret) throw new Error("Save consumer key and secret first");
    const token = await mpesaAccessToken(cfg);
    return {
      ok: true,
      host: cfg.sandbox ? "sandbox.safaricom.co.ke" : "api.safaricom.co.ke",
      token_prefix: token.slice(0, 8),
    };
  });

export const savePublicBase = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { public_base_url: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    const url = data.public_base_url.trim().replace(/\/$/, "");
    if (url && !/^https:\/\//i.test(url)) throw new Error("Public site URL must start with https://");
    await sql`update tenants set public_base_url = ${url} where id = ${tenantId}`;
    clearTenantOriginCache();
    return tenantPayUrls(sql, tenantId);
  });

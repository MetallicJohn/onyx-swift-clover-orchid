import type { Sql } from "./events";
import { kopoIncomingPayment, kopoPaymentStatus, loadKopo } from "./kopokopo";
import { loadMpesa, mpesaStkPush, mpesaStkQuery } from "./mpesa";

export type StkRequest = {
  tenantId: string;
  phone: string;
  amount: number;
  invoiceId: string;
  invoiceNumber: string;
  firstName: string;
  lastName: string;
  email?: string;
  callbackUrl: string;
};

export type StkAdapter = {
  kind: string;
  start: (sql: Sql, req: StkRequest) => Promise<{ checkout_id: string; note: string }>;
  query: (
    sql: Sql,
    opts: { tenantId: string; checkoutId: string },
  ) => Promise<{ ok: boolean; reference?: string; error?: string }>;
};

const adapters = new Map<string, StkAdapter>();

export function registerStk(adapter: StkAdapter) {
  adapters.set(adapter.kind, adapter);
}

export function stkAdapter(kind: string) {
  return adapters.get(kind) ?? null;
}

registerStk({
  kind: "mpesa",
  async start(sql, req) {
    const cfg = await loadMpesa(sql, req.tenantId);
    if (cfg && !cfg.enabled) throw new Error("M-Pesa is disabled");
    if (cfg && !cfg.sandbox && !req.callbackUrl) {
      throw new Error("Set the public site URL in Settings — Daraja needs a callback URL");
    }
    if (!cfg?.client_id || !cfg.client_secret || !cfg.passkey) {
      return { checkout_id: "", note: "M-Pesa sandbox (no keys) — simulated STK" };
    }
    try {
      const pushed = await mpesaStkPush(cfg, {
        phone: req.phone,
        amount: req.amount,
        account: req.invoiceNumber || "BILL",
        description: "Internet bill",
        callbackUrl: req.callbackUrl || undefined,
      });
      return { checkout_id: pushed.checkout_id, note: pushed.message };
    } catch (e) {
      if (!cfg.sandbox) throw e;
      return { checkout_id: "", note: e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback" };
    }
  },
  async query(sql, opts) {
    if (opts.checkoutId.startsWith("ws_")) return { ok: true, reference: opts.checkoutId };
    const cfg = await loadMpesa(sql, opts.tenantId);
    if (!cfg?.client_id || !cfg.client_secret || !cfg.passkey) return { ok: true, reference: opts.checkoutId };
    const q = await mpesaStkQuery(cfg, opts.checkoutId);
    if (!q.ok) return { ok: false, error: q.resultDesc || `M-Pesa ResultCode ${q.resultCode}` };
    return { ok: true, reference: opts.checkoutId };
  },
});

registerStk({
  kind: "kopokopo",
  async start(sql, req) {
    const cfg = await loadKopo(sql, req.tenantId);
    if (!cfg || !cfg.enabled) throw new Error("Kopo Kopo is disabled");
    if (!cfg.sandbox && !req.callbackUrl) {
      throw new Error("Set the public site URL in Settings — Kopo Kopo needs a callback URL");
    }
    if (!cfg.client_id || !cfg.client_secret) {
      return { checkout_id: "", note: "kopokopo sandbox (no keys) — simulated STK" };
    }
    try {
      const pushed = await kopoIncomingPayment(cfg, {
        phone: req.phone,
        amount: req.amount,
        firstName: req.firstName,
        lastName: req.lastName,
        email: req.email,
        invoiceId: req.invoiceId,
        invoiceNumber: req.invoiceNumber,
        callbackUrl: req.callbackUrl || undefined,
      });
      return {
        checkout_id: pushed.id || pushed.location,
        note: cfg.sandbox ? "kopokopo sandbox STK sent" : "kopokopo STK sent",
      };
    } catch (e) {
      if (!cfg.sandbox) throw e;
      return { checkout_id: "", note: e instanceof Error ? `sandbox fallback: ${e.message}` : "sandbox fallback" };
    }
  },
  async query(sql, opts) {
    const cfg = await loadKopo(sql, opts.tenantId);
    if (!cfg?.client_id || !cfg.client_secret) return { ok: true, reference: opts.checkoutId };
    const st = await kopoPaymentStatus(cfg, opts.checkoutId);
    if (st.status && st.status !== "Success" && st.status !== "Received") {
      return { ok: false, error: `Kopo Kopo status: ${st.status}` };
    }
    return { ok: true, reference: st.reference || opts.checkoutId };
  },
});

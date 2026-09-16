import { queueCompiledCommand } from "./mikrotik.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export type RosIssue = { severity: "error" | "warning"; message: string };

export const ROUTER_STALE_MS = 3 * 60_000;
export const ROUTER_UNREACHABLE_MS = 10 * 60_000;

export function validateRosScript(script: string): RosIssue[] {
  const issues: RosIssue[] = [];
  const text = String(script || "");
  if (!text.trim()) {
    issues.push({ severity: "error", message: "empty script" });
    return issues;
  }
  if (/\/rest\//.test(text) || /^\s*\?[a-z]+=/m.test(text)) {
    issues.push({ severity: "error", message: "REST/API syntax is not RouterOS script" });
  }
  if (/check-certificate\s*=\s*no/i.test(text)) {
    issues.push({ severity: "error", message: "certificate validation must not be disabled" });
  }
  let braces = 0;
  let inStr = false;
  let escape = false;
  for (const ch of text) {
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") braces += 1;
    if (ch === "}") braces -= 1;
    if (braces < 0) {
      issues.push({ severity: "error", message: "unbalanced }" });
      braces = 0;
    }
  }
  if (inStr) issues.push({ severity: "error", message: "unterminated string" });
  if (braces !== 0) issues.push({ severity: "error", message: "unbalanced braces" });
  if (/\bon-error=(?!\{)/.test(text)) {
    issues.push({ severity: "error", message: "on-error must be a RouterOS block" });
  }
  return issues;
}

export function commandDiff(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(a[key] ?? null) !== JSON.stringify(b[key] ?? null)) changed.push(key);
  }
  return { changed: changed.sort(), same: changed.length === 0 };
}

export function inverseCommand(kind: string, payload: Record<string, unknown>) {
  const [method, action = ""] = kind.split(".");
  if (!method || kind === "package.sync" || kind === "identity.set" || kind === "reboot" || kind === "resource.snapshot" || kind === "raw.script") {
    return null;
  }
  if (action === "upsert" || action === "enable") {
    return { kind: `${method}.disable`, payload: { ...payload, status: "suspended", enabled: false } };
  }
  if (action === "disable" || action === "disconnect") {
    return { kind: `${method}.upsert`, payload: { ...payload, status: "active", enabled: true } };
  }
  return null;
}

export async function rollbackCommand(sql: Sql, tenantId: string, commandId: string, requestedBy = "") {
  const [cmd] = await sql<{ id: string; router_id: string; kind: string; payload: string; status: string }>`
    select id, router_id, kind, payload, status from agent_commands
    where id = ${commandId} and tenant_id = ${tenantId}`;
  if (!cmd) throw new Error("Command not found");
  if (cmd.status !== "acked" && cmd.status !== "sent") throw new Error("Only applied commands can be rolled back");
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(cmd.payload || "{}") as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const inverse = inverseCommand(cmd.kind, payload);
  if (!inverse) throw new Error("This command cannot be rolled back");
  const queued = await queueCompiledCommand(sql, tenantId, cmd.router_id, inverse.kind, inverse.payload, requestedBy);
  await sql`update agent_commands set result = ${`rollback of ${cmd.id}`} where id = ${queued.id}`;
  return queued;
}

export function routerReachability(lastSeen: string | null, now = Date.now(), status = "") {
  if (status === "pending" || status === "enrolling") return lastSeen ? "connected" : "pending";
  if (!lastSeen) return "unreachable";
  const t = Date.parse(lastSeen);
  if (Number.isNaN(t)) return "unreachable";
  const age = now - t;
  if (age <= ROUTER_STALE_MS) return "connected";
  if (age <= ROUTER_UNREACHABLE_MS) return "stale";
  return "unreachable";
}

export async function markUnreachableRouters(sql: Sql, tenantId: string, now = new Date()) {
  const rows = await sql<{ id: string; last_seen: string | null; wg_status: string }>`
    select id, last_seen::text as last_seen, wg_status from routers where tenant_id = ${tenantId}`;
  let marked = 0;
  for (const row of rows) {
    const state = routerReachability(row.last_seen, now.getTime(), row.wg_status);
    if (state === "unreachable" && row.wg_status !== "unreachable") {
      await sql`update routers set wg_status = 'unreachable' where id = ${row.id}`;
      marked += 1;
    }
  }
  return { marked };
}

export function restOpsUnreachable(results: Array<{ status: number }>) {
  return results.length > 0 && results.every((r) => r.status === 0);
}

export function duplicateRisks(script: string) {
  const risks: string[] = [];
  const names = [...script.matchAll(/\/queue simple add[^\n]*name=([^\s\\]+)/g)].map((m) => m[1] || "");
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) risks.push(`duplicate queue ${name}`);
    seen.add(name);
  }
  if (/\/ip firewall address-list add/.test(script) && !/\[:len \[\/ip firewall address-list find/.test(script)) {
    risks.push("address-list add without existence check");
  }
  if (/\/ppp secret add/.test(script) && !/\[:len \[\/ppp secret find/.test(script)) {
    risks.push("ppp secret add without existence check");
  }
  if (/\/ip hotspot user add/.test(script) && !/\[:len \[\/ip hotspot user find/.test(script)) {
    risks.push("hotspot user add without existence check");
  }
  if (/\/queue type add/.test(script) && !/\[:len \[\/queue type find/.test(script)) {
    risks.push("queue type add without existence check");
  }
  return risks;
}

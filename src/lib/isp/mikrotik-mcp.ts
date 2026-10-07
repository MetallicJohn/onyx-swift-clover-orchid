import { nid } from "../utils.ts";
import { createChangePlan, formatPlan } from "./mikrotik-plans.ts";
import { hasPermission, type Permission } from "./rbac.ts";
import { routerosApiCommand } from "./routeros-api.ts";
import { open } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

export const MCP_PACKAGE = "@usex/mikrotik-mcp@6.4.0";
export const MCP_IMAGE = "alimaster/mikrotik-mcp:6.3.0";
export const TOOL_BUDGET = 20;

/** Application allowlist. The upstream catalogue is larger and stays closed. */
export const READ_TOOLS: Record<string, string[]> = {
  get_system_identity: ["/system/identity/print"],
  get_system_resources: ["/system/resource/print"],
  get_interfaces: ["/interface/print"],
  get_ip_addresses: ["/ip/address/print"],
  get_routes: ["/ip/route/print"],
  get_firewall_rules: ["/ip/firewall/filter/print"],
  get_nat_rules: ["/ip/firewall/nat/print"],
  get_mangle_rules: ["/ip/firewall/mangle/print"],
  get_queues: ["/queue/tree/print"],
  get_ppp_active: ["/ppp/active/print"],
  get_logs: ["/log/print"],
  get_dhcp_leases: ["/ip/dhcp-server/lease/print"],
  get_wireguard: ["/interface/wireguard/print"],
};

const BLOCKED = /remove|reset-configuration|factory-reset|wipe/i;

export type RiskClass = "READ" | "WRITE" | "WRITE_IDEMPOTENT" | "DESTRUCTIVE" | "DANGEROUS";

export type AiPolicy = {
  ai_enabled: boolean;
  ai_read_only: boolean;
  ai_write_enabled: boolean;
};

export type Diagnosis = {
  status: "ok" | "degraded" | "unknown";
  confidence: number | null;
  findings: string[];
  evidence: string[];
  recommended_actions: string[];
  changed: false;
};

const SECRET_VALUE = /(password|passphrase|private-key|private_key|psk|secret|community|token)\s*[=:]\s*\S+/gi;

export function redactSensitive(value: string) {
  return value
    .replace(SECRET_VALUE, (match) => match.replace(/[=:]\s*\S+/, "=••••"))
    .replace(/enc:v1:[A-Za-z0-9+/=]+/g, "enc:v1:••••")
    .slice(0, 4000);
}

export function toolRisk(toolName: string): RiskClass {
  const name = toolName.toLowerCase();
  if (BLOCKED.test(name)) return "DESTRUCTIVE";
  if (READ_TOOLS[toolName]) return "READ";
  if (/^get_|^list_|print/.test(name)) return "READ";
  return "WRITE";
}

export function assistantPermission(
  role: string,
  action: "view" | "chat" | "diagnose" | "plan" | "approve" | "execute" | "rollback" | "enable",
) {
  const perm: Permission =
    action === "view"
      ? "network.ai.view"
      : action === "chat"
        ? "network.ai.chat"
        : action === "diagnose"
          ? "network.ai.diagnose"
          : action === "plan"
            ? "network.ai.plan"
            : action === "approve"
              ? "network.ai.approve"
              : action === "execute"
                ? "network.ai.execute"
                : action === "rollback"
                  ? "network.ai.rollback"
                  : "routers.manage";
  return hasPermission(role, perm);
}

export function authorizeTool(role: string, policy: AiPolicy, toolName: string) {
  const risk = toolRisk(toolName);
  if (!assistantPermission(role, "diagnose")) return { ok: false as const, risk, error: "Forbidden" };
  if (!policy.ai_enabled) return { ok: false as const, risk, error: "AI is disabled for this router." };
  if (BLOCKED.test(toolName) || risk === "DESTRUCTIVE" || risk === "DANGEROUS") {
    return { ok: false as const, risk, error: "This operation is blocked. No configuration was changed." };
  }
  if (!READ_TOOLS[toolName] || risk !== "READ") {
    return {
      ok: false as const,
      risk,
      error:
        risk === "READ"
          ? "This operation is not currently supported by the controlled MikroTik Assistant."
          : "Router is in read-only mode. No configuration was changed.",
    };
  }
  return { ok: true as const, risk: "READ" as const };
}

export type RouterEvidence = {
  name: string;
  identity: string;
  cpu: number | null;
  memory: number | null;
  lastSeen: string | null;
  apiError: string;
  reachable: boolean | null;
  live: string[];
};

export function diagnoseFromEvidence(kind: string, row: RouterEvidence): Diagnosis {
  const evidence: string[] = [];
  if (row.cpu != null) evidence.push(`CPU ${row.cpu}%`);
  if (row.memory != null) evidence.push(`Memory ${row.memory}%`);
  evidence.push(row.lastSeen ? `Last seen ${row.lastSeen}` : "Last seen UNKNOWN");
  if (row.apiError) evidence.push(`API note: ${redactSensitive(row.apiError)}`);
  evidence.push(row.reachable === true ? "Overlay API reachable" : row.reachable === false ? "Router unreachable" : "Live RouterOS check UNKNOWN");
  for (const line of row.live) evidence.push(redactSensitive(line));

  const findings: string[] = [];
  let status: Diagnosis["status"] = "unknown";
  let confidence: number | null = null;
  if (row.reachable === false) {
    status = "degraded";
    confidence = 0.8;
    findings.push(`${row.name || "Router"} did not answer on the management overlay.`);
  } else if ((row.cpu ?? 0) >= 85) {
    status = "degraded";
    confidence = 0.74;
    findings.push("CPU is high on the stored health sample.");
  } else if (row.reachable === true && row.live.length) {
    status = "ok";
    confidence = 0.62;
    findings.push(`Read-only ${kind.replaceAll("_", " ")} completed. No single fault was proven.`);
  } else {
    findings.push("Evidence is incomplete. This is UNKNOWN, not a pass.");
  }
  if (kind === "diagnose_wan" && row.reachable !== true) {
    findings.push("WAN path was not measured. Utilization and packet loss are UNKNOWN.");
  }
  return {
    status,
    confidence,
    findings,
    evidence,
    recommended_actions:
      status === "unknown"
        ? ["Enable the assistant on this router and confirm the overlay API, then run the check again."]
        : ["No configuration has been changed."],
    changed: false,
  };
}

export function classifyAsk(prompt: string) {
  const text = prompt.toLowerCase();
  const write = /\b(delete|remove|disable|prefer|make |change|set |add |create )\b/.test(text);
  let kind = "diagnose_router";
  if (/wan|slow|internet/.test(text)) kind = /slow|internet/.test(text) ? "diagnose_slow_internet" : "diagnose_wan";
  else if (/pppoe/.test(text)) kind = "diagnose_pppoe";
  else if (/hotspot/.test(text)) kind = "diagnose_hotspot";
  else if (/firewall/.test(text)) kind = "diagnose_firewall";
  else if (/cpu|memory/.test(text)) kind = "diagnose_high_cpu";
  else if (/packet loss|loss/.test(text)) kind = "diagnose_packet_loss";
  else if (/route|routing/.test(text)) kind = "diagnose_routing";
  else if (/customer|offline/.test(text)) kind = "diagnose_customer";
  const tools =
    kind === "diagnose_firewall"
      ? ["get_firewall_rules", "get_nat_rules"]
      : kind === "diagnose_pppoe"
        ? ["get_ppp_active", "get_system_resources"]
        : kind === "diagnose_routing" || kind === "diagnose_wan" || kind === "diagnose_slow_internet"
          ? ["get_routes", "get_interfaces", "get_system_resources"]
          : ["get_system_identity", "get_system_resources", "get_interfaces"];
  return { write, kind, tools: tools.filter((tool) => READ_TOOLS[tool]).slice(0, 3) };
}

export function formatDiagnosis(diagnosis: Diagnosis) {
  const confidence = diagnosis.confidence == null ? "UNKNOWN" : `${Math.round(diagnosis.confidence * 100)}%`;
  return [
    "Finding",
    diagnosis.findings.join(" "),
    "",
    "Evidence",
    ...diagnosis.evidence.map((line) => `• ${line}`),
    "",
    "Likely cause",
    diagnosis.status === "unknown" ? "UNKNOWN" : diagnosis.findings[0] || "UNKNOWN",
    "",
    `Confidence: ${confidence}`,
    "",
    "Recommended action",
    ...diagnosis.recommended_actions,
    "",
    "No configuration has been changed.",
  ].join("\n");
}

type RouterRow = {
  id: string;
  name: string;
  identity: string;
  wg_address: string;
  api_user: string;
  api_password: string;
  api_port: number;
  cpu_pct: number;
  memory_pct: number | null;
  last_seen: string | null;
  api_last_error: string;
  ai_enabled: boolean;
  ai_read_only: boolean;
  ai_write_enabled: boolean;
};

export type AssistantRouter = {
  id: string;
  name: string;
  identity: string;
  location: string;
  wg_status: string;
  last_seen: string | null;
  cpu_pct: number;
  api_last_error: string;
  ai_enabled: boolean;
  ai_read_only: boolean;
  ai_write_enabled: boolean;
};

export async function loadAssistantDesk(sql: Sql, tenantId: string) {
  const rows = await sql<AssistantRouter>`
    select id, name, coalesce(identity, '') as identity, coalesce(location, '') as location,
           coalesce(wg_status, '') as wg_status, last_seen::text as last_seen,
           coalesce(cpu_pct, 0) as cpu_pct, coalesce(api_last_error, '') as api_last_error,
           coalesce(ai_enabled, false) as ai_enabled,
           coalesce(ai_read_only, true) as ai_read_only,
           coalesce(ai_write_enabled, false) as ai_write_enabled
    from routers
    where tenant_id = ${tenantId} and archived_at is null
    order by name`;
  return rows.map((row) => ({ ...row, api_last_error: redactSensitive(row.api_last_error) }));
}

export async function loadAssistantRouter(sql: Sql, tenantId: string, routerId: string) {
  const [row] = await sql<RouterRow>`
    select id, name, coalesce(identity, '') as identity, coalesce(wg_address, '') as wg_address,
           coalesce(api_user, '') as api_user, coalesce(api_password, '') as api_password,
           coalesce(api_port, 8728) as api_port, coalesce(cpu_pct, 0) as cpu_pct,
           (select memory_pct from router_health_snapshots h
             where h.router_id = routers.id and h.tenant_id = routers.tenant_id
             order by created_at desc limit 1) as memory_pct,
           last_seen::text as last_seen,
           coalesce(api_last_error, '') as api_last_error,
           coalesce(ai_enabled, false) as ai_enabled,
           coalesce(ai_read_only, true) as ai_read_only,
           coalesce(ai_write_enabled, false) as ai_write_enabled
    from routers where id = ${routerId} and tenant_id = ${tenantId} and archived_at is null`;
  return row || null;
}

async function auditTool(
  sql: Sql,
  row: {
    tenantId: string;
    userId: string;
    conversationId: string;
    requestId: string;
    routerId: string;
    tool: string;
    risk: string;
    args: string;
    result: string;
    status: string;
    error: string;
    started: number;
  },
) {
  await sql`insert into ai_tool_calls (
    id, tenant_id, user_id, conversation_id, request_id, router_id, tool_name, risk_class,
    arguments_redacted, result_redacted, status, duration_ms, error_code, completed_at
  ) values (
    ${nid("atc")}, ${row.tenantId}, ${row.userId}, ${row.conversationId}, ${row.requestId}, ${row.routerId},
    ${row.tool}, ${row.risk}, ${redactSensitive(row.args)}, ${redactSensitive(row.result)}, ${row.status},
    ${Date.now() - row.started}, ${row.error.slice(0, 120)}, now()
  )`;
}

async function readTool(router: RouterRow, tool: string) {
  const words = READ_TOOLS[tool];
  const host = router.wg_address.replace(/\/\d+$/, "");
  const password = open(router.api_password);
  if (!host || !password) return { ok: false, text: "Router unreachable" };
  const reply = await routerosApiCommand(
    { host, user: router.api_user || "ispsolutions-agent", password, port: router.api_port || 8728, timeoutMs: 4000 },
    words,
  );
  const text = reply.sentences
    .filter((sentence) => sentence.type === "re")
    .slice(0, 8)
    .map((sentence) =>
      Object.entries(sentence.attrs)
        .filter(([key]) => !/password|secret|private/i.test(key))
        .map(([key, value]) => `${key}=${value}`)
        .join(" "),
    )
    .join("\n");
  return { ok: reply.type !== "trap" && reply.type !== "fatal", text: text || reply.attrs.message || reply.type };
}

export async function runAssistantAsk(
  sql: Sql,
  input: { tenantId: string; userId: string; role: string; routerId: string; prompt: string; conversationId?: string },
) {
  if (!assistantPermission(input.role, "chat")) throw new Error("Forbidden");
  const router = await loadAssistantRouter(sql, input.tenantId, input.routerId);
  if (!router) throw new Error("Router not authorized");
  const prompt = input.prompt.trim().slice(0, 2000);
  if (prompt.length < 3) throw new Error("Ask a shorter question about this router.");
  const conversationId = input.conversationId || nid("aic");
  if (!input.conversationId) {
    await sql`insert into ai_conversations (id, tenant_id, user_id, router_id, title)
      values (${conversationId}, ${input.tenantId}, ${input.userId}, ${router.id}, ${redactSensitive(prompt).slice(0, 80)})`;
  }
  await sql`insert into ai_messages (id, tenant_id, conversation_id, role, body)
    values (${nid("aim")}, ${input.tenantId}, ${conversationId}, 'user', ${redactSensitive(prompt)})`;

  const classified = classifyAsk(prompt);
  const requestId = nid("air");
  const policy: AiPolicy = {
    ai_enabled: router.ai_enabled,
    ai_read_only: router.ai_read_only,
    ai_write_enabled: false,
  };
  const live: string[] = [];
  const tools: { name: string; status: string }[] = [];
  if (classified.write) {
    if (!assistantPermission(input.role, "plan")) {
      await auditTool(sql, {
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId,
        requestId,
        routerId: router.id,
        tool: "write_refused",
        risk: "WRITE",
        args: prompt,
        result: "Writes stay blocked.",
        status: "blocked",
        error: "read-only",
        started: Date.now(),
      });
      const body = [
        "No configuration has been changed.",
        "",
        "Writes stay blocked. The assistant can inspect this router in read-only mode, then a later approval step can apply a typed change.",
        "Router output is treated as untrusted data and is not an instruction.",
      ].join("\n");
      await sql`insert into ai_messages (id, tenant_id, conversation_id, role, body)
        values (${nid("aim")}, ${input.tenantId}, ${conversationId}, 'assistant', ${body})`;
      return { conversationId, body, tools, changed: false as const, kind: classified.kind, plan: null };
    }
    const evidence: string[] = [];
    if (router.ai_enabled && assistantPermission(input.role, "diagnose")) {
      const started = Date.now();
      try {
        const result = await readTool(router, "get_routes");
        const text = redactSensitive(result.text).slice(0, 500);
        if (result.ok && text && text !== "Router unreachable") evidence.push(...text.split("\n"));
        tools.push({ name: "get_routes", status: result.ok ? "ok" : "failed" });
        await auditTool(sql, {
          tenantId: input.tenantId,
          userId: input.userId,
          conversationId,
          requestId,
          routerId: router.id,
          tool: "get_routes",
          risk: "READ",
          args: "get_routes",
          result: text,
          status: result.ok ? "ok" : "failed",
          error: result.ok ? "" : "read failed",
          started,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Router unreachable";
        tools.push({ name: "get_routes", status: "failed" });
        await auditTool(sql, {
          tenantId: input.tenantId,
          userId: input.userId,
          conversationId,
          requestId,
          routerId: router.id,
          tool: "get_routes",
          risk: "READ",
          args: "get_routes",
          result: message,
          status: "failed",
          error: "unreachable",
          started,
        });
      }
    }
    const plan = await createChangePlan(sql, {
      tenantId: input.tenantId,
      userId: input.userId,
      routerId: router.id,
      routerName: router.name,
      conversationId,
      prompt,
      evidence,
      aiEnabled: router.ai_enabled,
    });
    await auditTool(sql, {
      tenantId: input.tenantId,
      userId: input.userId,
      conversationId,
      requestId,
      routerId: router.id,
      tool: "plan_draft",
      risk: "WRITE",
      args: prompt,
      result: `${plan.id} ${plan.state}`,
      status: plan.executable ? "ok" : "blocked",
      error: plan.blockReason,
      started: Date.now(),
    });
    return { conversationId, body: formatPlan(plan), tools, changed: false as const, kind: classified.kind, plan };
  }

  let reachable: boolean | null = null;
  for (const tool of classified.tools.slice(0, TOOL_BUDGET)) {
    const gate = authorizeTool(input.role, policy, tool);
    const started = Date.now();
    if (!gate.ok) {
      tools.push({ name: tool, status: "blocked" });
      await auditTool(sql, {
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId,
        requestId,
        routerId: router.id,
        tool,
        risk: gate.risk,
        args: tool,
        result: gate.error,
        status: "blocked",
        error: gate.error,
        started,
      });
      continue;
    }
    try {
      const result = await readTool(router, tool);
      reachable = result.ok;
      const text = redactSensitive(result.text).slice(0, 500);
      if (text) live.push(`${tool}: ${text.split("\n")[0]}`);
      tools.push({ name: tool, status: result.ok ? "ok" : "failed" });
      await auditTool(sql, {
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId,
        requestId,
        routerId: router.id,
        tool,
        risk: "READ",
        args: tool,
        result: text,
        status: result.ok ? "ok" : "failed",
        error: result.ok ? "" : "read failed",
        started,
      });
    } catch (err) {
      reachable = false;
      const message = err instanceof Error ? err.message : "Router unreachable";
      tools.push({ name: tool, status: "failed" });
      await auditTool(sql, {
        tenantId: input.tenantId,
        userId: input.userId,
        conversationId,
        requestId,
        routerId: router.id,
        tool,
        risk: "READ",
        args: tool,
        result: message,
        status: "failed",
        error: "unreachable",
        started,
      });
    }
  }

  const diagnosis = diagnoseFromEvidence(classified.kind, {
    name: router.name,
    identity: router.identity,
    cpu: router.cpu_pct,
    memory: router.memory_pct,
    lastSeen: router.last_seen,
    apiError: router.api_last_error,
    reachable: policy.ai_enabled ? reachable : null,
    live,
  });
  if (!policy.ai_enabled) {
    diagnosis.findings.unshift("AI is disabled for this router. Stored health is shown. Live tools were not run.");
    diagnosis.status = "unknown";
    diagnosis.confidence = null;
  }
  const body = formatDiagnosis(diagnosis);
  await sql`insert into ai_messages (id, tenant_id, conversation_id, role, body)
    values (${nid("aim")}, ${input.tenantId}, ${conversationId}, 'assistant', ${body})`;
  return { conversationId, body, tools, changed: false as const, kind: classified.kind, diagnosis, plan: null };
}

export async function setRouterAiEnabled(sql: Sql, tenantId: string, routerId: string, enabled: boolean) {
  const router = await loadAssistantRouter(sql, tenantId, routerId);
  if (!router) throw new Error("Router not authorized");
  await sql`update routers set ai_enabled = ${enabled}, ai_read_only = true, ai_write_enabled = false
    where id = ${routerId} and tenant_id = ${tenantId}`;
  return { ai_enabled: enabled, ai_read_only: true, ai_write_enabled: false };
}

export async function setRouterAiWriteEnabled(sql: Sql, tenantId: string, routerId: string, enabled: boolean) {
  const router = await loadAssistantRouter(sql, tenantId, routerId);
  if (!router) throw new Error("Router not authorized");
  if (enabled && !router.ai_enabled) throw new Error("Enable the assistant before allowing writes.");
  await sql`update routers set ai_write_enabled = ${enabled}, ai_read_only = ${!enabled}
    where id = ${routerId} and tenant_id = ${tenantId}`;
  return { ai_enabled: router.ai_enabled, ai_read_only: !enabled, ai_write_enabled: enabled };
}

export async function mcpGatewayStatus(url = process.env.MIKROTIK_MCP_URL || "") {
  if (!url) return { status: "unconfigured" as const, url: "" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "ispsolutions", version: "1" } },
      }),
      signal: AbortSignal.timeout(1500),
    });
    return { status: res.ok ? ("healthy" as const) : ("unreachable" as const), url };
  } catch {
    return { status: "unreachable" as const, url };
  }
}

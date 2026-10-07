import { createHash } from "node:crypto";
import { nid } from "../utils.ts";
import { hasPermission } from "./rbac.ts";
import { routerosApiCommand } from "./routeros-api.ts";
import { open } from "./secrets.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

const SECRET_VALUE = /(password|passphrase|private-key|private_key|psk|secret|community|token)\s*[=:]\s*\S+/gi;
const BLOCKED = /remove|reset-configuration|factory-reset|wipe/i;
const EVENT_PART =
  /^\/ip route set \[find where comment="[A-Za-z0-9_.:-]{1,32}"\] distance=([1-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$/;

export type PlanRisk = "LOW" | "MEDIUM" | "HIGH";
export type VerifyStatus = "PASS" | "PARTIAL" | "FAIL" | "UNKNOWN";
export type PlanIntent = "apply" | "rollback";

export type PlanOp = { tool: string; words: string[]; summary: string };

type StoredPlan = {
  routerName: string;
  objective: string;
  risk: PlanRisk;
  current: string;
  proposed: string;
  affected: string[];
  unaffected: string[];
  operations: PlanOp[];
  rollback: PlanOp[];
  expectedOutcome: string[];
  verificationPlan: string[];
  executable: boolean;
  blockReason: string;
  safeMode: "unavailable";
  intent: PlanIntent;
  markers: { on: string; off: string };
};

export type PublicPlan = {
  id: string;
  routerId: string;
  routerName: string;
  objective: string;
  risk: PlanRisk;
  state: string;
  current: string;
  proposed: string;
  affected: string[];
  unaffected: string[];
  operationSummaries: string[];
  rollbackSummaries: string[];
  commands: string[];
  expectedOutcome: string[];
  verificationPlan: string[];
  executable: boolean;
  blockReason: string;
  safeMode: "unavailable";
  intent: PlanIntent;
  parentPlanId: string;
};

export type PlanRunner = (words: string[]) => Promise<{ ok: boolean; text: string }>;

type PlanRow = {
  id: string;
  router_id: string;
  objective: string;
  risk: string;
  state: string;
  plan_json: string;
  block_reason: string;
  parent_plan_id: string;
};

type RouterGate = {
  id: string;
  name: string;
  wg_address: string;
  api_user: string;
  api_password: string;
  api_port: number;
  ai_enabled: boolean;
  ai_read_only: boolean;
  ai_write_enabled: boolean;
};

export function redactPlanText(value: string) {
  return value
    .replace(SECRET_VALUE, (match) => match.replace(/[=:]\s*\S+/, "=••••"))
    .replace(/enc:v1:[A-Za-z0-9+/=]+/g, "enc:v1:••••")
    .slice(0, 4000);
}

function markersFor(id: string) {
  const suffix = id.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase().padStart(8, "0");
  return { on: `isp-ai-on-${suffix}`, off: `isp-ai-off-${suffix}` };
}

function clock(token: string) {
  const match = token.trim().toLowerCase().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return "";
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3] || "";
  if (!Number.isInteger(hour) || minute > 59) return "";
  if (meridiem) {
    if (hour < 1 || hour > 12) return "";
    if (meridiem === "pm" && hour !== 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
  } else if (hour > 23) return "";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
}

function safeEvent(event: string) {
  const parts = event.split("; ");
  return parts.length > 0 && parts.length <= 4 && parts.every((part) => EVENT_PART.test(part));
}

export function validatePlanOp(op: PlanOp) {
  if (!op || !["add_scheduler", "disable_scheduler", "set_route_distance"].includes(op.tool)) return "unsupported operation";
  if (!Array.isArray(op.words) || op.words.length < 2 || op.words.length > 8) return "unsupported operation";
  const joined = op.words.join(" ");
  if (BLOCKED.test(joined) || /password|secret|private-key|\.rsc|\/system\/script/i.test(joined)) return "blocked operation";
  if (op.tool === "add_scheduler") {
    const name = op.words.find((word) => word.startsWith("=name="))?.slice(6) || "";
    const event = op.words.find((word) => word.startsWith("=on-event="))?.slice(10) || "";
    const start = op.words.find((word) => word.startsWith("=start-time="))?.slice(12) || "";
    if (op.words[0] !== "/system/scheduler/add") return "unsupported operation";
    if (!/^isp-ai-(on|off)-[a-z0-9]{8}$/.test(name)) return "unsupported operation";
    if (!/^\d{2}:\d{2}:\d{2}$/.test(start)) return "unsupported operation";
    if (!safeEvent(event)) return "blocked operation";
  }
  if (op.tool === "disable_scheduler") {
    const name = op.words.find((word) => word.startsWith("=numbers="))?.slice(9) || "";
    if (op.words[0] !== "/system/scheduler/set" || !op.words.includes("=disabled=yes")) return "unsupported operation";
    if (!/^isp-ai-(on|off)-[a-z0-9]{8}$/.test(name)) return "unsupported operation";
  }
  if (op.tool === "set_route_distance") {
    const id = op.words.find((word) => word.startsWith("=.id="))?.slice(5) || "";
    const distance = Number(op.words.find((word) => word.startsWith("=distance="))?.slice(10));
    if (op.words[0] !== "/ip/route/set" || !/^\*[0-9A-F]+$/i.test(id)) return "unsupported operation";
    if (!Number.isInteger(distance) || distance < 1 || distance > 255) return "unsupported operation";
  }
  return "";
}

function routesFromEvidence(lines: string[]) {
  const found: { comment: string; id: string; distance: number; wan: "WAN1" | "WAN2" }[] = [];
  for (const line of lines) {
    const comment = /comment=([A-Za-z0-9_.:-]{1,32})/.exec(line)?.[1] || "";
    const id = /(?:^|\s)\.id=(\*[0-9A-F]+)/i.exec(line)?.[1] || "";
    const distance = Number(/distance=(\d+)/.exec(line)?.[1]);
    const wan = comment === "WAN1" || comment.endsWith("-WAN1") ? "WAN1" : comment === "WAN2" || comment.endsWith("-WAN2") ? "WAN2" : "";
    if (!wan || !id || !Number.isInteger(distance) || distance < 1 || distance > 254) continue;
    if (!found.some((row) => row.wan === wan)) found.push({ comment, id, distance, wan });
  }
  return found;
}

function eventFor(items: { comment: string; distance: number }[]) {
  return items.map((item) => `/ip route set [find where comment="${item.comment}"] distance=${item.distance}`).join("; ");
}

export function buildWritePlan(input: {
  id: string;
  prompt: string;
  routerName: string;
  evidence: string[];
  aiEnabled: boolean;
}): StoredPlan & { state: string } {
  const markers = markersFor(input.id);
  const prompt = redactPlanText(input.prompt).trim();
  const base: StoredPlan = {
    routerName: input.routerName,
    objective: prompt.slice(0, 240),
    risk: "HIGH",
    current: "UNKNOWN",
    proposed: "No supported change plan.",
    affected: [],
    unaffected: ["WireGuard", "Firewall filter", "NAT", "PPPoE secrets"],
    operations: [],
    rollback: [],
    expectedOutcome: [],
    verificationPlan: ["Missing RouterOS output is UNKNOWN, not a pass."],
    executable: false,
    blockReason: "This request does not map to a supported change plan. No configuration was changed.",
    safeMode: "unavailable",
    intent: "apply",
    markers,
  };
  if (/\b(delete|remove|wipe|factory)\b|reset-configuration/i.test(prompt)) {
    base.blockReason = "This operation is blocked. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  const wan = /wan\s*([12]).{0,48}?between\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s+and\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i.exec(
    prompt,
  );
  if (!wan) return { ...base, state: "PLANNED" };
  const prefer = wan[1] === "2" ? "WAN2" : "WAN1";
  const start = clock(wan[2] || "");
  const end = clock(wan[3] || "");
  base.risk = "MEDIUM";
  base.objective = `Prefer ${prefer} between ${start || "UNKNOWN"} and ${end || "UNKNOWN"}.`;
  base.affected = ["Default route distance", "System scheduler"];
  base.proposed = `At ${start || "UNKNOWN"} set ${prefer} distance to 1 and raise the other default route. At ${end || "UNKNOWN"} restore the previous distances.`;
  if (!input.aiEnabled) {
    base.blockReason = "AI is disabled for this router. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  if (!start || !end || start === end) {
    base.blockReason = "The time window is UNKNOWN. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  const routes = routesFromEvidence(input.evidence.map((line) => redactPlanText(line)));
  const wan1 = routes.find((row) => row.wan === "WAN1");
  const wan2 = routes.find((row) => row.wan === "WAN2");
  if (!wan1 || !wan2) {
    base.current = "UNKNOWN";
    base.blockReason = "Current routing is UNKNOWN. A live route print did not show WAN1 and WAN2 default routes. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  const during = routes.map((row) => ({
    comment: row.comment,
    distance: row.wan === prefer ? 1 : row.distance <= 1 ? 2 : row.distance,
  }));
  const restore = routes.map((row) => ({ comment: row.comment, distance: row.distance }));
  const onEvent = eventFor(during);
  const offEvent = eventFor(restore);
  if (!safeEvent(onEvent) || !safeEvent(offEvent)) {
    base.blockReason = "The route comments are not safe to put in a scheduler. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  const onOp: PlanOp = {
    tool: "add_scheduler",
    summary: `Add scheduler ${markers.on} at ${start}`,
    words: [
      "/system/scheduler/add",
      `=name=${markers.on}`,
      `=start-time=${start}`,
      "=interval=1d",
      `=on-event=${onEvent}`,
      "=comment=ispsolutions-ai",
    ],
  };
  const offOp: PlanOp = {
    tool: "add_scheduler",
    summary: `Add scheduler ${markers.off} at ${end}`,
    words: [
      "/system/scheduler/add",
      `=name=${markers.off}`,
      `=start-time=${end}`,
      "=interval=1d",
      `=on-event=${offEvent}`,
      "=comment=ispsolutions-ai",
    ],
  };
  const rollback: PlanOp[] = [
    {
      tool: "disable_scheduler",
      summary: `Disable scheduler ${markers.on}`,
      words: ["/system/scheduler/set", `=numbers=${markers.on}`, "=disabled=yes"],
    },
    {
      tool: "disable_scheduler",
      summary: `Disable scheduler ${markers.off}`,
      words: ["/system/scheduler/set", `=numbers=${markers.off}`, "=disabled=yes"],
    },
    ...routes.map((row) => ({
      tool: "set_route_distance",
      summary: `Restore ${row.wan} distance to ${row.distance}`,
      words: ["/ip/route/set", `=.id=${row.id}`, `=distance=${row.distance}`],
    })),
  ];
  const problem = [...[onOp, offOp], ...rollback].map(validatePlanOp).find(Boolean) || "";
  if (problem) {
    base.blockReason = "This operation is blocked. No configuration was changed.";
    return { ...base, state: "PLANNED" };
  }
  return {
    ...base,
    current: `WAN1 distance ${wan1.distance}, WAN2 distance ${wan2.distance}.`,
    operations: [onOp, offOp],
    rollback,
    expectedOutcome: [
      `${markers.on} is present and runs at ${start}.`,
      `${markers.off} is present and runs at ${end}.`,
      "Distance does not change until the scheduler runs.",
    ],
    verificationPlan: [
      "Read /system/scheduler/print and require both scheduler names.",
      "If that print is missing, the result is UNKNOWN and the plan is not committed.",
    ],
    executable: true,
    blockReason: "",
    state: "AWAITING_APPROVAL",
  };
}

function parseStored(raw: string): StoredPlan | null {
  try {
    const value = JSON.parse(raw) as StoredPlan;
    if (!value || !Array.isArray(value.operations) || !Array.isArray(value.rollback)) return null;
    return value;
  } catch {
    return null;
  }
}

export function toPublicPlan(row: PlanRow): PublicPlan | null {
  const stored = parseStored(row.plan_json);
  if (!stored) return null;
  const risk: PlanRisk = stored.risk === "LOW" || stored.risk === "HIGH" ? stored.risk : "MEDIUM";
  return {
    id: row.id,
    routerId: row.router_id,
    routerName: stored.routerName,
    objective: stored.objective,
    risk,
    state: row.state,
    current: stored.current,
    proposed: stored.proposed,
    affected: stored.affected,
    unaffected: stored.unaffected,
    operationSummaries: stored.operations.map((op) => op.summary),
    rollbackSummaries: stored.rollback.map((op) => op.summary),
    commands: stored.operations.map((op) => op.words.join(" ")),
    expectedOutcome: stored.expectedOutcome,
    verificationPlan: stored.verificationPlan,
    executable: stored.executable,
    blockReason: row.block_reason || stored.blockReason,
    safeMode: "unavailable",
    intent: stored.intent === "rollback" ? "rollback" : "apply",
    parentPlanId: row.parent_plan_id || "",
  };
}

export function formatPlan(plan: PublicPlan) {
  return [
    "Change plan",
    plan.objective,
    "",
    "Current",
    plan.current,
    "",
    "Proposed",
    plan.proposed,
    "",
    `Risk: ${plan.risk}`,
    "",
    "Affected",
    plan.affected.join(", ") || "UNKNOWN",
    "",
    "Rollback",
    plan.rollbackSummaries.join(" ") || "No rollback commands until the plan is executable.",
    "",
    plan.executable ? "Status: waiting for approval. Nothing has been applied." : `Not executable. ${plan.blockReason}`,
    "",
    "Safe Mode is not available on the overlay API.",
    "",
    "No configuration has been changed.",
  ].join("\n");
}

async function readPlan(sql: Sql, tenantId: string, planId: string) {
  const [row] = await sql<PlanRow>`
    select id, router_id, objective, risk, state, plan_json, block_reason, parent_plan_id
    from ai_change_plans where id = ${planId} and tenant_id = ${tenantId}`;
  return row || null;
}

export async function listChangePlans(sql: Sql, tenantId: string) {
  const rows = await sql<PlanRow>`
    select id, router_id, objective, risk, state, plan_json, block_reason, parent_plan_id
    from ai_change_plans where tenant_id = ${tenantId}
    order by created_at desc limit 20`;
  return rows.map(toPublicPlan).filter((plan): plan is PublicPlan => Boolean(plan));
}

export async function createChangePlan(
  sql: Sql,
  input: {
    tenantId: string;
    userId: string;
    routerId: string;
    routerName: string;
    conversationId: string;
    prompt: string;
    evidence: string[];
    aiEnabled: boolean;
  },
) {
  const id = nid("acp");
  const built = buildWritePlan({
    id,
    prompt: input.prompt,
    routerName: input.routerName,
    evidence: input.evidence,
    aiEnabled: input.aiEnabled,
  });
  const { state, ...stored } = built;
  await sql`insert into ai_change_plans (
    id, tenant_id, router_id, conversation_id, user_id, objective, risk, state, plan_json, block_reason
  ) values (
    ${id}, ${input.tenantId}, ${input.routerId}, ${input.conversationId}, ${input.userId},
    ${stored.objective}, ${stored.risk}, ${state}, ${JSON.stringify(stored)}, ${stored.blockReason}
  )`;
  const [row] = await sql<PlanRow>`
    select id, router_id, objective, risk, state, plan_json, block_reason, parent_plan_id
    from ai_change_plans where id = ${id} and tenant_id = ${input.tenantId}`;
  const plan = row ? toPublicPlan(row) : null;
  if (!plan) throw new Error("Could not store the change plan.");
  await sql`insert into ai_messages (id, tenant_id, conversation_id, role, body)
    values (${nid("aim")}, ${input.tenantId}, ${input.conversationId}, 'assistant', ${formatPlan(plan)})`;
  return plan;
}

function replyText(words: string[], reply: { type: string; attrs: Record<string, string>; sentences: { type: string; attrs: Record<string, string> }[] }) {
  const text = reply.sentences
    .filter((sentence) => sentence.type === "re")
    .slice(0, 12)
    .map((sentence) =>
      Object.entries(sentence.attrs)
        .filter(([key]) => !/password|secret|private/i.test(key))
        .map(([key, value]) => `${key}=${value}`)
        .join(" "),
    )
    .join("\n");
  return { ok: reply.type !== "trap" && reply.type !== "fatal", text: redactPlanText(text || reply.attrs.message || reply.type || words[0] || "") };
}

async function liveRunner(router: RouterGate, words: string[]) {
  const host = router.wg_address.replace(/\/\d+$/, "");
  const password = open(router.api_password);
  if (!host || !password) return { ok: false, text: "Router unreachable" };
  try {
    const reply = await routerosApiCommand(
      { host, user: router.api_user || "ispsolutions-agent", password, port: router.api_port || 8728, timeoutMs: 4000 },
      words,
    );
    return replyText(words, reply);
  } catch (err) {
    return { ok: false, text: redactPlanText(err instanceof Error ? err.message : "Router unreachable") };
  }
}

function schedulerDisabled(text: string, name: string) {
  return text.split("\n").some((line) => line.includes(name) && /disabled=(yes|true)/i.test(line));
}

function verifyPrint(intent: PlanIntent, text: string, on: string, off: string): VerifyStatus {
  if (intent === "rollback") {
    const gone = !text.includes(on) && !text.includes(off);
    const disabled = schedulerDisabled(text, on) && schedulerDisabled(text, off);
    return gone || disabled ? "PASS" : "FAIL";
  }
  return text.includes(on) && text.includes(off) ? "PASS" : "FAIL";
}

async function setState(sql: Sql, tenantId: string, planId: string, state: string, blockReason = "") {
  await sql`update ai_change_plans set state = ${state}, block_reason = ${blockReason}, updated_at = now()
    where id = ${planId} and tenant_id = ${tenantId}`;
}

export async function approveChangePlan(
  sql: Sql,
  input: { tenantId: string; userId: string; role: string; planId: string; runner?: PlanRunner },
) {
  if (!hasPermission(input.role, "network.ai.approve") || !hasPermission(input.role, "network.ai.execute")) {
    throw new Error("Forbidden");
  }
  const row = await readPlan(sql, input.tenantId, input.planId);
  if (!row) throw new Error("Plan not authorized");
  const stored = parseStored(row.plan_json);
  if (!stored) throw new Error("Plan not authorized");
  const intent = stored.intent;
  const rollbackOps = stored.rollback;
  const markerOn = stored.markers.on;
  const markerOff = stored.markers.off;
  if ((stored.intent === "rollback" || row.parent_plan_id) && !hasPermission(input.role, "network.ai.rollback")) {
    throw new Error("Forbidden");
  }
  if (row.state !== "AWAITING_APPROVAL") throw new Error("This plan is not awaiting approval.");
  const problem = [...stored.operations, ...stored.rollback].map(validatePlanOp).find(Boolean) || "";
  if (!stored.executable || problem || stored.operations.length === 0) {
    await setState(sql, input.tenantId, row.id, "FAILED", problem || stored.blockReason || "This plan cannot be applied.");
    throw new Error(problem || stored.blockReason || "This plan cannot be applied. No configuration was changed.");
  }
  const [router] = await sql<RouterGate>`
    select id, name, coalesce(wg_address, '') as wg_address, coalesce(api_user, '') as api_user,
           coalesce(api_password, '') as api_password, coalesce(api_port, 8728) as api_port,
           coalesce(ai_enabled, false) as ai_enabled, coalesce(ai_read_only, true) as ai_read_only,
           coalesce(ai_write_enabled, false) as ai_write_enabled
    from routers where id = ${row.router_id} and tenant_id = ${input.tenantId} and archived_at is null`;
  if (!router) throw new Error("Router not authorized");
  if (!router.ai_enabled || router.ai_read_only || !router.ai_write_enabled) {
    throw new Error("Router is in read-only mode. No configuration was changed.");
  }
  const locked = await sql<{ id: string }>`
    update ai_change_plans set state = 'APPROVED', updated_at = now()
    where id = ${row.id} and tenant_id = ${input.tenantId} and state = 'AWAITING_APPROVAL'
    returning id`;
  if (!locked.length) throw new Error("This plan is not awaiting approval.");
  await sql`insert into ai_change_approvals (id, tenant_id, plan_id, user_id, decision)
    values (${nid("aca")}, ${input.tenantId}, ${row.id}, ${input.userId}, 'approved')`;

  const run = input.runner || ((words: string[]) => liveRunner(router, words));
  const executionId = nid("ace");
  await sql`insert into ai_change_executions (id, tenant_id, plan_id, status, result_redacted)
    values (${executionId}, ${input.tenantId}, ${row.id}, 'running', '')`;

  let applied = 0;
  let verification: VerifyStatus = "UNKNOWN";
  let state = "FAILED";
  const notes: string[] = [];

  const snapshotParts: string[] = [];
  for (const words of [["/ip/route/print"], ["/system/scheduler/print"]] as string[][]) {
    const shot = await run(words);
    snapshotParts.push(shot.ok ? shot.text : "UNKNOWN");
    if (!shot.ok) notes.push(`${words[0]} UNKNOWN`);
  }
  const snapshot = redactPlanText(snapshotParts.join("\n"));
  const snapshotOk = !snapshotParts.includes("UNKNOWN");
  await sql`insert into ai_router_snapshots (
    id, tenant_id, router_id, plan_id, trigger, user_id, config_redacted, config_hash
  ) values (
    ${nid("ars")}, ${input.tenantId}, ${router.id}, ${row.id}, 'pre-change', ${input.userId},
    ${snapshot}, ${createHash("sha256").update(snapshot).digest("hex")}
  )`;

  async function finish(next: string, status: VerifyStatus, evidence: string) {
    state = next;
    verification = status;
    await setState(sql, input.tenantId, row.id, next, next === "COMMITTED" ? "" : evidence.slice(0, 240));
    await sql`update ai_change_executions set status = ${next}, result_redacted = ${redactPlanText(notes.join("\n")).slice(0, 2000)}, completed_at = now()
      where id = ${executionId} and tenant_id = ${input.tenantId}`;
    await sql`insert into ai_change_verifications (id, tenant_id, plan_id, status, evidence)
      values (${nid("acv")}, ${input.tenantId}, ${row.id}, ${status}, ${redactPlanText(evidence).slice(0, 2000)})`;
    if (next === "COMMITTED" && intent === "rollback" && row.parent_plan_id) {
      await sql`update ai_change_plans set state = 'ROLLED_BACK', updated_at = now()
        where id = ${row.parent_plan_id} and tenant_id = ${input.tenantId} and state = 'COMMITTED'`;
    }
  }

  async function runRollback() {
    await setState(sql, input.tenantId, row.id, "ROLLING_BACK", "");
    for (const op of rollbackOps) {
      const result = await run(op.words);
      notes.push(`${op.tool} ${result.ok ? "ok" : "failed"}`);
      if (!result.ok) return false;
    }
    const printed = await run(["/system/scheduler/print"]);
    if (!printed.ok) {
      notes.push("rollback print UNKNOWN");
      return false;
    }
    return verifyPrint("rollback", printed.text, markerOn, markerOff) === "PASS";
  }

  if (!snapshotOk) {
    await finish("FAILED", "UNKNOWN", "Snapshot is UNKNOWN. No configuration was changed.");
  } else {
    await setState(sql, input.tenantId, row.id, "APPLYING", "");
    let applyOk = true;
    for (const op of stored.operations) {
      const result = await run(op.words);
      notes.push(`${op.tool} ${result.ok ? "ok" : "failed"}`);
      if (!result.ok) {
        applyOk = false;
        break;
      }
      applied += 1;
    }
    if (!applyOk && applied === 0) {
      await finish("FAILED", "UNKNOWN", "The router did not confirm the change. Result is UNKNOWN. No commit.");
    } else if (!applyOk) {
      const rolled = await runRollback();
      await finish(rolled ? "ROLLED_BACK" : "FAILED", rolled ? "FAIL" : "UNKNOWN", rolled
        ? "Apply failed. Inverse commands were verified."
        : "Apply failed and rollback could not be verified.");
    } else {
      await setState(sql, input.tenantId, row.id, "VERIFYING", "");
      const printed = await run(["/system/scheduler/print"]);
      if (!printed.ok) {
        const rolled = await runRollback();
        await finish(rolled ? "ROLLED_BACK" : "FAILED", "UNKNOWN", "Verification print is UNKNOWN. The change was not committed.");
      } else {
        const status = verifyPrint(stored.intent, printed.text, stored.markers.on, stored.markers.off);
        if (status === "PASS") {
          await finish("COMMITTED", "PASS", printed.text);
        } else {
          const rolled = await runRollback();
          await finish(
            rolled ? "ROLLED_BACK" : "FAILED",
            rolled ? "FAIL" : "UNKNOWN",
            rolled ? "Verification failed. Inverse commands were verified. The change was not committed." : "Verification failed and rollback could not be verified.",
          );
        }
      }
    }
  }

  const fresh = await readPlan(sql, input.tenantId, row.id);
  const plan = fresh ? toPublicPlan(fresh) : null;
  if (!plan) throw new Error("Plan not authorized");
  const changed = state === "COMMITTED";
  const message =
    state === "COMMITTED"
      ? stored.intent === "rollback"
        ? "Rollback verified. Scheduler changes are disabled or gone. Safe Mode was not used."
        : "Verified. Both schedulers are present. Route preference changes when the scheduler runs. Safe Mode was not used."
      : state === "ROLLED_BACK"
        ? "Verification did not pass. Inverse commands were checked. The change was not committed."
        : verification === "UNKNOWN"
          ? "Result is UNKNOWN. This is not a pass. No configuration was committed."
          : "The change was not committed.";
  return { plan, message, verification, changed, state };
}

export async function cancelChangePlan(sql: Sql, input: { tenantId: string; role: string; planId: string }) {
  if (!hasPermission(input.role, "network.ai.plan") && !hasPermission(input.role, "network.ai.approve")) {
    throw new Error("Forbidden");
  }
  const locked = await sql<{ id: string }>`
    update ai_change_plans
    set state = 'FAILED', block_reason = 'Cancelled. No configuration was changed.', updated_at = now()
    where id = ${input.planId} and tenant_id = ${input.tenantId} and state = 'AWAITING_APPROVAL'
    returning id`;
  if (!locked.length) throw new Error("This plan is not awaiting approval.");
  await sql`insert into ai_change_approvals (id, tenant_id, plan_id, user_id, decision)
    values (${nid("aca")}, ${input.tenantId}, ${input.planId}, '', 'rejected')`;
  const row = await readPlan(sql, input.tenantId, input.planId);
  const plan = row ? toPublicPlan(row) : null;
  if (!plan) throw new Error("Plan not authorized");
  return plan;
}

export async function createRollbackPlan(sql: Sql, input: { tenantId: string; userId: string; role: string; planId: string }) {
  if (!hasPermission(input.role, "network.ai.rollback")) throw new Error("Forbidden");
  const row = await readPlan(sql, input.tenantId, input.planId);
  if (!row) throw new Error("Plan not authorized");
  if (row.state !== "COMMITTED") throw new Error("Nothing has been committed. No configuration was changed.");
  const stored = parseStored(row.plan_json);
  if (!stored || stored.rollback.length === 0) throw new Error("This plan has no rollback commands.");
  const problem = stored.rollback.map(validatePlanOp).find(Boolean);
  if (problem) throw new Error("This operation is blocked. No configuration was changed.");
  const id = nid("acp");
  const next: StoredPlan = {
    ...stored,
    objective: `Roll back: ${stored.objective}`.slice(0, 240),
    operations: stored.rollback,
    rollback: stored.operations,
    intent: "rollback",
    executable: true,
    blockReason: "",
    proposed: "Disable the assistant schedulers and restore the route distances captured in the plan.",
    expectedOutcome: ["Both schedulers are disabled or absent.", "Default route distances match the pre-change values."],
  };
  await sql`insert into ai_change_plans (
    id, tenant_id, router_id, conversation_id, user_id, objective, risk, state, plan_json, block_reason, parent_plan_id
  ) values (
    ${id}, ${input.tenantId}, ${row.router_id}, '', ${input.userId}, ${next.objective}, ${next.risk},
    'AWAITING_APPROVAL', ${JSON.stringify(next)}, '', ${row.id}
  )`;
  const created = await readPlan(sql, input.tenantId, id);
  const plan = created ? toPublicPlan(created) : null;
  if (!plan) throw new Error("Could not store the rollback plan.");
  return plan;
}

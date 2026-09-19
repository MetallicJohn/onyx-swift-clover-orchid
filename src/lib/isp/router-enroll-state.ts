import { nid } from "../utils.ts";

export const ENROLL_STATES = [
  "PENDING",
  "BOOTSTRAP_GENERATED",
  "BOOTSTRAP_EXECUTED",
  "WIREGUARD_CONFIGURED",
  "WIREGUARD_CONNECTED",
  "API_VERIFIED",
  "AGENT_CONNECTED",
  "ENROLLED",
  "DEGRADED",
  "REVOKED",
] as const;

export type EnrollState = (typeof ENROLL_STATES)[number];

const RANK: Record<EnrollState, number> = {
  PENDING: 0,
  BOOTSTRAP_GENERATED: 1,
  BOOTSTRAP_EXECUTED: 2,
  WIREGUARD_CONFIGURED: 3,
  WIREGUARD_CONNECTED: 4,
  API_VERIFIED: 5,
  AGENT_CONNECTED: 6,
  ENROLLED: 7,
  DEGRADED: 6,
  REVOKED: -1,
};

const ALLOWED: Record<EnrollState, EnrollState[]> = {
  PENDING: ["BOOTSTRAP_GENERATED", "REVOKED"],
  BOOTSTRAP_GENERATED: ["BOOTSTRAP_EXECUTED", "WIREGUARD_CONFIGURED", "REVOKED", "PENDING"],
  BOOTSTRAP_EXECUTED: ["WIREGUARD_CONFIGURED", "WIREGUARD_CONNECTED", "REVOKED", "DEGRADED"],
  WIREGUARD_CONFIGURED: ["WIREGUARD_CONNECTED", "DEGRADED", "REVOKED"],
  WIREGUARD_CONNECTED: ["API_VERIFIED", "AGENT_CONNECTED", "ENROLLED", "DEGRADED", "REVOKED"],
  API_VERIFIED: ["AGENT_CONNECTED", "ENROLLED", "DEGRADED", "REVOKED"],
  AGENT_CONNECTED: ["API_VERIFIED", "ENROLLED", "DEGRADED", "REVOKED"],
  ENROLLED: ["DEGRADED", "REVOKED", "WIREGUARD_CONNECTED"],
  DEGRADED: ["WIREGUARD_CONNECTED", "API_VERIFIED", "AGENT_CONNECTED", "ENROLLED", "REVOKED"],
  REVOKED: ["PENDING", "BOOTSTRAP_GENERATED"],
};

export function parseEnrollState(value: string | null | undefined): EnrollState {
  const v = String(value || "PENDING").toUpperCase();
  return (ENROLL_STATES as readonly string[]).includes(v) ? (v as EnrollState) : "PENDING";
}

export function canTransition(from: EnrollState, to: EnrollState) {
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

export function enrollRank(state: EnrollState) {
  return RANK[state] ?? 0;
}

export function compositeEnrollState(input: {
  current: EnrollState;
  handshake: boolean;
  api: boolean;
  agent: boolean;
  revoked?: boolean;
}) {
  if (input.revoked || input.current === "REVOKED") return "REVOKED" as const;
  if (input.handshake && input.api && input.agent) return "ENROLLED" as const;
  if (input.handshake && input.api) return "API_VERIFIED" as const;
  if (input.handshake && input.agent) return "AGENT_CONNECTED" as const;
  if (input.handshake) return "WIREGUARD_CONNECTED" as const;
  if (input.current === "ENROLLED" || enrollRank(input.current) >= RANK.WIREGUARD_CONNECTED) {
    return "DEGRADED" as const;
  }
  return input.current;
}

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
};

export async function recordEnrollState(
  sql: Sql,
  opts: {
    tenantId: string;
    routerId: string;
    state: EnrollState;
    actorUserId?: string;
    detail?: string | Record<string, unknown>;
  },
) {
  const next = parseEnrollState(opts.state);
  const [row] = await sql<{ enroll_state: string }>`
    select coalesce(enroll_state, 'PENDING') as enroll_state
    from routers where id = ${opts.routerId} and tenant_id = ${opts.tenantId}`;
  const current = parseEnrollState(row?.enroll_state);
  if (!canTransition(current, next) && current !== next) return { state: current, changed: false };
  const detail = typeof opts.detail === "string" ? opts.detail : JSON.stringify(opts.detail || {});
  await sql`update routers set enroll_state = ${next} where id = ${opts.routerId} and tenant_id = ${opts.tenantId}`;
  await sql`insert into router_enrollments (id, tenant_id, router_id, state, actor_user_id, detail)
    values (${nid("ren")}, ${opts.tenantId}, ${opts.routerId}, ${next}, ${opts.actorUserId || ""}, ${detail.slice(0, 4000)})`;
  return { state: next, changed: current !== next };
}

export function healthLabel(state: EnrollState) {
  if (state === "ENROLLED") return "ONLINE";
  if (state === "DEGRADED") return "DEGRADED";
  if (state === "REVOKED") return "REVOKED";
  if (state === "PENDING" || state === "BOOTSTRAP_GENERATED") return "PENDING";
  return "OFFLINE";
}

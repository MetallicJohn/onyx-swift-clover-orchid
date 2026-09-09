import { nid } from "../utils.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export const ACS_KINDS = ["reboot", "setSsid", "refresh"] as const;

export async function queueAcsTask(sql: Sql, tenantId: string, cpeId: string, kind: string, payload: Record<string, unknown>) {
  if (!ACS_KINDS.includes(kind as (typeof ACS_KINDS)[number])) throw new Error("Unknown ACS task");
  const [cpe] = await sql<{ id: string }>`select id from cpe_devices where id = ${cpeId} and tenant_id = ${tenantId}`;
  if (!cpe) throw new Error("CPE not found");
  const id = nid("acs");
  await sql`insert into acs_tasks (id, tenant_id, cpe_id, kind, payload, status)
    values (${id}, ${tenantId}, ${cpeId}, ${kind}, ${JSON.stringify(payload)}, 'queued')`;
  if (kind === "setSsid" && payload.ssid) {
    await sql`update cpe_devices set ssid = ${String(payload.ssid)} where id = ${cpeId} and tenant_id = ${tenantId}`;
  }
  return { id, status: "queued" as const };
}

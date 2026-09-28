import { queueCompiledCommand } from "./mikrotik.ts";
import { arpComment, canonicalMac, option43Hex, planArpBinding } from "./pool-network.ts";

type Sql = {
  <T = Record<string, unknown>>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T[]>;
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

export async function syncPoolNetwork(sql: Sql, tenantId: string, routerId: string, poolId: string, actorId = "") {
  const [pool] = await sql.query<{
    id: string;
    name: string;
    cidr: string;
    dhcp_option_43_enabled: boolean;
    dhcp_option_43_value: string;
    dhcp_option_43_format: string;
  }>(
    `select id, name, cidr,
            coalesce(dhcp_option_43_enabled, false) as dhcp_option_43_enabled,
            coalesce(dhcp_option_43_value,'') as dhcp_option_43_value,
            coalesce(dhcp_option_43_format,'hex') as dhcp_option_43_format
     from ip_pools where id = $1 and tenant_id = $2`,
    [poolId, tenantId],
  );
  if (!pool) throw new Error("IP pool not found");
  const optionName = `isp43-${pool.id.replace(/[^a-z0-9]/gi, "").slice(-12)}`;
  const enabled = Boolean(pool.dhcp_option_43_enabled);
  const value = enabled ? option43Hex(pool.dhcp_option_43_format, pool.dhcp_option_43_value) : "";
  const queued = await queueCompiledCommand(
    sql,
    tenantId,
    routerId,
    "dhcp.option43",
    { option_name: optionName, cidr: pool.cidr, value, enabled },
    actorId,
  );
  return { queued: queued.id, verified: false, option: enabled ? value : "" };
}

export async function syncServiceArp(sql: Sql, tenantId: string, serviceId: string, actorId = "", remove = false) {
  const [row] = await sql.query<{
    address: string;
    mac_address: string;
    customer_name: string;
    phone: string;
    static_arp_mode: string;
    router_id: string;
  }>(
    `select a.address, coalesce(s.mac_address,'') as mac_address,
            coalesce(c.name,'') as customer_name, coalesce(c.phone,'') as phone,
            coalesce(p.static_arp_mode,'normal') as static_arp_mode,
            coalesce(r.router_id,'') as router_id
     from services s
     left join customers c on c.id = s.customer_id and c.tenant_id = s.tenant_id
     left join ip_addresses a on a.service_id = s.id and a.tenant_id = s.tenant_id
     left join ip_pools p on p.id = a.pool_id
     left join router_pool_assignments r on r.pool_id = p.id and r.tenant_id = s.tenant_id
     where s.id = $1 and s.tenant_id = $2
     limit 1`,
    [serviceId, tenantId],
  );
  if (!row?.router_id || row.static_arp_mode !== "reply_only" || !row.address) {
    return { skipped: true };
  }
  if (remove) {
    const plan = planArpBinding(row.address, null, []);
    if (plan.action === "noop") return { skipped: true };
    const queued = await queueCompiledCommand(
      sql,
      tenantId,
      row.router_id,
      "arp.remove",
      { address: row.address },
      actorId,
    );
    return { queued: queued.id, action: "remove", verified: false };
  }
  const mac = canonicalMac(row.mac_address);
  const comment = arpComment(row.customer_name, row.phone);
  const plan = planArpBinding(row.address, { mac, comment }, []);
  if (plan.action === "conflict") throw new Error(plan.error);
  const queued = await queueCompiledCommand(
    sql,
    tenantId,
    row.router_id,
    "arp.upsert",
    { address: row.address, mac, comment },
    actorId,
  );
  return { queued: queued.id, action: plan.action, comment, verified: false };
}

export async function assertReplyOnlyMac(
  sql: Sql,
  tenantId: string,
  poolId: string,
  macRaw: string,
  exceptServiceId = "",
) {
  const [pool] = await sql.query<{ static_arp_mode: string }>(
    `select coalesce(static_arp_mode,'normal') as static_arp_mode
     from ip_pools where id = $1 and tenant_id = $2`,
    [poolId, tenantId],
  );
  if (!pool || pool.static_arp_mode !== "reply_only") return "";
  const trimmed = String(macRaw || "").trim();
  if (!trimmed) {
    throw new Error("CPE MAC Address is required because the selected pool uses ARP Reply Only.");
  }
  const mac = canonicalMac(trimmed);
  const hex = mac.replace(/:/g, "");
  const [dup] = await sql.query<{ id: string }>(
    `select s.id
     from services s
     join ip_addresses a on a.service_id = s.id and a.tenant_id = s.tenant_id
     where s.tenant_id = $1 and a.pool_id = $2 and s.deleted_at is null
       and upper(regexp_replace(coalesce(s.mac_address,''), '[^0-9A-Fa-f]', '', 'g')) = $3
       and ($4 = '' or s.id <> $4)
     limit 1`,
    [tenantId, poolId, hex, exceptServiceId],
  );
  if (dup) throw new Error("That CPE MAC address is already bound on this pool");
  return hex;
}

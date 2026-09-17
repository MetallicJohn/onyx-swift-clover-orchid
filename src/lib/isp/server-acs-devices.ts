import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { nid } from "@/lib/utils";
import { loadAuthUser } from "./accounts";
import {
  applyAcsWifi,
  readAcsOptical,
  readAcsParameters,
  refreshAcsDevice,
  requestAcsInform,
  retryAcsTask,
  runAcsDeviceAction,
  sanitizeAuditDetails,
} from "./acs-device-actions";
import {
  ACS_DEVICE_SEARCH_LIMIT,
  emptyAcsFilters,
} from "./acs-device-format";
import {
  addManualAcsDevice,
  assignAcsDevice,
  loadAcsDeviceRecord,
  queryAcsDeviceDesk,
  refreshAcsInventory,
  searchAcsAssignmentTargets,
  searchAvailableAcsDevices,
  unassignAcsDevice,
} from "./acs-devices";
import { acsConnection } from "./acs";
import { assertFeature } from "./plans";
import { assertPermission, hasPermission, type Permission } from "./rbac";
import { requireWorkspace } from "./workspace";

async function writeAudit(
  sql: Awaited<ReturnType<typeof requireWorkspace>>["sql"],
  tenantId: string,
  userId: string,
  action: string,
  entityId: string,
  details: Record<string, unknown> = {},
) {
  await sql`insert into audit_logs (id, tenant_id, user_id, action, entity_type, entity_id, details)
    values (${nid("aud")}, ${tenantId}, ${userId}, ${action}, ${"acs_device"}, ${entityId}, ${JSON.stringify(sanitizeAuditDetails(details))})`;
}

async function actorOf(sql: Awaited<ReturnType<typeof requireWorkspace>>["sql"], userId: string) {
  const profile = await loadAuthUser(sql, userId);
  return { id: userId, label: profile?.name || profile?.email || userId };
}

function anyPerm(role: string, perms: Permission[]) {
  if (perms.some((p) => hasPermission(role, p))) return;
  throw new Error("Forbidden");
}

export const listAcsDevicesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d?: Record<string, unknown>) => d ?? {})
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role, workspace } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    const desk = await queryAcsDeviceDesk(sql, tenantId, { ...emptyAcsFilters(), ...data });
    const connection = await acsConnection(sql, tenantId);
    return {
      workspace,
      connection,
      ...desk,
      can: {
        add: hasPermission(role, "acs.devices.add"),
        assign: hasPermission(role, "acs.devices.assign"),
        reassign: hasPermission(role, "acs.devices.reassign"),
        edit: hasPermission(role, "acs.devices.edit"),
        wifi: hasPermission(role, "acs.devices.wifi.manage"),
        optical: hasPermission(role, "acs.devices.optical.view"),
        reboot: hasPermission(role, "acs.devices.reboot"),
        factoryReset: hasPermission(role, "acs.devices.factory_reset"),
        firmware: hasPermission(role, "acs.devices.firmware.manage"),
        tasks: hasPermission(role, "acs.tasks.view"),
        retry: hasPermission(role, "acs.tasks.retry"),
      },
    };
  });

export const searchAcsDevicesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; limit?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    const devices = await searchAvailableAcsDevices(sql, tenantId, data.q || "", {
      limit: data.limit || ACS_DEVICE_SEARCH_LIMIT,
    });
    return { devices };
  });

export const searchAvailableAcsDevicesFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { q?: string; limit?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    anyPerm(role, ["acs.devices.add", "acs.devices.assign", "acs.devices.view"]);
    const devices = await searchAvailableAcsDevices(sql, tenantId, data.q || "", { limit: data.limit });
    return { devices };
  });

export const searchAcsAssignmentFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { q: string; limit?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    anyPerm(role, ["acs.devices.assign", "acs.devices.reassign"]);
    const hits = await searchAcsAssignmentTargets(sql, tenantId, data.q || "", { limit: data.limit });
    return { hits };
  });

export const getAcsDeviceFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    return loadAcsDeviceRecord(sql, tenantId, data.id);
  });

export const addAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      serial?: string;
      acs_device_id?: string;
      manufacturer?: string;
      model?: string;
      oui?: string;
      mac_address?: string;
      device_type?: string;
      notes?: string;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.add");
    await assertFeature(sql, tenantId, "genieacs");
    const out = await addManualAcsDevice(sql, tenantId, data);
    await writeAudit(sql, tenantId, context.userId, "acs.device.added", out.id, {
      serial: out.serial,
      source: "manual",
      status: "unknown",
    });
    return out;
  });

export const refreshAcsInventoryFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    return refreshAcsInventory(sql, tenantId);
  });

export const assignAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: { id: string; customer_id: string; service_id: string; confirm?: boolean; confirm_move?: boolean; reason?: string }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    const record = await loadAcsDeviceRecord(sql, tenantId, data.id);
    const isMove = Boolean(record.device.service_id && record.device.service_id !== data.service_id);
    if (isMove) assertPermission(role, "acs.devices.reassign");
    else assertPermission(role, "acs.devices.assign");
    if (!data.confirm) throw new Error("Confirm this assignment");
    const actor = await actorOf(sql, context.userId);
    const out = await assignAcsDevice(sql, tenantId, data.id, data.customer_id, data.service_id, {
      actorId: actor.id,
      actorLabel: actor.label,
      confirmMove: Boolean(data.confirm_move) || !isMove,
      reason: data.reason,
    });
    await writeAudit(
      sql,
      tenantId,
      context.userId,
      isMove ? "acs.device.reassigned" : "acs.device.assigned",
      data.id,
      {
        serial: out.serial,
        from_customer: out.from_customer,
        to_customer: out.to_customer,
        from_service: out.from_service,
        to_service: out.to_service,
        reason: out.reason,
        trigger_billing: false,
        send_customer_notifications: false,
      },
    );
    return out;
  });

export const unassignAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; confirm?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.assign");
    if (!data.confirm) throw new Error("Confirm unassigning this device");
    const out = await unassignAcsDevice(sql, tenantId, data.id);
    await writeAudit(sql, tenantId, context.userId, "acs.device.unassigned", data.id, {
      serial: out.serial,
      from_customer: out.from_customer,
      from_service: out.from_service,
    });
    return out;
  });

export const rebootAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; confirm?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.reboot");
    await assertFeature(sql, tenantId, "genieacs");
    const actor = await actorOf(sql, context.userId);
    const out = await runAcsDeviceAction(sql, tenantId, data.id, "reboot", {}, { actor, confirm: Boolean(data.confirm) });
    await writeAudit(sql, tenantId, context.userId, "acs.device.reboot", data.id, { phase: out.phase, serial: out.serial });
    return out;
  });

export const factoryResetAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string; confirm?: boolean; phrase?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.factory_reset");
    await assertFeature(sql, tenantId, "genieacs");
    const actor = await actorOf(sql, context.userId);
    const out = await runAcsDeviceAction(sql, tenantId, data.id, "factoryReset", {}, {
      actor,
      confirm: Boolean(data.confirm),
      confirmPhrase: data.phrase,
    });
    await writeAudit(sql, tenantId, context.userId, "acs.device.factory_reset", data.id, { phase: out.phase, serial: out.serial });
    return out;
  });

export const refreshAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    return refreshAcsDevice(sql, tenantId, data.id);
  });

export const informAcsDeviceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    const actor = await actorOf(sql, context.userId);
    const out = await requestAcsInform(sql, tenantId, data.id, { actor });
    await writeAudit(sql, tenantId, context.userId, "acs.device.inform", data.id, { phase: out.phase, serial: out.serial });
    return out;
  });

export const getAcsDeviceParametersFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.view");
    return readAcsParameters(sql, tenantId, data.id);
  });

export const getAcsDeviceOpticalFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.optical.view");
    return readAcsOptical(sql, tenantId, data.id);
  });

export const getAcsDeviceWifiFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    anyPerm(role, ["acs.devices.view", "acs.devices.wifi.manage"]);
    const params = await readAcsParameters(sql, tenantId, data.id);
    return { wifi: params.wifi, profile: params.profile };
  });

export const setAcsDeviceWifiFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      id: string;
      band?: string;
      ssid?: string;
      password?: string;
      security?: string;
      enabled?: boolean;
      channel?: string;
      channelWidth?: string;
      mode?: string;
      confirm?: boolean;
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.devices.wifi.manage");
    await assertFeature(sql, tenantId, "genieacs");
    const actor = await actorOf(sql, context.userId);
    const out = await applyAcsWifi(
      sql,
      tenantId,
      data.id,
      {
        band: data.band,
        ssid: data.ssid,
        password: data.password,
        security: data.security,
        enabled: data.enabled,
        channel: data.channel,
        channelWidth: data.channelWidth,
        mode: data.mode,
        confirm: Boolean(data.confirm),
      },
      { actor },
    );
    await writeAudit(sql, tenantId, context.userId, "acs.device.wifi.updated", data.id, {
      ssid: data.ssid || "",
      band: data.band || "",
      security: data.security || "",
      phase: out.phase,
      verified: out.verified,
      password: undefined,
    });
    return out;
  });

export const listAcsDeviceTasksFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.tasks.view");
    const rec = await loadAcsDeviceRecord(sql, tenantId, data.id);
    return { tasks: rec.tasks };
  });

export const retryAcsTaskFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    assertPermission(role, "acs.tasks.retry");
    const actor = await actorOf(sql, context.userId);
    const out = await retryAcsTask(sql, tenantId, data.id, { actor });
    await writeAudit(sql, tenantId, context.userId, "acs.task.retry", out.id, { kind: out.kind, phase: out.phase });
    return out;
  });

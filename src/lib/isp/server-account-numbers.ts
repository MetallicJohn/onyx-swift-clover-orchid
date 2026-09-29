import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  addAccountReservation,
  auditAccountChange,
  changeServiceAccountNumber,
  defaultsForSlug,
  formatFromSettings,
  getAccountNumberSettings,
  linkLegacyAccountNumber,
  listAccountHistory,
  listAccountReservations,
  listAccountVersions,
  previewNextAccountNumber,
  removeAccountReservation,
  resetAccountNumberSettings,
  saveAccountNumberSettings,
  sequenceKind,
  testAccountNumbers,
  type AccountNumberPatch,
} from "./account-numbers";
import { usesPatternMode } from "./account-pattern";
import { hasPermission, type Permission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

function assertAny(role: string, permissions: Permission[]) {
  if (!permissions.some((permission) => hasPermission(role, permission))) throw new Error("Forbidden");
}

async function accountDesk(sql: Parameters<typeof previewNextAccountNumber>[0], tenantId: string, slug: string) {
  const desk = await previewNextAccountNumber(sql, tenantId, slug);
  const [reservations, history, versions] = await Promise.all([
    listAccountReservations(sql, tenantId),
    listAccountHistory(sql, tenantId),
    listAccountVersions(sql, tenantId),
  ]);
  return { ...desk, reservations, history, versions, slug_prefix: defaultsForSlug(slug).prefix };
}

export const getAccountNumberSettingsFn = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "customers.read", "account_numbers.view"]);
    return accountDesk(sql, tenantId, workspace.slug);
  });

export const saveAccountNumberSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: AccountNumberPatch) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.configure"]);
    const saved = await saveAccountNumberSettings(sql, tenantId, workspace.slug, data);
    const detail = usesPatternMode(saved.mode)
      ? `${saved.mode} ${saved.pattern || "(preset)"} v${saved.config_version}`
      : `${saved.enabled ? "auto" : "manual"} ${
          sequenceKind(saved) === "random" ? "random 5-char" : formatFromSettings(saved, 0, "next")
        }`;
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.settings_updated",
      entityId: tenantId,
      details: detail,
    });
    return accountDesk(sql, tenantId, workspace.slug);
  });

export const resetAccountNumberSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.configure"]);
    await resetAccountNumberSettings(sql, tenantId, workspace.slug);
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.settings_reset",
      entityId: tenantId,
    });
    return accountDesk(sql, tenantId, workspace.slug);
  });

export const changeServiceAccountNumberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { service_id: string; account_number: string; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertAny(role, ["services.manage", "account_numbers.assign", "account_numbers.override"]);
    const settings = await getAccountNumberSettings(sql, tenantId);
    const changed = await changeServiceAccountNumber(sql, {
      tenantId,
      serviceId: data.service_id,
      next: data.account_number,
      allowManual: settings.allow_manual,
      actorId: context.userId,
      reason: data.reason || "",
    });
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.service_changed",
      entityId: data.service_id,
      entityType: "service",
      details: `${changed.previous || "(none)"} → ${changed.next}`,
    });
    return changed;
  });

export const reserveAccountNumberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { kind: "number" | "range" | "prefix"; value: string; value_end?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.configure"]);
    await addAccountReservation(sql, tenantId, context.userId, {
      kind: data.kind,
      value: data.value,
      valueEnd: data.value_end,
    });
    return accountDesk(sql, tenantId, workspace.slug);
  });

export const removeAccountReservationFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { id: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.configure"]);
    await removeAccountReservation(sql, tenantId, data.id);
    return accountDesk(sql, tenantId, workspace.slug);
  });

export const testAccountNumbersFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { count?: number }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.view", "account_numbers.configure"]);
    return testAccountNumbers(sql, tenantId, data.count ?? 3);
  });

export const linkLegacyAccountNumberFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { alias: string; account_number: string; entity_type?: string; entity_id?: string; reason?: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, workspace, role } = await requireWs(context.userId);
    assertAny(role, ["settings.manage", "account_numbers.migrate"]);
    await linkLegacyAccountNumber(sql, {
      tenantId,
      alias: data.alias,
      accountNumber: data.account_number,
      entityType: data.entity_type,
      entityId: data.entity_id,
      actorId: context.userId,
      reason: data.reason || "Legacy number linked",
    });
    await auditAccountChange(sql, {
      tenantId,
      userId: context.userId,
      action: "account_number.legacy_linked",
      entityId: data.entity_id || tenantId,
      entityType: data.entity_type || "service",
      details: `${data.alias} → ${data.account_number}`,
    });
    return accountDesk(sql, tenantId, workspace.slug);
  });

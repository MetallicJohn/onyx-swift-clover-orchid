import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  getEtimsView,
  initializeEtimsDevice,
  retryEtimsInvoice,
  saveEtimsPackageMaps,
  saveEtimsSettings,
  testEtimsConnection,
} from "./etims";
import type { EtimsEnvironment } from "./etims-format";
import { assertPermission } from "./rbac";
import { requireWorkspace as requireWs } from "./workspace";

type MapInput = {
  packageId: string;
  itemCd: string;
  itemClsCd: string;
  taxTyCd: string;
  qtyUnitCd: string;
  pkgUnitCd: string;
};

export const getEtimsSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return getEtimsView(sql, tenantId);
  });

export const saveEtimsSettingsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    (d: {
      enabled: boolean;
      environment: EtimsEnvironment;
      kraPin: string;
      branchId: string;
      deviceSerial: string;
      defaultItemCd: string;
      defaultItemClsCd: string;
      defaultTaxTyCd: string;
      defaultQtyUnitCd: string;
      defaultPkgUnitCd: string;
      confirmProduction: boolean;
      maps: MapInput[];
    }) => d,
  )
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    await saveEtimsSettings(sql, tenantId, context.userId, data);
    return saveEtimsPackageMaps(sql, tenantId, data.maps || []);
  });

export const initializeEtimsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { force?: boolean }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return initializeEtimsDevice(sql, tenantId, context.userId, { force: Boolean(data.force) });
  });

export const testEtimsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "settings.manage");
    return testEtimsConnection(sql, tenantId);
  });

export const retryEtimsInvoiceFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((d: { invoiceId: string }) => d)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWs(context.userId);
    assertPermission(role, "invoices.manage");
    await retryEtimsInvoice(sql, tenantId, context.userId, data.invoiceId);
    return getEtimsView(sql, tenantId);
  });

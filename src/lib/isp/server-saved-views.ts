import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { deleteSavedView, listSavedViews, saveSavedView, type SavedViewInput } from "./saved-views";
import { requireWorkspace } from "./workspace";

export const listSavedViewsFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { resource?: string; page?: number }) => ({
    resource: String(data?.resource || ""),
    page: Number(data?.page) || 1,
  }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId } = await requireWorkspace(context.userId);
    return listSavedViews(sql, tenantId, context.userId, data.resource, data.page);
  });

export const saveSavedViewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: SavedViewInput) => data)
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    return saveSavedView(sql, tenantId, context.userId, role, data);
  });

export const deleteSavedViewFn = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((data: { id?: string }) => ({ id: String(data?.id || "") }))
  .handler(async ({ context, data }) => {
    const { sql, tenantId, role } = await requireWorkspace(context.userId);
    return deleteSavedView(sql, tenantId, context.userId, role, data.id);
  });

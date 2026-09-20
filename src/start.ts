import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Pin one Postgres client for the whole HTTP request so RLS GUCs
 * (`app.tenant_id` / `app.bypass_rls`) survive every query. Dynamic import
 * keeps this file safe to load on the client.
 */
const dbSessionMiddleware = createMiddleware().server(async ({ next }) => {
  const { withDbSession } = await import("@/lib/db");
  return withDbSession(async () => next());
});

export const startInstance = createStart(() => ({
  requestMiddleware: [dbSessionMiddleware],
}));

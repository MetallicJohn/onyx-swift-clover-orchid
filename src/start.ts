import { createMiddleware, createStart } from "@tanstack/react-start";

/**
 * Pin one Postgres client for the whole HTTP request so RLS GUCs
 * (`app.tenant_id` / `app.bypass_rls`) survive every query. Health/ready
 * skip the pin so a pool error cannot mark the container unhealthy.
 */
const dbSessionMiddleware = createMiddleware().server(async ({ next, request }) => {
  const path = (() => {
    try {
      return new URL(request.url).pathname;
    } catch {
      return "";
    }
  })();
  if (path === "/api/v1/health" || path === "/api/v1/ready") {
    return await next();
  }
  try {
    const { withDbSession } = await import("@/lib/db");
    return await withDbSession(async () => await next());
  } catch {
    return await next();
  }
});

export const startInstance = createStart(() => ({
  requestMiddleware: [dbSessionMiddleware],
}));

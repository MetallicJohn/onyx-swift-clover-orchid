import { requireUserId, UnauthorizedError } from "@/lib/auth/verify.server";
import { rateLimit } from "./rate-limit";
import { assertPermission } from "./rbac";
import { configContainsSecrets } from "./router-provisioning";
import { requireWorkspace } from "./workspace";

type Perm = "routers.read" | "routers.manage";

export function json(body: unknown, status = 200) {
  if (status < 400 && configContainsSecrets(body)) {
    return Response.json({ error: "Refusing to expose secrets" }, { status: 500 });
  }
  return Response.json(body, { status });
}

export function clientIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function requireRouterApi(request: Request, perm: Perm, limitKey: string, max = 60) {
  const ip = clientIp(request);
  const lim = rateLimit(`routers:${limitKey}:${ip}`, max, 60_000);
  if (!lim.ok) {
    throw Object.assign(new Error("Too many requests"), { status: 429 });
  }
  const header = request.headers.get("authorization") || "";
  const bearer = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
  const userId = await requireUserId(bearer || undefined);
  const { sql, tenantId, role, workspace } = await requireWorkspace(userId);
  assertPermission(role, perm);
  return { sql, tenantId, role, workspace, userId };
}

export async function readJson(request: Request) {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

export function apiError(err: unknown) {
  if (err instanceof UnauthorizedError) return json({ error: "Unauthorized" }, 401);
  const message = err instanceof Error ? err.message : "Request failed";
  const status =
    typeof err === "object" && err && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : /forbidden/i.test(message)
        ? 403
        : /not found/i.test(message)
          ? 404
          : /too many/i.test(message)
            ? 429
            : 400;
  return json({ error: message }, status);
}

import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { rateLimit } from "@/lib/isp/rate-limit";
import { handleRadiusHttp, presentedRadiusKey } from "@/lib/isp/radius-rest";

async function readBody(request: Request) {
  const url = new URL(request.url);
  const fromQuery: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    fromQuery[key] = value;
  });
  if (request.method === "GET" || request.method === "HEAD") return fromQuery;
  const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return { ...fromQuery, ...json };
}

async function handle(request: Request, action: string, slug: string) {
  const lim = rateLimit(`radius:${action}:${slug}`, 180);
  if (!lim.ok) return Response.json({ ok: false, error: "slow down" }, { status: 429 });
  const sql = await getSql();
  const body = await readBody(request);
  const result = await handleRadiusHttp(sql, slug, action, presentedRadiusKey(request), body);
  return Response.json(result.json, { status: result.status });
}

export const Route = createFileRoute("/api/v1/radius/$action/$slug")({
  server: {
    handlers: {
      GET: ({ request, params }) => handle(request, params.action, params.slug),
      POST: ({ request, params }) => handle(request, params.action, params.slug),
    },
  },
});

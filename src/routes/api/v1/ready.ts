import { createFileRoute } from "@tanstack/react-router";
import { buildHealthReport, healthcheckAuthorized } from "@/lib/isp/health";

export const Route = createFileRoute("/api/v1/ready")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!healthcheckAuthorized(request)) {
          return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
        }
        const report = await buildHealthReport("ready");
        return Response.json(report, { status: report.ready ? 200 : 503 });
      },
    },
  },
});

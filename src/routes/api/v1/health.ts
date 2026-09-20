import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      GET: async () => {
        let database = "skipped";
        try {
          const { getSql } = await import("@/lib/db");
          const sql = await getSql();
          await sql`select 1 as ok`;
          database = "ok";
        } catch {
          database = "error";
        }
        // HTTP 200 even if the database is down — compose health must not
        // take the whole stack down because Postgres is still warming.
        return Response.json({
          ok: true,
          service: "ispsolutions-web",
          role: process.env.ROLE || "web",
          database,
          sha: process.env.ISPSOLUTIONS_GIT_SHA || process.env.GRIDLINE_GIT_SHA || "",
        });
      },
    },
  },
});

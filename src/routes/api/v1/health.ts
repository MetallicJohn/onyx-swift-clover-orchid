import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";

export const Route = createFileRoute("/api/v1/health")({
  server: {
    handlers: {
      GET: async () => {
        let database = "error";
        try {
          const sql = await getSql();
          await sql`select 1 as ok`;
          database = "ok";
        } catch {
          database = "error";
        }
        return Response.json({
          ok: database === "ok",
          service: "ispsolutions-web",
          role: process.env.ROLE || "web",
          database,
          sha: process.env.ISPSOLUTIONS_GIT_SHA || process.env.GRIDLINE_GIT_SHA || "",
        });
      },
    },
  },
});

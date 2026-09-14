import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { handleAcsAuthRequest } from "@/lib/isp/acs-security";
import { applyRls } from "@/lib/isp/rls";

export const Route = createFileRoute("/api/internal/acs-auth")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const sql = await getSql();
        await applyRls(sql, { bypass: true });
        try {
          return await handleAcsAuthRequest(sql, request);
        } finally {
          await applyRls(sql, { bypass: false });
        }
      },
    },
  },
});

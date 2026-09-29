import { createFileRoute } from "@tanstack/react-router";
import { getSessionUser } from "@/lib/auth/verify.server";
import { assertPermission } from "@/lib/isp/rbac";
import { subscribeTicketLive } from "@/lib/isp/ticket-stream";
import { requireWorkspace } from "@/lib/isp/workspace";

export const Route = createFileRoute("/api/tickets/live")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const user = await getSessionUser();
        if (!user) return new Response("Unauthorized", { status: 401 });
        const { role, tenantId } = await requireWorkspace(user.id);
        assertPermission(role, "tickets.read");
        const encoder = new TextEncoder();
        let unsubscribe = () => {};
        let ping: ReturnType<typeof setInterval> | undefined;
        const stream = new ReadableStream({
          start(controller) {
            const send = (payload: unknown) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
            };
            send({ type: "ready" });
            unsubscribe = subscribeTicketLive(tenantId, (event) => {
              send({ type: event.type, ticketId: event.ticketId, summary: event.summary });
            });
            ping = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(`: ping\n\n`));
              } catch {
                /* closed */
              }
            }, 25_000);
            const stop = () => {
              if (ping) clearInterval(ping);
              unsubscribe();
              try {
                controller.close();
              } catch {
                /* already closed */
              }
            };
            request.signal.addEventListener("abort", stop);
          },
          cancel() {
            if (ping) clearInterval(ping);
            unsubscribe();
          },
        });
        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});

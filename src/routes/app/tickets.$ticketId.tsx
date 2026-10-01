import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { TicketsDesk } from "@/routes/app/tickets";

export const Route = createFileRoute("/app/tickets/$ticketId")({
  component: TicketRecordPage,
});

function TicketRecordPage() {
  const { ticketId } = Route.useParams();
  const [search, setSearch] = useState<{
    q?: string;
    status?: string;
    priority?: string;
    category?: string;
    assigned?: string;
    page?: number;
    pageSize?: number;
  }>({});
  return (
    <div className="space-y-3">
      <Link to="/app/tickets" className="text-sm text-accent hover:underline">
        All tickets
      </Link>
      <TicketsDesk openId={ticketId} search={search} onSearch={setSearch} />
    </div>
  );
}

import { createFileRoute, Link } from "@tanstack/react-router";
import { LeadsDesk } from "@/components/isp/leads-desk";

export const Route = createFileRoute("/app/leads/$leadId")({
  component: LeadRecordPage,
});

function LeadRecordPage() {
  const { leadId } = Route.useParams();
  return (
    <div className="space-y-4">
      <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1">
        <Link
          to="/app/customers"
          className="inline-flex h-11 shrink-0 items-center rounded-lg px-4 text-sm font-medium text-muted hover:bg-elevated hover:text-fg"
        >
          Customers
        </Link>
        <Link
          to="/app/leads"
          className="inline-flex h-11 shrink-0 items-center rounded-lg px-4 text-sm font-medium text-muted hover:bg-elevated hover:text-fg"
        >
          Leads
        </Link>
      </div>
      <LeadsDesk focusId={leadId} />
    </div>
  );
}

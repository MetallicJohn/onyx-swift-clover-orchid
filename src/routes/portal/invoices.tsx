import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { EmptyState, ErrorBanner, InvoiceRow, PortalCard } from "@/components/isp/portal-ui";
import { Button } from "@/components/ui/button";
import { downloadPdf, printPdf } from "@/lib/isp/pdf-client";
import { portalInvoicePdf, portalStatementPdf } from "@/lib/isp/server-docs";
import { usePortal } from "../portal";
import { useState } from "react";

export const Route = createFileRoute("/portal/invoices")({ component: PortalInvoices });

function PortalInvoices() {
  const { home, token } = usePortal();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  async function pdf(id: string, print = false) {
    setError(null);
    try {
      const file = await portalInvoicePdf({ data: { token, id } });
      if (print) printPdf(file);
      else downloadPdf(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open invoice");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted">Your bills and statement for this account.</p>
        </div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                const file = await portalStatementPdf({ data: { token } });
                downloadPdf(file);
              } catch (e) {
                setError(e instanceof Error ? e.message : "Could not download statement");
              }
            }}
          >
            Statement PDF
          </Button>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {!home.invoices.length ? (
        <EmptyState title="No invoices yet" body="Invoices raised for your services will show here." />
      ) : (
        <PortalCard>
          <ul>
            {home.invoices.map((inv) => (
              <InvoiceRow
                key={inv.id}
                invoice={inv}
                onPay={inv.balance_kes > 0 ? () => void navigate({ href: `/portal/pay?invoice=${encodeURIComponent(inv.id)}` }) : undefined}
                onPdf={() => void pdf(inv.id)}
                onPrint={() => void pdf(inv.id, true)}
              />
            ))}
          </ul>
        </PortalCard>
      )}
    </div>
  );
}

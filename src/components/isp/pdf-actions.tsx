import { Download, Eye, Mail, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PdfActions({
  busy,
  note,
  error,
  canEmail = true,
  onView,
  onDownload,
  onPrint,
  onEmail,
}: {
  busy?: boolean;
  note?: string | null;
  error?: string | null;
  canEmail?: boolean;
  onView: () => void;
  onDownload: () => void;
  onPrint: () => void;
  onEmail?: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} onClick={onView}>
          <Eye className="size-4" /> View PDF
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onDownload}>
          <Download className="size-4" /> Download
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={onPrint}>
          <Printer className="size-4" /> Print
        </Button>
        {onEmail ? (
          <Button size="sm" disabled={busy || !canEmail} onClick={onEmail}>
            <Mail className="size-4" /> Email
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {note ? <p className="text-sm text-ok">{note}</p> : null}
    </div>
  );
}

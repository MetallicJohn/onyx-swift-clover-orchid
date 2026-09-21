import { Copy, Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AUTOCOPY_FAIL, copyScriptLabel, copyText, downloadTextFile } from "@/lib/copy-text";
import {
  primaryScript,
  rscFilename,
  scriptSections,
  type RosScriptPack,
  type RosScriptSection,
} from "@/lib/isp/ros-script-pack";

export type { RosScriptPack, RosScriptSection };
export { primaryScript, scriptSections, rscFilename };
export const RouterOSScriptDialog = RosScriptDialog;

function CopyButton({
  body,
  copied,
  onCopied,
}: {
  body: string;
  copied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <Button
      type="button"
      size="md"
      className="h-11 shrink-0"
      onClick={async () => {
        onCopied(await copyText(body));
      }}
    >
      <Copy className="size-4" />
      {copyScriptLabel(copied)}
    </Button>
  );
}

function DownloadButton({ filename, body }: { filename: string; body: string }) {
  return (
    <Button
      type="button"
      size="md"
      variant="secondary"
      className="h-11 shrink-0"
      onClick={() => downloadTextFile(filename, body)}
    >
      <Download className="size-4" />
      Download .rsc
    </Button>
  );
}

function ScriptBlock({
  section,
  filename,
  copied,
  onCopied,
}: {
  section: RosScriptSection;
  filename: string;
  copied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{section.label}</p>
        <div className="flex flex-wrap gap-2">
          <CopyButton body={section.body} copied={copied} onCopied={onCopied} />
          <DownloadButton filename={filename} body={section.body} />
        </div>
      </div>
      <div className="relative">
        <Button
          type="button"
          size="sm"
          className="absolute top-2 right-2 z-10 h-9 shadow-card"
          onClick={async () => {
            onCopied(await copyText(section.body));
          }}
        >
          <Copy className="size-3.5" />
          {copyScriptLabel(copied)}
        </Button>
        <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-elevated p-4 pr-28 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-fg">
          {section.body}
        </pre>
      </div>
    </div>
  );
}

export function RosScriptDialog({
  pack,
  onClose,
}: {
  pack: RosScriptPack | null;
  onClose: () => void;
}) {
  const sections = useMemo(() => scriptSections(pack), [pack]);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    setCopiedKey(null);
    setCopyError("");
    const first = sections[0];
    if (!first) return;
    void copyText(first.body).then((ok) => {
      if (ok) {
        setCopiedKey(first.key);
        setTimeout(() => setCopiedKey((k) => (k === first.key ? null : k)), 2500);
      }
    });
  }, [sections]);

  function markCopied(key: string, ok: boolean) {
    if (!ok) {
      setCopyError(AUTOCOPY_FAIL);
      return;
    }
    setCopyError("");
    setCopiedKey(key);
    setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2500);
  }

  const first = sections[0];
  const filenameFor = (section: RosScriptSection) =>
    rscFilename({
      routerId: pack?.routerId,
      identity: pack?.identity,
      kind: section.kind,
    });

  return (
    <Dialog
      open={Boolean(pack)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={pack?.title || "RouterOS Enrollment Script"}
      description={pack?.description || "Paste in New Terminal. Copy Script copies the exact script shown."}
      className="sm:max-w-2xl"
      footer={
        first ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => (
                <CopyButton
                  key={section.key}
                  body={section.body}
                  copied={copiedKey === section.key}
                  onCopied={(ok) => markCopied(section.key, ok)}
                />
              ))}
              {first ? <DownloadButton filename={filenameFor(first)} body={first.body} /> : null}
            </div>
            <Button type="button" variant="secondary" className="h-11" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : null
      }
    >
      {pack?.identity ? (
        <p className="mb-3 text-sm text-muted">
          Router: <span className="font-medium text-fg">{pack.identity}</span>
          {pack.routerId ? <span className="ml-2 font-mono text-xs">{pack.routerId}</span> : null}
        </p>
      ) : null}
      {sections.length === 0 ? (
        <p className="text-sm text-muted">No script to copy.</p>
      ) : (
        <div className="space-y-5">
          {copyError ? <p className="text-sm text-danger">{copyError}</p> : null}
          {sections.map((section) => (
            <ScriptBlock
              key={section.key}
              section={section}
              filename={filenameFor(section)}
              copied={copiedKey === section.key}
              onCopied={(ok) => markCopied(section.key, ok)}
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}

import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { copyText } from "@/lib/copy-text";
import {
  primaryScript,
  scriptSections,
  type RosScriptPack,
  type RosScriptSection,
} from "@/lib/isp/ros-script-pack";

export type { RosScriptPack, RosScriptSection };
export { primaryScript, scriptSections };

function CopyButton({
  body,
  label,
  copied,
  onCopied,
}: {
  body: string;
  label: string;
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
      {copied ? "Copied" : `Copy ${label}`}
    </Button>
  );
}

function ScriptBlock({
  section,
  copied,
  onCopied,
}: {
  section: RosScriptSection;
  copied: boolean;
  onCopied: (ok: boolean) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{section.label}</p>
        <CopyButton body={section.body} label={section.label} copied={copied} onCopied={onCopied} />
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
          {copied ? "Copied" : "Copy"}
        </Button>
        <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-elevated p-4 pr-24 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-fg">
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

  useEffect(() => {
    setCopiedKey(null);
    const first = sections[0];
    if (!first) return;
    void copyText(first.body).then((ok) => {
      if (ok) {
        setCopiedKey(first.key);
        setTimeout(() => setCopiedKey((k) => (k === first.key ? null : k)), 2500);
      }
    });
  }, [sections]);

  return (
    <Dialog
      open={Boolean(pack)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={pack?.title || "RouterOS v7 scripts"}
      description="Paste in New Terminal. Each script has a Copy button."
      className="sm:max-w-2xl"
      footer={
        sections.length ? (
          <div className="flex flex-wrap gap-2">
            {sections.map((section) => (
              <CopyButton
                key={section.key}
                body={section.body}
                label={section.label}
                copied={copiedKey === section.key}
                onCopied={(ok) => {
                  if (!ok) return;
                  setCopiedKey(section.key);
                  setTimeout(() => setCopiedKey((k) => (k === section.key ? null : k)), 2500);
                }}
              />
            ))}
          </div>
        ) : null
      }
    >
      {sections.length === 0 ? (
        <p className="text-sm text-muted">No script to copy.</p>
      ) : (
        <div className="space-y-5">
          {sections.map((section) => (
            <ScriptBlock
              key={section.key}
              section={section}
              copied={copiedKey === section.key}
              onCopied={(ok) => {
                if (!ok) return;
                setCopiedKey(section.key);
                setTimeout(() => setCopiedKey((k) => (k === section.key ? null : k)), 2500);
              }}
            />
          ))}
        </div>
      )}
    </Dialog>
  );
}

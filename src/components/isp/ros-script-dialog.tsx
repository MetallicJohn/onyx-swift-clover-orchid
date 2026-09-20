import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { copyText } from "@/lib/copy-text";
import { cn } from "@/lib/utils";

export type RosScriptPack = {
  title?: string;
  bootstrap?: string;
  enroll?: string;
  extraLabel?: string;
  extra?: string;
};

function ScriptBlock({
  label,
  hint,
  body,
  auto,
}: {
  label: string;
  hint: string;
  body: string;
  auto: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy(now = false) {
    const ok = await copyText(body);
    setState(ok ? "copied" : "failed");
    if (!now) setTimeout(() => setState("idle"), 2500);
    return ok;
  }

  useEffect(() => {
    if (!auto || !body) return;
    void copy(true).then(() => {
      setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2500);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, auto]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted">{hint}</p>
        </div>
        <Button type="button" size="sm" onClick={() => void copy()}>
          <Copy className="size-3.5" />
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : `Copy ${label.toLowerCase()}`}
        </Button>
      </div>
      <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-elevated p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all text-fg">
        {body}
      </pre>
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
  const bootstrap = pack?.bootstrap?.trim() || "";
  const enroll = pack?.enroll?.trim() || "";
  const extra = pack?.extra?.trim() || "";
  const autoTarget = bootstrap ? "bootstrap" : enroll ? "enroll" : extra ? "extra" : "";

  return (
    <Dialog
      open={Boolean(pack)}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={pack?.title || "RouterOS v7 scripts"}
      description="Paste in New Terminal. HTTPS fetch uses check-certificate=no."
      className="sm:max-w-2xl"
    >
      <div className={cn("space-y-5")}>
        {bootstrap ? (
          <ScriptBlock
            label="Bootstrap"
            hint="Short paste. Downloads the full enroll file over HTTPS."
            body={bootstrap}
            auto={autoTarget === "bootstrap"}
          />
        ) : null}
        {enroll ? (
          <ScriptBlock
            label="Enroll"
            hint="Full script: WireGuard, hub peer, API user, agent pull."
            body={enroll}
            auto={autoTarget === "enroll"}
          />
        ) : null}
        {extra ? (
          <ScriptBlock
            label={pack?.extraLabel || "Script"}
            hint="Paste in New Terminal."
            body={extra}
            auto={autoTarget === "extra"}
          />
        ) : null}
      </div>
    </Dialog>
  );
}

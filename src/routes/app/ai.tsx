import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { askRouterOs } from "@/lib/isp/server-more";
import { queueRouterCommand } from "@/lib/isp/server-mikrotik";
import { listRouters } from "@/lib/isp/server";

export const Route = createFileRoute("/app/ai")({ component: AiPage });

function AiPage() {
  const [prompt, setPrompt] = useState("Create a PPPoE secret for user1 on profile 10Mbps, disabled=no");
  const [script, setScript] = useState("");
  const [model, setModel] = useState("");
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">MikroTik assistant</h1>
        <p className="text-sm text-muted">
          Generates RouterOS v7. Destructive paste still goes through Approve on Routers. Does not push to the device by itself.
        </p>
      </div>
      <form
        className="grid gap-3 rounded-xl border border-border bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setNote(null);
          const r = await askRouterOs({ data: { prompt } });
          setScript(r.script);
          setModel(r.model);
        }}
      >
        <Field label="Describe the change">
          <textarea
            className="min-h-28 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </Field>
        <Button type="submit">Generate script</Button>
      </form>
      {script ? (
        <div className="space-y-3">
          <p className="text-xs text-muted">Model: {model}</p>
          <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-elevated p-4 text-xs">{script}</pre>
          <Button
            variant="secondary"
            onClick={async () => {
              const routers = await listRouters();
              const id = routers.routers[0]?.id;
              if (!id) {
                setNote("Add a router first");
                return;
              }
              await queueRouterCommand({ data: { router_id: id, kind: "raw.script", payload: { script } } });
              setNote("Queued as raw.script — Approve it on Routers before the agent pulls.");
            }}
          >
            Queue as proposed command
          </Button>
          {note ? <p className="text-sm text-accent">{note}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

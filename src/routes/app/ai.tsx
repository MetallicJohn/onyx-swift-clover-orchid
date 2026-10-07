import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { Button } from "@/components/ui/button";
import { askConfirm } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/input";
import {
  approveMikrotikPlanFn,
  askMikrotikAssistantFn,
  cancelMikrotikPlanFn,
  getMikrotikAssistantFn,
  rollbackMikrotikPlanFn,
  setMikrotikAssistantEnabledFn,
  setMikrotikAssistantWriteFn,
} from "@/lib/isp/server-mikrotik-assistant";
import { askRouterOs } from "@/lib/isp/server-more";
import { queueRouterCommand } from "@/lib/isp/server-mikrotik";

export const Route = createFileRoute("/app/ai")({ component: AiPage });

const actionButton: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  minHeight: 48,
  padding: "0 16px",
  borderRadius: 8,
  border: "1px solid #4aa8a0",
  background: "#4aa8a0",
  color: "#061014",
  fontWeight: 600,
  fontSize: 15,
  cursor: "pointer",
};

const quietButton: CSSProperties = {
  ...actionButton,
  background: "#172028",
  color: "#e8eef4",
  border: "1px solid #4aa8a0",
};

const QUICK = [
  ["Diagnose router", "Diagnose this router"],
  ["Diagnose WAN", "Diagnose the WAN path"],
  ["Slow internet", "Why is the internet slow?"],
  ["PPPoE", "Diagnose PPPoE sessions"],
  ["Hotspot", "Diagnose hotspot"],
  ["Routing", "Diagnose routing"],
  ["Firewall", "Check the firewall"],
  ["CPU / memory", "Check CPU and memory"],
] as const;

type Desk = Awaited<ReturnType<typeof getMikrotikAssistantFn>>;
type PlanCard = Desk["plans"][number];
type Turn = { role: "user" | "assistant"; body: string; tools?: { name: string; status: string }[] };

function modeLabel(row: Desk["routers"][number] | null) {
  if (!row?.ai_enabled) return "AI disabled";
  if (row.ai_write_enabled) return "Writes need approval";
  return "Read-only";
}

function AiPage() {
  const [desk, setDesk] = useState<Desk | null>(null);
  const [plans, setPlans] = useState<PlanCard[]>([]);
  const [routerId, setRouterId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scriptPrompt, setScriptPrompt] = useState("Create a PPPoE secret for user1 on profile 10Mbps, disabled=no");
  const [script, setScript] = useState("");
  const [model, setModel] = useState("");
  const [note, setNote] = useState("");

  function load() {
    return getMikrotikAssistantFn()
      .then((next) => {
        setDesk(next);
        setPlans(next.plans);
        setRouterId((current) => current || next.routers[0]?.id || "");
        setError("");
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : "Could not open the assistant"));
  }

  useEffect(() => {
    void load();
  }, []);

  const router = desk?.routers.find((row) => row.id === routerId) || null;
  const visiblePlans = plans.filter((plan) => plan.routerId === routerId);

  async function enableAssistant() {
    if (!router) {
      setError("Select a router first. If the list is empty, add one under Network → Routers.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setMikrotikAssistantEnabledFn({ data: { router_id: router.id, enabled: !router.ai_enabled } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update AI policy");
    } finally {
      setBusy(false);
    }
  }

  async function allowWrites() {
    if (!router) {
      setError("Select a router first. If the list is empty, add one under Network → Routers.");
      return;
    }
    if (!router.ai_write_enabled) {
      const ok = await askConfirm({
        title: "Allow approved writes on this router?",
        description: `Chat still cannot change ${router.name}. Only a reviewed plan can be applied, and only after you type the router name. Safe Mode is not available on the overlay API.`,
        confirmLabel: "Allow approved writes",
        pendingLabel: "Saving…",
        variant: "warning",
        confirmPhrase: router.name,
        action: async () => {
          if (!router.ai_enabled) {
            await setMikrotikAssistantEnabledFn({ data: { router_id: router.id, enabled: true } });
          }
          await setMikrotikAssistantWriteFn({ data: { router_id: router.id, enabled: true } });
        },
      });
      if (ok) await load();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await setMikrotikAssistantWriteFn({ data: { router_id: router.id, enabled: false } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update AI policy");
    } finally {
      setBusy(false);
    }
  }

  async function approve(plan: PlanCard) {
    if (!router) return;
    const needsWrite = !router.ai_write_enabled || !router.ai_enabled;
    const ok = await askConfirm({
      title: "Review network change",
      description: `Router ${plan.routerName}. Change: ${plan.objective} Risk ${plan.risk}. Affected: ${plan.affected.join(", ") || "UNKNOWN"}. Rollback: ${plan.rollbackSummaries[0] || "UNKNOWN"}. Safe Mode is not available on the overlay API. This commits only if verification passes.${needsWrite ? " Confirming also turns on approved writes for this router." : ""}`,
      confirmLabel: "Approve & Apply",
      pendingLabel: "Applying…",
      variant: "warning",
      confirmPhrase: plan.routerName,
      action: async () => {
        if (!router.ai_enabled) {
          await setMikrotikAssistantEnabledFn({ data: { router_id: router.id, enabled: true } });
        }
        if (!router.ai_write_enabled) {
          await setMikrotikAssistantWriteFn({ data: { router_id: router.id, enabled: true } });
        }
        const result = await approveMikrotikPlanFn({ data: { plan_id: plan.id } });
        setPlans((prev) => prev.map((item) => (item.id === result.plan.id ? result.plan : item)));
        setTurns((prev) => [...prev, { role: "assistant", body: result.message }]);
      },
    });
    if (ok) await load();
  }

  async function cancel(plan: PlanCard) {
    setBusy(true);
    setError("");
    try {
      const next = await cancelMikrotikPlanFn({ data: { plan_id: plan.id } });
      setPlans((prev) => prev.map((item) => (item.id === next.id ? next : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the plan");
    } finally {
      setBusy(false);
    }
  }

  async function prepareRollback(plan: PlanCard) {
    setBusy(true);
    setError("");
    try {
      const next = await rollbackMikrotikPlanFn({ data: { plan_id: plan.id } });
      setPlans((prev) => [next, ...prev.filter((item) => item.id !== next.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare the rollback");
    } finally {
      setBusy(false);
    }
  }

  async function ask(text: string) {
    const question = text.trim();
    if (!routerId) {
      setError("Select a router first. If the list is empty, add one under Network → Routers.");
      return;
    }
    if (question.length < 3 || busy) return;
    setBusy(true);
    setError("");
    setTurns((prev) => [...prev, { role: "user", body: question }]);
    setPrompt("");
    try {
      const result = await askMikrotikAssistantFn({
        data: { router_id: routerId, prompt: question, conversation_id: conversationId },
      });
      setConversationId(result.conversationId);
      if (result.plan) {
        setPlans((prev) => [result.plan, ...prev.filter((plan) => plan.id !== result.plan?.id)]);
      }
      setTurns((prev) => [...prev, { role: "assistant", body: result.body, tools: result.tools }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The check did not finish");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">MikroTik Assistant</h1>
          <p className="text-sm text-muted">
            A question only reads the router. A change becomes a plan and stays unapplied until you approve the exact commands.
          </p>
        </div>
        <p className="text-xs text-muted">
          MCP {desk?.mcp.status || "…"}
          {desk?.pinned ? ` · ${desk.pinned}` : ""}
        </p>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <section
        className="space-y-3 rounded-xl border border-border bg-surface p-4"
        style={{ position: "sticky", top: 64, zIndex: 15 }}
      >
        <h2 className="text-base font-semibold">Review network change</h2>
        <p className="text-sm text-muted">
          These controls stay on this page. Nothing is sent to the router until Approve & Apply confirms the exact commands.
        </p>
        <button type="button" style={actionButton} onClick={() => void enableAssistant()}>
          {router?.ai_enabled ? "Disable assistant" : "Enable assistant"}
        </button>
        <button type="button" style={actionButton} onClick={() => void allowWrites()}>
          {router?.ai_write_enabled ? "Stop approved writes" : "Allow approved writes"}
        </button>
        <button type="button" style={quietButton} onClick={() => void ask("Make WAN2 preferred between 7pm and 11pm.")}>
          Draft change plan
        </button>
        <button
          type="button"
          style={actionButton}
          onClick={() => {
            const plan = visiblePlans.find((item) => item.state === "AWAITING_APPROVAL" && item.executable);
            if (!plan) {
              setError("Draft change plan first. Approve & Apply appears on the plan and also stays on this card.");
              return;
            }
            void approve(plan);
          }}
        >
          Approve & Apply
        </button>
        <button
          type="button"
          style={quietButton}
          onClick={() => {
            const plan = visiblePlans.find((item) => item.state === "AWAITING_APPROVAL");
            if (!plan) {
              setError("There is no plan to cancel.");
              return;
            }
            void cancel(plan);
          }}
        >
          Cancel plan
        </button>
      </section>

      <section className="grid gap-3 rounded-xl border border-border bg-surface p-4 md:grid-cols-[1fr_auto_auto]">
        <label className="grid gap-1 text-sm">
          <span className="text-muted">Router</span>
          <select
            className="h-11 rounded-md border border-border bg-bg px-3"
            value={routerId}
            onChange={(e) => {
              setRouterId(e.target.value);
              setTurns([]);
              setConversationId("");
            }}
          >
            {desk?.routers.length ? null : <option value="">No routers</option>}
            {desk?.routers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
                {row.identity ? ` · ${row.identity}` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="text-sm">
          <p className="text-muted">Mode</p>
          <p className="mt-2 font-medium">{modeLabel(router)}</p>
        </div>
        <div className="text-sm">
          <p className="text-muted">Router</p>
          <p className="mt-2 font-medium">{router?.last_seen ? "Last seen" : "Not seen"}</p>
          <p className="text-xs text-muted">{router?.last_seen || "Reachability is checked when you ask."}</p>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap gap-2">
          {QUICK.map(([label, question]) => (
            <Button key={label} size="sm" variant="secondary" disabled={!routerId || busy || desk?.canDiagnose === false} onClick={() => void ask(question)}>
              {label}
            </Button>
          ))}
        </div>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(prompt);
          }}
        >
          <Field label="Ask about this router">
            <textarea
              className="min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
              value={prompt}
              placeholder="Why is WAN2 slow?"
              onChange={(e) => setPrompt(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={!routerId || busy || desk?.canChat === false}>
            {busy ? "Checking…" : "Ask"}
          </Button>
        </form>
        <div className="space-y-3">
          {turns.map((turn, index) => (
            <article key={`${turn.role}-${index}`} className="rounded-lg border border-border bg-bg p-3">
              <p className="text-xs uppercase tracking-wide text-muted">{turn.role === "user" ? "You" : "Assistant"}</p>
              <pre className="mt-2 whitespace-pre-wrap font-sans text-sm">{turn.body}</pre>
              {turn.tools?.length ? (
                <ul className="mt-2 space-y-1 text-xs text-muted">
                  {turn.tools.map((tool) => (
                    <li key={tool.name}>
                      {tool.status === "ok" ? "✓" : "–"} {tool.name} · {tool.status}
                    </li>
                  ))}
                </ul>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div>
          <h2 className="text-sm font-medium">Change plans</h2>
          <p className="text-xs text-muted">
            Approve applies only the commands listed here. Safe Mode is not available on the overlay API. If verification fails, the inverse commands run once and must themselves check out. A committed change is rolled back only by a second approved plan.
          </p>
        </div>
        {visiblePlans.length ? null : <p className="text-sm text-muted">No plans for this router.</p>}
        {visiblePlans.map((plan) => (
          <article key={plan.id} className="space-y-2 rounded-lg border border-border bg-bg p-3">
            <p className="text-xs uppercase tracking-wide text-muted">
              {plan.intent === "rollback" ? "Rollback" : "Change"} · {plan.state} · {plan.risk}
            </p>
            <p className="text-sm font-medium">{plan.objective}</p>
            <p className="text-sm">Current: {plan.current}</p>
            <p className="text-sm">Proposed: {plan.proposed}</p>
            <p className="text-sm">Affected: {plan.affected.join(", ") || "UNKNOWN"}</p>
            <p className="text-sm">Unaffected: {plan.unaffected.join(", ") || "UNKNOWN"}</p>
            <p className="text-sm">Rollback: {plan.rollbackSummaries.join(" ") || "None yet"}</p>
            <p className="text-sm">Safe Mode: not available</p>
            {plan.blockReason ? <p className="text-sm text-muted">{plan.blockReason}</p> : null}
            {plan.commands.length ? (
              <pre className="overflow-auto rounded-md border border-border bg-elevated p-3 text-xs">{plan.commands.join("\n")}</pre>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {plan.state === "AWAITING_APPROVAL" && plan.executable && desk?.canApprove !== false ? (
                <Button type="button" disabled={busy || desk?.canApprove === false} onClick={() => void approve(plan)}>
                  Approve & Apply
                </Button>
              ) : null}
              {plan.state === "AWAITING_APPROVAL" && plan.executable && !router?.ai_write_enabled ? (
                <p className="w-full text-xs text-muted">Approved writes are still off. Approve & Apply will ask you to turn them on for this router.</p>
              ) : null}
              {plan.state === "AWAITING_APPROVAL" && desk?.canPlan ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void cancel(plan)}>
                  Cancel
                </Button>
              ) : null}
              {plan.state === "COMMITTED" && desk?.canRollback ? (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void prepareRollback(plan)}>
                  Prepare rollback
                </Button>
              ) : null}
            </div>
          </article>
        ))}
      </section>

      {desk?.canEnable ? (
        <section className="space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <h2 className="text-sm font-medium">Draft a script</h2>
            <p className="text-xs text-muted">
              This only drafts RouterOS text. It does not push. Queue it, then approve it on Routers.
            </p>
          </div>
          <form
            className="grid gap-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setNote("");
              const result = await askRouterOs({ data: { prompt: scriptPrompt } });
              setScript(result.script);
              setModel(result.model);
            }}
          >
            <Field label="Describe the change">
              <textarea
                className="min-h-24 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm"
                value={scriptPrompt}
                onChange={(e) => setScriptPrompt(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary">
              Generate script
            </Button>
          </form>
          {script ? (
            <div className="space-y-3">
              <p className="text-xs text-muted">Model: {model}</p>
              <pre className="max-h-80 overflow-auto rounded-xl border border-border bg-elevated p-4 text-xs">{script}</pre>
              <Button
                variant="secondary"
                onClick={async () => {
                  if (!routerId) {
                    setNote("Select a router first");
                    return;
                  }
                  await queueRouterCommand({ data: { router_id: routerId, kind: "raw.script", payload: { script } } });
                  setNote("Queued as raw.script. Approve it on Routers before the agent pulls.");
                }}
              >
                Queue as proposed command
              </Button>
              {note ? <p className="text-sm text-accent">{note}</p> : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

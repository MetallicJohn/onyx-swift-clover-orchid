import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

export type SetupStep = {
  id: string;
  label: string;
  done: boolean;
  to: "/app/settings" | "/app/packages" | "/app/routers" | "/app/customers" | "/app/billing" | "/app/notifications";
};

const DISMISS_KEY = "isp-setup-checklist-dismissed";

export function setupProgress(steps: SetupStep[]) {
  const done = steps.filter((step) => step.done).length;
  return { done, total: steps.length, complete: done === steps.length };
}

export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const progress = setupProgress(steps);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);
  if (progress.complete || dismissed) return null;
  return (
    <section className="rounded-xl border border-border bg-surface p-4" aria-label="Setup checklist">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium">Complete your ISP setup</h2>
          <p className="mt-1 text-xs text-muted">
            {progress.done} of {progress.total} completed
          </p>
        </div>
        <button
          type="button"
          className="text-xs text-muted hover:text-fg"
          onClick={() => {
            try {
              sessionStorage.setItem(DISMISS_KEY, "1");
            } catch {
              /* ignore */
            }
            setDismissed(true);
          }}
        >
          Dismiss
        </button>
      </div>
      <ul className="mt-3 grid gap-1">
        {steps.map((step) => (
          <li key={step.id}>
            <Link to={step.to} className="flex h-11 items-center gap-2 text-sm hover:text-accent">
              <span aria-hidden className={step.done ? "text-ok" : "text-muted"}>
                {step.done ? "✓" : "○"}
              </span>
              <span className={step.done ? "text-muted" : ""}>{step.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

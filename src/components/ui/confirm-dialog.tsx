import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  confirmButtonLabel,
  confirmCanDismiss,
  confirmLabels,
  phraseAccepted,
  type ConfirmOptions,
  type ConfirmPhase,
} from "@/lib/isp/ui-shell";

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((options: ConfirmOptions) => Promise<boolean>) | null>(null);

let asker: ((options: ConfirmOptions) => Promise<boolean>) | null = null;

/** Imperative confirm for existing click handlers. Uses the shared dialog once the provider is mounted. */
export function askConfirm(options: ConfirmOptions) {
  if (!asker) return Promise.resolve(false);
  return asker(options);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [phase, setPhase] = useState<ConfirmPhase>("idle");
  const [error, setError] = useState("");
  const [phrase, setPhrase] = useState("");

  const ask = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPhase("idle");
      setError("");
      setPhrase("");
      setPending({ ...options, resolve });
    });
  }, []);

  asker = ask;

  function finish(ok: boolean) {
    if (!pending || !confirmCanDismiss(phase)) return;
    pending.resolve(ok);
    setPending(null);
    setPhase("idle");
    setError("");
    setPhrase("");
  }

  async function confirm() {
    if (!pending || phase === "loading") return;
    const view = confirmLabels(pending);
    if (view.confirmPhrase && !phraseAccepted(view.confirmPhrase, phrase)) {
      setError(`Type ${view.confirmPhrase} to continue`);
      setPhase("error");
      return;
    }
    if (!pending.action) {
      finish(true);
      return;
    }
    setPhase("loading");
    setError("");
    try {
      await pending.action();
      pending.resolve(true);
      setPending(null);
      setPhase("idle");
      setPhrase("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed");
      setPhase("error");
    }
  }

  const view = pending ? confirmLabels(pending) : null;
  const loading = phase === "loading";

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {view && pending ? (
        <Dialog
          open
          onOpenChange={(next) => {
            if (!next) finish(false);
          }}
          title={view.title}
          footer={
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => finish(false)} disabled={loading}>
                {view.cancelLabel}
              </Button>
              <Button
                type="button"
                variant={view.variant === "danger" ? "danger" : "default"}
                aria-busy={loading}
                disabled={loading || (Boolean(view.confirmPhrase) && !phraseAccepted(view.confirmPhrase, phrase))}
                onClick={() => void confirm()}
              >
                {confirmButtonLabel(view.confirmLabel, phase, view.pendingLabel)}
              </Button>
            </div>
          }
        >
          {view.description ? <p className="text-sm text-muted">{view.description}</p> : null}
          {view.confirmPhrase ? (
            <label className="mt-3 block text-sm">
              <span className="text-muted">
                To continue, type <span className="font-medium text-fg">{view.confirmPhrase}</span>
              </span>
              <input
                className="mt-2 h-11 w-full rounded-md border border-border bg-bg px-3 text-sm"
                value={phrase}
                autoComplete="off"
                aria-label={`Type ${view.confirmPhrase}`}
                onChange={(event) => setPhrase(event.target.value)}
                disabled={loading}
              />
            </label>
          ) : null}
          {error ? (
            <p className="mt-3 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ask = useContext(ConfirmContext);
  return ask || askConfirm;
}

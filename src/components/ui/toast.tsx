import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { pushToast, type ToastInput, type ToastItem, type ToastKind } from "@/lib/isp/ui-shell";
import { cn } from "@/lib/utils";

type ToastApi = {
  push: (toast: ToastInput) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  warning: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const DISMISS_MS: Record<ToastKind, number> = {
  success: 5000,
  info: 5000,
  warning: 7000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer) window.clearTimeout(timer);
    timers.current.delete(id);
    setItems((list) => list.filter((item) => item.id !== id));
  }, []);

  const push = useCallback(
    (toast: ToastInput) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      setItems((list) => {
        const next = pushToast(list, toast, id);
        for (const dropped of list) {
          if (!next.some((item) => item.id === dropped.id)) {
            const timer = timers.current.get(dropped.id);
            if (timer) window.clearTimeout(timer);
            timers.current.delete(dropped.id);
          }
        }
        return next;
      });
      const timer = window.setTimeout(() => dismiss(id), DISMISS_MS[toast.kind]);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => () => {
    for (const timer of timers.current.values()) window.clearTimeout(timer);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, description) => push({ kind: "success", title, description }),
      error: (title, description) => push({ kind: "error", title, description }),
      warning: (title, description) => push({ kind: "warning", title, description }),
      info: (title, description) => push({ kind: "info", title, description }),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex flex-col gap-2 md:inset-x-auto md:right-4 md:bottom-4 md:w-96" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-xl border bg-surface px-3 py-3 shadow-card",
              item.kind === "success" && "border-ok/40",
              item.kind === "error" && "border-danger/50",
              item.kind === "warning" && "border-warn/50",
              item.kind === "info" && "border-border",
            )}
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{item.title}</p>
              {item.description ? <p className="mt-0.5 text-sm text-muted">{item.description}</p> : null}
            </div>
            <button type="button" className="grid size-11 shrink-0 place-items-center text-muted hover:text-fg" aria-label="Dismiss notification" onClick={() => dismiss(item.id)}>
              <X className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      push: () => {},
      success: () => {},
      error: () => {},
      warning: () => {},
      info: () => {},
    };
  }
  return ctx;
}

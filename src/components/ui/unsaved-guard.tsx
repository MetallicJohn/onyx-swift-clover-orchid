import { useBlocker } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { askConfirm } from "@/components/ui/confirm-dialog";

/** In-app navigation uses ConfirmDialog. Refresh and tab close use the browser prompt, only while dirty. */
export function useUnsavedGuard(dirty: boolean, description = "You have unsaved changes. Leave without saving?") {
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const asking = useRef(false);
  const blocker = useBlocker({
    shouldBlockFn: () => dirtyRef.current,
    enableBeforeUnload: () => dirtyRef.current,
    withResolver: true,
  });

  useEffect(() => {
    if (blocker.status !== "blocked" || asking.current) return;
    asking.current = true;
    void askConfirm({
      title: "Unsaved changes",
      description,
      confirmLabel: "Leave",
      cancelLabel: "Stay",
      variant: "warning",
    }).then((ok) => {
      asking.current = false;
      if (ok) blocker.proceed?.();
      else blocker.reset?.();
    });
  }, [blocker, description]);
}

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDashboard } from "@/lib/isp/server";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getDashboard()
      .then((d) => {
        if (!cancelled) setWorkspace(d.workspace);
      })
      .catch(() => {
        /* dashboard child will surface errors */
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isPending) {
    return <div className="min-h-dvh bg-bg" />;
  }
  if (!user) return <RedirectToSignIn />;

  return <AppShell tenantName={workspace?.tenantName} role={workspace?.role} />;
}

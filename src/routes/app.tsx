import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { getDashboard, listMyTenants, switchTenant } from "@/lib/isp/server";
import type { Workspace } from "@/lib/isp/types";

export const Route = createFileRoute("/app")({ component: AppLayout });

function AppLayout() {
  const { user, isPending } = useCurrentUserState();
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [activeTenantId, setActiveTenantId] = useState("");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([getDashboard(), listMyTenants()])
      .then(([d, t]) => {
        if (cancelled) return;
        setWorkspace(d.workspace);
        setTenants(t.tenants);
        setActiveTenantId(t.activeId || d.workspace.tenantId);
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

  return (
    <AppShell
      tenantName={workspace?.tenantName}
      role={workspace?.role}
      tenants={tenants}
      activeTenantId={activeTenantId}
      onSwitchTenant={async (id) => {
        const ws = await switchTenant({ data: { tenant_id: id } });
        setWorkspace(ws);
        setActiveTenantId(id);
        window.location.reload();
      }}
    />
  );
}

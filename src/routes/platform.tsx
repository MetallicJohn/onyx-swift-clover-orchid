import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PlatformShell } from "@/components/platform/shell";
import { useTheme } from "@/components/theme-provider";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APP_NAME } from "@/lib/brand";
import { getPlatformGate } from "@/lib/isp/server-platform";
import { clearThemeCache } from "@/lib/theme/resolve";

export const Route = createFileRoute("/platform")({ component: PlatformLayout });

function PlatformLayout() {
  const { user, isPending } = useCurrentUserState();
  const { apply } = useTheme();
  const [gate, setGate] = useState<{ admin: boolean; email: string } | null>(null);

  useEffect(() => {
    clearThemeCache();
    apply(null);
  }, [apply]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    getPlatformGate()
      .then((g) => {
        if (!cancelled) setGate(g);
      })
      .catch(() => {
        if (!cancelled) setGate({ admin: false, email: "" });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isPending) return <div className="min-h-dvh bg-bg" />;
  if (!user) return <RedirectToSignIn />;
  if (gate && !gate.admin) {
    return <Navigate to="/app" />;
  }
  if (!gate) return <div className="min-h-dvh bg-bg" />;

  return <PlatformShell email={gate.email || APP_NAME} />;
}

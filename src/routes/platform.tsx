import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { PlatformShell } from "@/components/platform/shell";
import { useTheme } from "@/components/theme-provider";
import { RedirectToSignIn } from "@/lib/auth/gates";
import { authEnabled } from "@/lib/auth/client";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { APP_NAME } from "@/lib/brand";
import { getPlatformGate } from "@/lib/isp/server-platform";
import { usePlatformIdentity } from "@/lib/isp/use-platform-session";
import { clearThemeCache } from "@/lib/theme/resolve";

export const Route = createFileRoute("/platform")({ component: PlatformLayout });

function PlatformLayout() {
  const { user, isPending } = useCurrentUserState();
  const platformCheck = authEnabled && Boolean(user) && !isPending;
  const platform = usePlatformIdentity(platformCheck);
  const { apply } = useTheme();
  const [gate, setGate] = useState<{ admin: boolean; email: string; defaultPassword?: boolean } | null>(null);

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
        if (!cancelled) setGate({ admin: false, email: "", defaultPassword: false });
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (isPending || (platformCheck && platform.state === "pending")) return <div className="min-h-dvh bg-bg" />;
  if (!user || (authEnabled && platform.state !== "ok")) return <RedirectToSignIn />;
  if (gate && !gate.admin) {
    return <Navigate to="/app" />;
  }
  if (!gate) return <div className="min-h-dvh bg-bg" />;

  return (
    <PlatformShell
      email={platform.identity?.email || gate.email || APP_NAME}
      defaultPassword={Boolean(gate.defaultPassword)}
      accountStatus={platform.identity?.status || "ACTIVE"}
    />
  );
}

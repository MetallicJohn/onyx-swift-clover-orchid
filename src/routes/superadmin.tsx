import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useCurrentUserState } from "@/lib/auth/use-current-user";

export const Route = createFileRoute("/superadmin")({ component: SuperadminDoor });

function SuperadminDoor() {
  const { user, isPending } = useCurrentUserState();
  if (isPending) return <div className="min-h-dvh bg-bg" />;
  if (!user) return <Navigate to="/login" search={{ next: "/superadmin" }} />;
  return <Navigate to="/platform" />;
}

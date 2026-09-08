import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/portal")({ component: PortalLayout });

function PortalLayout() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <Outlet />
    </div>
  );
}

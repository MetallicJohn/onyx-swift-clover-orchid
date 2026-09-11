import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/app/notifications")({
  component: function NotificationsRedirect() {
    return <Navigate to="/app/settings" search={{ tab: "notifications" }} replace />;
  },
});

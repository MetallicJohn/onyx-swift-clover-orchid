import { createFileRoute, Navigate } from "@tanstack/react-router";

export const Route = createFileRoute("/profile")({ component: ProfileRedirect });

function ProfileRedirect() {
  return <Navigate to="/app/profile" />;
}

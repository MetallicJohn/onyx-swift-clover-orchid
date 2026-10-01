import { createFileRoute, redirect } from "@tanstack/react-router";
import { isSettingsPage } from "@/lib/isp/settings-nav";

/** Path form of a settings area. The parent page renders the section. */
export const Route = createFileRoute("/app/settings/$page")({
  validateSearch: (search: Record<string, unknown>): { section?: string } => ({
    section: typeof search.section === "string" && search.section ? search.section : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!isSettingsPage(params.page)) {
      throw redirect({ to: "/app/settings", search: { tab: "general" }, replace: true });
    }
  },
  component: SettingsSectionRoute,
});

function SettingsSectionRoute() {
  return null;
}

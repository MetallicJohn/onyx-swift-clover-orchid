import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { DashboardSkeleton, OpsDashboard } from "@/components/isp/ops-dashboard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { parseDashboardPeriod, type DashboardPeriod } from "@/lib/isp/dashboard-period";
import { getDashboard } from "@/lib/isp/server";
import type { DashboardData } from "@/lib/isp/types";

export const Route = createFileRoute("/app/")({
  validateSearch: (search: Record<string, unknown>): { period?: DashboardPeriod } => {
    const period = parseDashboardPeriod(search.period);
    return { period: search.period === "7d" || search.period === "30d" || search.period === "today" ? period : undefined };
  },
  component: Overview,
});

function Overview() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const period = parseDashboardPeriod(search.period);
  const [data, setData] = useState<DashboardData | null>(null);
  const [failed, setFailed] = useState(false);
  const [refreshError, setRefreshError] = useState(false);
  const [pending, setPending] = useState(false);
  const [reload, setReload] = useState(0);
  const seen = useRef(false);

  useEffect(() => {
    let cancel = false;
    const quiet = seen.current;
    if (!quiet) setFailed(false);
    setPending(true);
    getDashboard({ data: { period, fresh: reload > 0 } })
      .then((next) => {
        if (cancel) return;
        seen.current = true;
        setData(next);
        setFailed(false);
        setRefreshError(false);
      })
      .catch(() => {
        if (cancel) return;
        if (seen.current) setRefreshError(true);
        else setFailed(true);
      })
      .finally(() => {
        if (!cancel) setPending(false);
      });
    return () => {
      cancel = true;
    };
  }, [period, reload]);

  useEffect(() => {
    const id = window.setInterval(() => setReload((n) => n + 1), 60_000);
    return () => window.clearInterval(id);
  }, [period]);

  function onPeriod(next: DashboardPeriod) {
    void navigate({
      to: "/app",
      search: { period: next === "today" ? undefined : next },
      replace: true,
    });
  }

  if (failed && !data) {
    return (
      <EmptyState
        title="Couldn't load the dashboard"
        description="The last attempt failed. Your data is unchanged."
        action={
          <Button type="button" onClick={() => setReload((n) => n + 1)}>
            Try again
          </Button>
        }
      />
    );
  }
  if (!data) return <DashboardSkeleton />;

  return (
    <OpsDashboard
      data={data}
      period={period}
      pending={pending}
      refreshError={refreshError}
      onPeriod={onPeriod}
      onRefresh={() => setReload((n) => n + 1)}
    />
  );
}

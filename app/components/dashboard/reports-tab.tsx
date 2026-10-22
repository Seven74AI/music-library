import { useEffect } from "react";
import { useFetcher } from "react-router";
import { ReportsCharts } from "#app/components/dashboard/reports-charts.tsx";
import { type DashboardCharts } from "#app/features/curator/dashboard.ts";

export function ReportsTab() {
  const fetcher = useFetcher<DashboardCharts>();

  useEffect(() => {
    void fetcher.load("/api/curator/dashboard/charts");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h2 className="mb-2 text-xl font-semibold">Reports</h2>
      <p className="mb-4 text-sm text-muted-foreground">
        Completeness over the last 30 days, daily edits, and open issue types.
      </p>
      {fetcher.data ? (
        <ReportsCharts charts={fetcher.data} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading charts…</p>
      )}
    </section>
  );
}

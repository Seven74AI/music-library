import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router";
import { ActivityTab } from "#app/components/dashboard/activity-tab.tsx";
import { OverviewTab } from "#app/components/dashboard/overview-tab.tsx";
import { QueueTab } from "#app/components/dashboard/queue-tab.tsx";
import { ReportsTab } from "#app/components/dashboard/reports-tab.tsx";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#app/components/ui/tabs.tsx";
import {
  getActivity,
  getDashboardMetrics,
  getLeaderboard,
} from "#app/features/curator/dashboard.server.ts";
import {
  dashboardTabToPersist,
  saveSessionState,
  SESSION_SAVE_DEBOUNCE_MS,
} from "#app/features/curator/session-recovery.client.ts";
import { subscribeRestoredSession } from "#app/features/curator/session-restore.ts";
import { requireCuratorRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/dashboard.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const TABS = ["overview", "queue", "reports", "activity"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  await requireCuratorRole(request);
  const [metrics, leaderboard, activity] = await Promise.all([
    getDashboardMetrics(),
    getLeaderboard({ period: "week", limit: 10 }),
    getActivity({ page: 1 }),
  ]);
  return { metrics, leaderboard, activity };
}

export default function CuratorDashboard({ loaderData }: Route.ComponentProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const tab = TABS.includes(requested as (typeof TABS)[number]) ? requested! : "overview";

  const seenTab = useRef<string | null>(null);
  useEffect(() => {
    const next = dashboardTabToPersist(seenTab.current, tab);
    seenTab.current = tab;
    if (!next || typeof saveSessionState !== "function") return;
    const timer = window.setTimeout(() => {
      saveSessionState({
        type: "activeTab",
        dashboardTab: next,
        timestamp: Date.now(),
      });
    }, SESSION_SAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [tab]);

  useEffect(() => {
    return subscribeRestoredSession((states) => {
      const tabs = states.find((state) => state.type === "activeTab");
      if (!tabs || tabs.type !== "activeTab" || !tabs.dashboardTab) return;
      const next = new URLSearchParams(searchParams);
      if (tabs.dashboardTab === "overview") next.delete("tab");
      else next.set("tab", tabs.dashboardTab);
      setSearchParams(next);
    });
  }, [searchParams, setSearchParams]);

  return (
    <div className="container mx-auto max-w-6xl overflow-x-hidden px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Curator dashboard</h1>
        <p className="text-muted-foreground">
          Metadata health, the review queue, and recent curator work.
        </p>
      </div>
      <Tabs
        value={tab}
        onValueChange={(value) => {
          const next = new URLSearchParams(searchParams);
          if (value === "overview") next.delete("tab");
          else next.set("tab", value);
          setSearchParams(next);
        }}
      >
        <TabsList className="mb-4 h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="overview" className="min-h-11">
            Overview
          </TabsTrigger>
          <TabsTrigger value="queue" className="min-h-11">
            Queue
          </TabsTrigger>
          <TabsTrigger value="reports" className="min-h-11">
            Reports
          </TabsTrigger>
          <TabsTrigger value="activity" className="min-h-11">
            Activity
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab
            metrics={loaderData.metrics}
            leaderboard={loaderData.leaderboard}
            activity={loaderData.activity}
          />
        </TabsContent>
        <TabsContent value="queue">
          <QueueTab />
        </TabsContent>
        <TabsContent value="reports">
          <ReportsTab />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab initial={loaderData.activity} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function CuratorDashboardForbidden() {
  return (
    <div className="container mx-auto max-w-lg px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold">Curators only</h1>
      <p className="mt-2 text-muted-foreground">
        You need the curator or admin role to view the dashboard.
      </p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: CuratorDashboardForbidden }} />;
}

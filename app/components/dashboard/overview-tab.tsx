import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { ActivityFeed, activityUrl } from "#app/components/dashboard/activity-feed.tsx";
import { Leaderboard } from "#app/components/dashboard/leaderboard.tsx";
import { MetricCard } from "#app/components/dashboard/metric-card.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import {
  type ActivityResult,
  type DashboardMetrics,
  type LeaderboardResult,
} from "#app/features/curator/dashboard.ts";

export function OverviewTab({
  metrics,
  leaderboard,
  activity,
}: {
  metrics: DashboardMetrics;
  leaderboard: LeaderboardResult;
  activity: ActivityResult;
}) {
  const metricsFetcher = useFetcher<DashboardMetrics>();
  const liveMetrics = metricsFetcher.data ?? metrics;
  const activityPath = activityUrl({ page: 1 });
  const [feedReload, setFeedReload] = useState(0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          Library health, the busiest problem tracks, and what curators changed this week.
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            void metricsFetcher.load("/api/curator/dashboard/metrics?refresh=1");
            setFeedReload((value) => value + 1);
          }}
          disabled={metricsFetcher.state !== "idle"}
        >
          <Icon
            name="update"
            className={metricsFetcher.state !== "idle" ? "animate-spin" : undefined}
          >
            Refresh
          </Icon>
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Total tracks"
          value={liveMetrics.totalTracks.toLocaleString()}
          detail={`${liveMetrics.tracksMissingMetadata.toLocaleString()} missing album or genre`}
          testId="metric-total-tracks"
          count={liveMetrics.totalTracks}
        />
        <MetricCard
          label="Completeness"
          value={`${liveMetrics.completenessPercent}%`}
          detail="Artist, album, genre, year, and BPM"
          testId="metric-completeness"
          count={liveMetrics.completenessPercent}
        />
        <MetricCard
          label="Queue items"
          value={liveMetrics.pendingQueueItems.toLocaleString()}
          detail="Open and claimed"
          testId="metric-queue"
          count={liveMetrics.pendingQueueItems}
        />
        <MetricCard
          label="Duplicates"
          value={liveMetrics.openDuplicates.toLocaleString()}
          detail={`${liveMetrics.openDuplicatesExact} exact · ${liveMetrics.openDuplicatesFuzzy} fuzzy`}
          testId="metric-duplicates"
          count={liveMetrics.openDuplicates}
        />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Field completeness</CardTitle>
          <CardDescription>Share of tracks with each field filled in.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {liveMetrics.fieldBreakdown.map((field) => (
            <div key={field.field}>
              <div className="mb-1 flex justify-between text-sm">
                <span>{field.field}</span>
                <span>{field.percent}%</span>
              </div>
              <div className="h-2 rounded bg-muted">
                <div className="h-2 rounded bg-primary" style={{ width: `${field.percent}%` }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card data-testid="problem-tracks">
          <CardHeader>
            <CardTitle className="text-lg">Problem tracks</CardTitle>
            <CardDescription>
              Ten tracks with the most missing fields and open queue items.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {liveMetrics.problemTracks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No problem tracks right now.</p>
            ) : (
              <ul className="space-y-3">
                {liveMetrics.problemTracks.map((track) => (
                  <li key={track.id} className="text-sm">
                    <Link to={`/library/${track.id}`} className="font-medium hover:underline">
                      {track.title}
                    </Link>
                    <span className="text-muted-foreground"> — {track.artistName}</span>
                    <p className="text-xs text-muted-foreground">{track.issues.join(" · ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Leaderboard initial={leaderboard} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Live feed</CardTitle>
          <CardDescription>The latest curator actions. Refreshes every 30 seconds.</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityFeed url={activityPath} initial={activity} compact reloadToken={feedReload} />
        </CardContent>
      </Card>
    </div>
  );
}

import { useState } from "react";
import { useFetcher } from "react-router";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Label } from "#app/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#app/components/ui/select.tsx";
import { CuratorBadges } from "#app/components/curator-badge.tsx";
import {
  curatorLabel,
  LEADERBOARD_PERIODS,
  type LeaderboardPeriod,
  type LeaderboardResult,
} from "#app/features/curator/dashboard.ts";

const PERIOD_LABELS: Record<LeaderboardPeriod, string> = {
  today: "Today",
  week: "This week",
  month: "This month",
  all: "All time",
};

export function Leaderboard({ initial }: { initial: LeaderboardResult }) {
  const fetcher = useFetcher<LeaderboardResult>();
  const [period, setPeriod] = useState<LeaderboardPeriod>(initial.period);
  const data =
    fetcher.data?.period === period ? fetcher.data : period === initial.period ? initial : null;

  return (
    <Card data-testid="leaderboard">
      <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-lg">Leaderboard</CardTitle>
          <CardDescription>Top curators by edit count</CardDescription>
        </div>
        <div className="w-full sm:w-40">
          <Label htmlFor="leaderboard-period" className="sr-only">
            Time period
          </Label>
          <Select
            value={period}
            onValueChange={(value) => {
              const next = value as LeaderboardPeriod;
              setPeriod(next);
              void fetcher.load(`/api/curator/leaderboard?period=${next}&limit=10`);
            }}
          >
            <SelectTrigger id="leaderboard-period">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEADERBOARD_PERIODS.map((option) => (
                <SelectItem key={option} value={option}>
                  {PERIOD_LABELS[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {!data || data.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">No edits in this period yet.</p>
        ) : (
          <ol className="space-y-2">
            {data.entries.map((entry) => (
              <li
                key={entry.curator.id}
                className="flex items-center justify-between gap-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">
                    <span className="mr-2 text-muted-foreground">{entry.rank}.</span>
                    {curatorLabel(entry.curator)}
                  </div>
                  <CuratorBadges badges={entry.badges} />
                </div>
                <span className="shrink-0 font-medium">{entry.editCount}</span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

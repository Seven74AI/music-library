import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Link } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { buildDayRange, getUtcDayStart } from "#app/features/usage-analytics/admin-users.server.ts";
import { USAGE_METRICS } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/index.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const DAYS = 30;

type SeriesPoint = { day: string; value: number };

function toDayKey(day: Date): string {
  return day.toISOString().slice(0, 10);
}

function buildSeries(days: Date[], rows: Array<{ day: Date; value: number }>): SeriesPoint[] {
  const byDay = new Map(rows.map((row) => [toDayKey(row.day), row.value]));
  return days.map((day) => ({
    day: toDayKey(day),
    value: byDay.get(toDayKey(day)) ?? 0,
  }));
}

export async function loader({ request }: Route.LoaderArgs) {
  await requireUserWithRole(request, "admin");

  const days = buildDayRange(DAYS);
  const rangeStart = days[0]!;
  const metrics = [
    USAGE_METRICS.signups,
    USAGE_METRICS.plays_started,
    USAGE_METRICS.plays_completed,
    USAGE_METRICS.dau,
    USAGE_METRICS.library_adds,
    USAGE_METRICS.logins,
  ] as const;

  const [totalUsers, activeUsers, disabledUsers, stats] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { disabledAt: null } }),
    prisma.user.count({ where: { disabledAt: { not: null } } }),
    prisma.dailyUsageStat.findMany({
      where: {
        metric: { in: [...metrics] },
        day: { gte: rangeStart },
      },
      select: { day: true, metric: true, value: true },
      orderBy: { day: "asc" },
    }),
  ]);

  const byMetric = (metric: string) =>
    buildSeries(
      days,
      stats
        .filter((row) => row.metric === metric)
        .map((row) => ({ day: row.day, value: row.value })),
    );

  const sum = (series: SeriesPoint[]) => series.reduce((acc, point) => acc + point.value, 0);

  const signups = byMetric(USAGE_METRICS.signups);
  const playsStarted = byMetric(USAGE_METRICS.plays_started);
  const playsCompleted = byMetric(USAGE_METRICS.plays_completed);
  const dau = byMetric(USAGE_METRICS.dau);
  const libraryAdds = byMetric(USAGE_METRICS.library_adds);
  const logins = byMetric(USAGE_METRICS.logins);

  return {
    totals: {
      users: totalUsers,
      activeUsers,
      disabledUsers,
      signups30d: sum(signups),
      playsStarted30d: sum(playsStarted),
      playsCompleted30d: sum(playsCompleted),
      libraryAdds30d: sum(libraryAdds),
      logins30d: sum(logins),
      dauToday: dau[dau.length - 1]?.value ?? 0,
      asOf: getUtcDayStart().toISOString(),
    },
    series: {
      signups,
      playsStarted,
      playsCompleted,
      dau,
      libraryAdds,
      logins,
    },
  };
}

function MiniBarChart({
  title,
  description,
  series,
}: {
  title: string;
  description: string;
  series: SeriesPoint[];
}) {
  const max = Math.max(1, ...series.map((point) => point.value));
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div
          className="flex h-32 items-end gap-px"
          role="img"
          aria-label={`${title} over the last ${series.length} days`}
        >
          {series.map((point) => (
            <div
              key={point.day}
              className="bg-foreground/80 min-w-0 flex-1 rounded-t-sm"
              style={{
                height: `${(point.value / max) * 100}%`,
                minHeight: point.value > 0 ? 2 : 0,
              }}
              title={`${point.day}: ${point.value}`}
            />
          ))}
        </div>
        <div className="text-muted-foreground mt-2 flex justify-between text-xs">
          <span>{series[0]?.day}</span>
          <span>{series[series.length - 1]?.day}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminOverviewRoute({ loaderData }: Route.ComponentProps) {
  const { totals, series } = loaderData;

  return (
    <div className="container py-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-h1">Admin overview</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Usage for the last 30 days (UTC).{" "}
            <Link to="/admin/users" className="underline">
              Manage users
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/admin/audio-queue"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            Audio queue
          </Link>
          <Link
            to="/admin/youtube-cookies"
            className="text-muted-foreground hover:text-foreground text-sm underline"
          >
            YouTube cookies
          </Link>
        </div>
      </div>

      <Spacer size="sm" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Users</CardDescription>
            <CardTitle className="text-3xl">{totals.users}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {totals.activeUsers} active · {totals.disabledUsers} disabled
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>DAU today</CardDescription>
            <CardTitle className="text-3xl">{totals.dauToday}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Unique active users (UTC day)
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Plays (30d)</CardDescription>
            <CardTitle className="text-3xl">{totals.playsStarted30d}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {totals.playsCompleted30d} completed (≥50%)
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Signups (30d)</CardDescription>
            <CardTitle className="text-3xl">{totals.signups30d}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {totals.libraryAdds30d} library adds · {totals.logins30d} logins
          </CardContent>
        </Card>
      </div>

      <Spacer size="sm" />

      <div className="grid gap-4 lg:grid-cols-2">
        <MiniBarChart title="Signups" description="New accounts per day" series={series.signups} />
        <MiniBarChart title="DAU" description="Daily active users" series={series.dau} />
        <MiniBarChart
          title="Plays started"
          description="Playback starts per day"
          series={series.playsStarted}
        />
        <MiniBarChart
          title="Library adds"
          description="Tracks added to personal libraries"
          series={series.libraryAdds}
        />
      </div>
    </div>
  );
}

export function ErrorBoundary() {
  return (
    <GeneralErrorBoundary
      statusHandlers={{
        403: () => (
          <div className="flex flex-col items-center gap-2 py-12">
            <Icon name="avatar" className="text-body-2xl" />
            <h1 className="text-h1">403</h1>
            <p>You must be an admin to view this page.</p>
          </div>
        ),
      }}
    />
  );
}

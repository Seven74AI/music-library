import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Link } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { Spacer } from "#app/components/spacer.tsx";
import { Badge } from "#app/components/ui/badge.tsx";
import { Button } from "#app/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#app/components/ui/card.tsx";
import { Icon } from "#app/components/ui/icon.tsx";
import { adminNavSections } from "#app/features/admin/admin-nav.ts";
import { formatBytes } from "#app/features/admin/database-quality.ts";
import { getAdminOverviewHealth } from "#app/features/admin/overview-health.server.ts";
import { buildDayRange, getUtcDayStart } from "#app/features/usage-analytics/admin-users.server.ts";
import { USAGE_METRICS } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/index.ts";

export { adminNavSections };

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const DAYS = 30;

const HEALTH_TEXT = {
  green: "text-green-600",
  yellow: "text-yellow-600",
  red: "text-red-600",
} as const;

const quickActions = [
  { label: "Trigger FTS Reindex", to: "/admin/fts-index" },
  { label: "View Failed Logins", to: "/admin/security-events?tab=failed" },
  { label: "Clean Up Orphaned Files", to: "/admin/orphaned-tracks" },
] as const;

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

  const [totalUsers, activeUsers, disabledUsers, stats, health] = await Promise.all([
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
    getAdminOverviewHealth(),
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
    health,
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
                // A zero day is still a day in the 30-day range. Keep a sliver
                // so the chart shows one bar per UTC day, including zeros.
                minHeight: 2,
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
  const { totals, series, health } = loaderData;

  return (
    <div className="container py-8">
      <div>
        <h1 className="text-h1">Admin overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Usage for the last 30 days (UTC).{" "}
          <Link to="/admin/users" className="underline">
            Manage users
          </Link>
        </p>
      </div>

      <Spacer size="sm" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Database quality</CardDescription>
            <CardTitle
              className={`text-3xl ${HEALTH_TEXT[health.color]}`}
              data-testid="health-score"
            >
              <Link to="/admin/database-quality">{health.score}%</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {health.color === "green"
              ? "Healthy"
              : health.color === "yellow"
                ? "Needs work"
                : "Poor"}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Storage</CardDescription>
            <CardTitle className="text-3xl">{formatBytes(health.storageBytes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            <Link to="/admin/orphaned-tracks" className="underline">
              {health.orphanedWasteMb} MB orphaned waste
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Security</CardDescription>
            <CardTitle
              className={`text-3xl ${health.securityAlert ? "text-red-600" : ""}`}
              data-testid="failed-logins-24h"
            >
              {health.failedLogins24h}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            <Link to="/admin/security-events?tab=failed" className="underline">
              Failed logins in 24h
              {health.securityAlert ? " · threshold exceeded" : ""}
            </Link>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Missing content</CardDescription>
            <CardTitle className="text-3xl">{health.missingAudio + health.missingCovers}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            <Link to="/admin/orphaned-tracks" className="underline">
              {health.missingAudio} without audio
            </Link>
            {" · "}
            <Link to="/admin/missing-covers" className="underline">
              {health.missingCovers} without covers
            </Link>
          </CardContent>
        </Card>
      </div>

      <Spacer size="sm" />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {adminNavSections.map((section) => (
          <Card key={section.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{section.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-1">
              {section.links.map((link) => (
                <div key={link.to} className="flex items-center gap-2">
                  <Link to={link.to} className="text-foreground hover:underline text-sm">
                    {link.label}
                  </Link>
                  {link.to === "/admin/security-events" && health.securityAlert ? (
                    <Badge variant="destructive">{health.failedLogins24h} failed</Badge>
                  ) : null}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {quickActions.map((action) => (
              <Button key={action.label} variant="outline" size="sm" asChild>
                <Link to={action.to}>{action.label}</Link>
              </Button>
            ))}
          </CardContent>
        </Card>
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

function Admin403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: Admin403 }} />;
}

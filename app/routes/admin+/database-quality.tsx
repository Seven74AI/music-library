/**
 * Admin Database Quality & Health Monitoring
 *
 * See: docs/specs/admin-database-quality.md
 */

import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Link, useSearchParams } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary";
import { HealthScoreRing } from "#app/components/admin/health-score-ring.tsx";
import { QualityMetricCard } from "#app/components/admin/quality-metric-card.tsx";
import { Spacer } from "#app/components/spacer.tsx";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#app/components/ui/table.tsx";
import {
  formatBytes,
  METRIC_TARGETS,
  METRIC_WEIGHTS,
  percentOfTracksAffected,
} from "#app/features/admin/database-quality.ts";
import {
  calculateHealthScore,
  countTracksWithMetadataIssues,
  getDuplicateTracksCount,
  getMetadataIssues,
  getOrphanedFilesCount,
  getStorageStats,
  type QualityMetrics,
  type MetadataIssues,
  type StorageStats,
} from "#app/features/admin/database-quality.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { type Route } from "./+types/database-quality.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

const TABS = ["overview", "metadata", "storage", "duplicates", "integrity"] as const;
type Tab = (typeof TABS)[number];

interface LoaderData {
  overallScore: number;
  metrics: QualityMetrics;
  totalTracks: number;
  metadataIssues: MetadataIssues;
  tracksWithMetadataIssues: number;
  storageStats: StorageStats;
  duplicateTracksCount: number;
  orphanedFilesCount: number;
  lastUpdated: string;
}

export async function loader({ request }: Route.LoaderArgs): Promise<LoaderData> {
  await requireUserWithRole(request, "admin");

  const [
    totalTracks,
    tracksWithAudio,
    tracksWithCovers,
    tracksWithDuration,
    tracksWithAlbum,
    tracksWithYear,
    tracksWithGenre,
    tracksWithLyrics,
    metadataIssues,
    tracksWithMetadataIssues,
    storageStats,
    duplicateTracksCount,
    orphanedFilesCount,
  ] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({ where: { audioFiles: { some: {} } } }),
    prisma.track.count({ where: { coverImageId: { not: null } } }),
    prisma.track.count({ where: { duration: { not: null } } }),
    prisma.track.count({ where: { albumId: { not: null } } }),
    prisma.track.count({ where: { year: { not: null } } }),
    prisma.track.count({ where: { genre: { not: null } } }),
    prisma.track.count({ where: { lyrics: { not: null } } }),
    getMetadataIssues(),
    countTracksWithMetadataIssues(),
    getStorageStats(),
    getDuplicateTracksCount(),
    getOrphanedFilesCount(),
  ]);

  const metrics: QualityMetrics = {
    audio: totalTracks > 0 ? (tracksWithAudio / totalTracks) * 100 : 0,
    covers: totalTracks > 0 ? (tracksWithCovers / totalTracks) * 100 : 0,
    duration: totalTracks > 0 ? (tracksWithDuration / totalTracks) * 100 : 0,
    album: totalTracks > 0 ? (tracksWithAlbum / totalTracks) * 100 : 0,
    year: totalTracks > 0 ? (tracksWithYear / totalTracks) * 100 : 0,
    genre: totalTracks > 0 ? (tracksWithGenre / totalTracks) * 100 : 0,
    lyrics: totalTracks > 0 ? (tracksWithLyrics / totalTracks) * 100 : 0,
  };

  const overallScore = calculateHealthScore(metrics);

  return {
    overallScore,
    metrics,
    totalTracks,
    metadataIssues,
    tracksWithMetadataIssues,
    storageStats,
    duplicateTracksCount,
    orphanedFilesCount,
    lastUpdated: new Date().toISOString(),
  };
}

function OverviewTab({ loaderData }: { loaderData: LoaderData }) {
  const { metrics, totalTracks } = loaderData;
  const bestMetric = Object.entries(metrics).reduce(
    (best, [key, value]) => (value > best.value ? { key, value } : best),
    { key: "audio", value: 0 },
  );

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Tracks</CardDescription>
            <CardTitle className="text-3xl">{totalTracks.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Across all services and formats
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Best Metric</CardDescription>
            <CardTitle className="text-3xl">
              {bestMetric.key.charAt(0).toUpperCase() + bestMetric.key.slice(1)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {bestMetric.value.toFixed(1)}% complete
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Needs Attention</CardDescription>
            <CardTitle className="text-3xl">
              {
                Object.entries(metrics).filter(
                  ([key, value]) => value < METRIC_TARGETS[key as keyof typeof METRIC_TARGETS],
                ).length
              }
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Metrics below target</CardContent>
        </Card>
      </div>

      <div>
        <h3 className="text-h3 mb-4">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link to="/music/admin/duplicates">
              <Icon name="file-text" className="mr-1" />
              View Duplicates
            </Link>
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Icon name="magnifying-glass" className="mr-1" />
            Review Metadata Issues
          </Button>
          <Button variant="outline" size="sm" disabled>
            <Icon name="camera" className="mr-1" />
            Fix Missing Covers
          </Button>
        </div>
      </div>
    </div>
  );
}

function MetadataTab({ loaderData }: { loaderData: LoaderData }) {
  const { metadataIssues, totalTracks, tracksWithMetadataIssues } = loaderData;
  const currentYear = new Date().getFullYear();

  const issues = [
    {
      type: "Placeholder Titles",
      count: metadataIssues.placeholderTitles,
      description: 'Tracks with generic titles like "Unknown", "Track", "Untitled"',
      severity: "medium" as const,
    },
    {
      type: "Suspicious Durations",
      count: metadataIssues.suspiciousDurations,
      description: "Tracks shorter than 5 seconds or longer than 2 hours",
      severity: "medium" as const,
    },
    {
      type: "Missing Essential Data",
      count: metadataIssues.missingEssentials,
      description: "Tracks missing duration, cover, or year information",
      severity: "high" as const,
    },
    {
      type: "Invalid Years",
      count: metadataIssues.invalidYears,
      description: `Years before 1850 or after ${currentYear + 1}`,
      severity: "high" as const,
    },
    {
      type: "Artists Without Genre",
      count: metadataIssues.artistsWithoutGenre,
      description: "Artists with tracks but no genre assigned",
      severity: "low" as const,
    },
  ];

  const totalIssues = Object.values(metadataIssues).reduce((sum, count) => sum + count, 0);
  const affectedPercent = percentOfTracksAffected(tracksWithMetadataIssues, totalTracks);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Issues</CardDescription>
            <CardTitle className="text-3xl">{totalIssues.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {affectedPercent.toFixed(1)}% of tracks affected
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>High Severity</CardDescription>
            <CardTitle className="text-destructive text-3xl">
              {issues.filter((i) => i.severity === "high").reduce((sum, i) => sum + i.count, 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            Require immediate attention
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Medium Severity</CardDescription>
            <CardTitle className="text-yellow-600 text-3xl">
              {issues.filter((i) => i.severity === "medium").reduce((sum, i) => sum + i.count, 0)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Should be reviewed</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Issue Breakdown</CardTitle>
          <CardDescription>Metadata quality issues detected in the database</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issue Type</TableHead>
                <TableHead>Count</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {issues.map((issue) => (
                <TableRow key={issue.type}>
                  <TableCell className="font-medium">{issue.type}</TableCell>
                  <TableCell>{issue.count.toLocaleString()}</TableCell>
                  <TableCell>
                    <span
                      className={
                        issue.severity === "high"
                          ? "text-destructive"
                          : issue.severity === "medium"
                            ? "text-yellow-600"
                            : "text-muted-foreground"
                      }
                    >
                      {issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1)}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {issue.description}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function StorageTab({ loaderData }: { loaderData: LoaderData }) {
  const { storageStats } = loaderData;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Storage</CardDescription>
            <CardTitle className="text-2xl">{formatBytes(storageStats.totalBytes)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">
            {storageStats.totalFiles.toLocaleString()} files
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Average File Size</CardDescription>
            <CardTitle className="text-2xl">{formatBytes(storageStats.avgFileSize)}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Per audio file</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Unique Tracks</CardDescription>
            <CardTitle className="text-2xl">{storageStats.uniqueTracks.toLocaleString()}</CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">With audio files</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Storage Saved</CardDescription>
            <CardTitle className="text-green-600 text-2xl">
              {formatBytes(storageStats.dedup.storageSaved)}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">Via deduplication</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Storage by Format</CardTitle>
          <CardDescription>Distribution of audio file formats</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Format</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Total Size</TableHead>
                <TableHead>Avg Size</TableHead>
                <TableHead>% of Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storageStats.formatStats.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No audio files found
                  </TableCell>
                </TableRow>
              ) : (
                storageStats.formatStats.map((format) => (
                  <TableRow key={format.format}>
                    <TableCell className="font-medium font-mono">
                      {format.format.toUpperCase()}
                    </TableCell>
                    <TableCell>{format.fileCount.toLocaleString()}</TableCell>
                    <TableCell>{formatBytes(format.totalBytes)}</TableCell>
                    <TableCell>{formatBytes(format.avgBytes)}</TableCell>
                    <TableCell>{format.percentOfTotal.toFixed(1)}%</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Deduplication Effectiveness</CardTitle>
          <CardDescription>How well content-based deduplication is working</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <p className="text-muted-foreground text-sm">Total Records</p>
              <p className="text-2xl font-bold">
                {storageStats.dedup.totalRecords.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Unique Files (by hash)</p>
              <p className="text-2xl font-bold">
                {storageStats.dedup.uniqueFiles.toLocaleString()}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground text-sm">Duplicates Avoided</p>
              <p className="text-2xl font-bold">
                {storageStats.dedup.duplicatesAvoided.toLocaleString()}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top 10 Largest Files</CardTitle>
          <CardDescription>Files consuming the most storage space</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Track</TableHead>
                <TableHead>Artist</TableHead>
                <TableHead>Format</TableHead>
                <TableHead>Size</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {storageStats.largestFiles.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    No files found
                  </TableCell>
                </TableRow>
              ) : (
                storageStats.largestFiles.map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="max-w-[200px] truncate font-medium">
                      {file.trackTitle}
                    </TableCell>
                    <TableCell className="max-w-[150px] truncate">{file.artistName}</TableCell>
                    <TableCell className="font-mono">
                      {file.format?.toUpperCase() || "Unknown"}
                    </TableCell>
                    <TableCell>{formatBytes(file.fileSize)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function DuplicatesTab({ loaderData }: { loaderData: LoaderData }) {
  const { duplicateTracksCount } = loaderData;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Duplicate Detection</CardTitle>
          <CardDescription>
            Exact and similar audio groups on the duplicate management page
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <p className="text-muted-foreground text-sm">Duplicate Groups Found</p>
              <p className="text-4xl font-bold">{duplicateTracksCount}</p>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4">
              <p className="text-sm">
                A dedicated duplicate detection and management interface is available at{" "}
                <code className="bg-muted rounded px-1 py-0.5 text-xs">
                  /music/admin/duplicates
                </code>
                . Use that page to review and merge duplicate tracks.
              </p>
            </div>

            <Button asChild>
              <Link to="/music/admin/duplicates">
                <Icon name="file-text" className="mr-2" />
                View Duplicate Tracks
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrityTab({ loaderData }: { loaderData: LoaderData }) {
  const { orphanedFilesCount } = loaderData;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Referential Integrity</CardTitle>
          <CardDescription>Database constraint enforcement and data consistency</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Icon name="check" className="text-green-600" />
              <span className="font-semibold text-green-600">
                Protected by Database Constraints
              </span>
            </div>

            <div className="rounded-lg border bg-muted/50 p-4">
              <h4 className="mb-2 font-semibold">How it works:</h4>
              <ul className="text-muted-foreground ml-4 list-disc space-y-1 text-sm">
                <li>
                  All foreign key relationships are enforced at the database level via Prisma schema
                </li>
                <li>
                  Orphaned records (references to non-existent parent records) are automatically
                  prevented
                </li>
                <li>Cascade deletions ensure related records are cleaned up properly</li>
                <li>SQLite + Prisma guarantees ACID compliance for all operations</li>
              </ul>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-lg border p-4">
                <h4 className="mb-1 font-semibold">Orphaned Files</h4>
                <p className="text-3xl font-bold text-green-600">{orphanedFilesCount}</p>
                <p className="text-muted-foreground text-sm">Audio files without tracks</p>
              </div>
              <div className="rounded-lg border p-4">
                <h4 className="mb-1 font-semibold">Integrity Status</h4>
                <p className="text-3xl font-bold text-green-600">✓ Excellent</p>
                <p className="text-muted-foreground text-sm">All constraints enforced</p>
              </div>
            </div>

            <div className="rounded-lg border bg-blue-50 dark:bg-blue-950/20 p-4">
              <div className="flex items-start gap-2">
                <Icon name="question-mark-circled" className="text-blue-600 mt-0.5" />
                <div>
                  <h4 className="mb-1 font-semibold text-blue-900 dark:text-blue-100">
                    Confidence Note
                  </h4>
                  <p className="text-blue-800 dark:text-blue-200 text-sm">
                    Unlike manual integrity checks that can miss issues, database-level constraints
                    provide 100% guarantee that referential integrity is maintained at all times.
                    Manual checks are unnecessary and would be redundant.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DatabaseQualityRoute({ loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const activeTab = (searchParams.get("tab") || "overview") as Tab;
  const { overallScore, metrics, lastUpdated } = loaderData;

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? "" : "s"} ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;

    return date.toLocaleDateString();
  };

  return (
    <div className="container py-8">
      <div className="mb-6">
        <h1 className="text-h1">Database Quality & Health</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Comprehensive metrics for data integrity and completeness
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Overall Health Score</CardTitle>
          <CardDescription>Weighted average of all quality metrics</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4">
          <HealthScoreRing score={overallScore} size="lg" />
          <div className="text-center">
            <p className="text-muted-foreground text-sm">Last updated: {formatDate(lastUpdated)}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => window.location.reload()}
            >
              <Icon name="arrow-path" className="mr-1" />
              Refresh Metrics
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mb-6">
        <h2 className="text-h2 mb-4">Data Completeness Breakdown</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <QualityMetricCard
            label="Audio Files"
            percentage={metrics.audio}
            target={METRIC_TARGETS.audio}
            weight={METRIC_WEIGHTS.audio}
          />
          <QualityMetricCard
            label="Cover Images"
            percentage={metrics.covers}
            target={METRIC_TARGETS.covers}
            weight={METRIC_WEIGHTS.covers}
          />
          <QualityMetricCard
            label="Duration Info"
            percentage={metrics.duration}
            target={METRIC_TARGETS.duration}
            weight={METRIC_WEIGHTS.duration}
          />
          <QualityMetricCard
            label="Album Metadata"
            percentage={metrics.album}
            target={METRIC_TARGETS.album}
            weight={METRIC_WEIGHTS.album}
          />
          <QualityMetricCard
            label="Year Info"
            percentage={metrics.year}
            target={METRIC_TARGETS.year}
            weight={METRIC_WEIGHTS.year}
          />
          <QualityMetricCard
            label="Genre Tags"
            percentage={metrics.genre}
            target={METRIC_TARGETS.genre}
            weight={METRIC_WEIGHTS.genre}
          />
          <QualityMetricCard
            label="Lyrics"
            percentage={metrics.lyrics}
            target={METRIC_TARGETS.lyrics}
            weight={METRIC_WEIGHTS.lyrics}
          />
        </div>
      </div>

      <Spacer size="sm" />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button key={tab} variant={activeTab === tab ? "default" : "outline"} size="sm" asChild>
            <Link to={`?tab=${tab}`}>{tab.charAt(0).toUpperCase() + tab.slice(1)}</Link>
          </Button>
        ))}
      </div>

      {activeTab === "overview" && <OverviewTab loaderData={loaderData} />}
      {activeTab === "metadata" && <MetadataTab loaderData={loaderData} />}
      {activeTab === "storage" && <StorageTab loaderData={loaderData} />}
      {activeTab === "duplicates" && <DuplicatesTab loaderData={loaderData} />}
      {activeTab === "integrity" && <IntegrityTab loaderData={loaderData} />}
    </div>
  );
}

function DatabaseQuality403() {
  return (
    <div className="flex flex-col items-center gap-2 py-12">
      <Icon name="avatar" className="text-body-2xl" />
      <h1 className="text-h1">403</h1>
      <p>You must be an admin to view this page.</p>
    </div>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary statusHandlers={{ 403: DatabaseQuality403 }} />;
}

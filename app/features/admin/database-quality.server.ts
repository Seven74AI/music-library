/**
 * Server-side functions for Admin Database Quality & Health Monitoring
 */

import { loadDuplicateDashboard } from "#app/features/admin/duplicate-dashboard.server.ts";
import { cache, cachified } from "#app/utils/cache.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { METRIC_WEIGHTS } from "./database-quality.ts";

export const DATABASE_QUALITY_CACHE_KEY = "admin:database-quality:v1";
const DATABASE_QUALITY_CACHE_TTL_MS = 5 * 60 * 1000;

export function getHealthColor(percentage: number): "green" | "yellow" | "red" {
  if (percentage >= 90) return "green";
  if (percentage >= 70) return "yellow";
  return "red";
}

export function getHealthLabel(percentage: number): string {
  if (percentage >= 90) return "Excellent";
  if (percentage >= 70) return "Needs Work";
  return "Poor";
}

export interface QualityMetrics {
  audio: number;
  covers: number;
  duration: number;
  album: number;
  year: number;
  genre: number;
  lyrics: number;
}

export function calculateHealthScore(metrics: QualityMetrics): number {
  return (
    metrics.audio * METRIC_WEIGHTS.audio +
    metrics.covers * METRIC_WEIGHTS.covers +
    metrics.duration * METRIC_WEIGHTS.duration +
    metrics.album * METRIC_WEIGHTS.album +
    metrics.year * METRIC_WEIGHTS.year +
    metrics.genre * METRIC_WEIGHTS.genre +
    metrics.lyrics * METRIC_WEIGHTS.lyrics
  );
}

export interface MetadataIssues {
  placeholderTitles: number;
  suspiciousDurations: number;
  missingEssentials: number;
  invalidYears: number;
  artistsWithoutGenre: number;
}

const placeholderTitleWhere = {
  OR: [
    { title: { in: ["Unknown", "Track", "Untitled", "N/A", "", "Audio"] } },
    { title: { startsWith: "Track " } },
    { title: { startsWith: "Untitled" } },
  ],
};

const suspiciousDurationWhere = {
  // Track.duration is stored in seconds, not milliseconds.
  OR: [{ duration: { lt: 5 } }, { duration: { gt: 2 * 60 * 60 } }],
};

const missingEssentialsWhere = {
  OR: [{ duration: null }, { coverImageId: null }, { year: null }],
};

function invalidYearWhere(currentYear: number) {
  return {
    AND: [
      { year: { not: null } },
      {
        OR: [{ year: { lt: 1850 } }, { year: { gt: currentYear + 1 } }],
      },
    ],
  };
}

/** Tracks matching any track-level metadata issue. Excludes artist-only rows. */
function trackLevelMetadataIssueWhere(currentYear: number) {
  return {
    OR: [
      placeholderTitleWhere,
      suspiciousDurationWhere,
      missingEssentialsWhere,
      invalidYearWhere(currentYear),
    ],
  };
}

export async function getMetadataIssues(): Promise<MetadataIssues> {
  const currentYear = new Date().getFullYear();

  const [
    placeholderTitles,
    suspiciousDurations,
    missingEssentials,
    invalidYears,
    artistsWithoutGenre,
  ] = await Promise.all([
    prisma.track.count({ where: placeholderTitleWhere }),
    prisma.track.count({ where: suspiciousDurationWhere }),
    prisma.track.count({ where: missingEssentialsWhere }),
    prisma.track.count({ where: invalidYearWhere(currentYear) }),
    prisma.artist.count({
      where: {
        OR: [{ genre: null }, { genre: "" }],
        tracks: {
          some: {},
        },
      },
    }),
  ]);

  return {
    placeholderTitles,
    suspiciousDurations,
    missingEssentials,
    invalidYears,
    artistsWithoutGenre,
  };
}

/** Distinct tracks with at least one track-level metadata issue. */
export async function countTracksWithMetadataIssues(): Promise<number> {
  const currentYear = new Date().getFullYear();
  return prisma.track.count({ where: trackLevelMetadataIssueWhere(currentYear) });
}

export interface StorageStats {
  totalBytes: number;
  totalFiles: number;
  avgFileSize: number;
  uniqueTracks: number;
  formatStats: Array<{
    format: string;
    fileCount: number;
    totalBytes: number;
    avgBytes: number;
    percentOfTotal: number;
  }>;
  dedup: {
    totalRecords: number;
    uniqueFiles: number;
    duplicatesAvoided: number;
    storageSaved: number;
  };
  largestFiles: Array<{
    id: string;
    objectKey: string;
    format: string | null;
    fileSize: number;
    trackId: string;
    trackTitle: string;
    artistName: string;
  }>;
}

export async function getStorageStats(): Promise<StorageStats> {
  // Aggregate totals and format/dedup stats in the database instead of loading
  // every TrackAudioFile row into memory (the table grows unbounded with the
  // library).
  const [agg, distinctTracks, hashAgg, hashGroups, formatGroups] = await Promise.all([
    prisma.trackAudioFile.aggregate({
      _sum: { fileSize: true },
      _count: true,
    }),
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(DISTINCT trackId) AS count FROM TrackAudioFile
    `,
    prisma.$queryRaw<Array<{ uniqueHashes: number; filesWithHash: number }>>`
      SELECT
        COUNT(DISTINCT contentHash) AS uniqueHashes,
        COUNT(*) AS filesWithHash
      FROM TrackAudioFile
      WHERE contentHash IS NOT NULL
    `,
    prisma.$queryRaw<Array<{ cnt: number; size: number }>>`
      SELECT COUNT(*) AS cnt, MIN(fileSize) AS size
      FROM TrackAudioFile
      WHERE contentHash IS NOT NULL
      GROUP BY contentHash
      HAVING COUNT(*) > 1
    `,
    prisma.trackAudioFile.groupBy({
      by: ["format"],
      // eslint-disable-next-line no-underscore-dangle
      _sum: { fileSize: true },
      _count: true,
      // eslint-disable-next-line no-underscore-dangle
      _avg: { fileSize: true },
    }),
  ]);

  const totalBytes = agg._sum.fileSize ?? 0;
  const totalFiles = agg._count;
  const avgFileSize = totalFiles > 0 ? totalBytes / totalFiles : 0;
  const uniqueTracks = Number(distinctTracks[0]?.count ?? 0);

  const formatStats = formatGroups
    .filter((g) => g.format !== null)
    .map((g) => ({
      format: g.format!,
      fileCount: g._count,
      // eslint-disable-next-line no-underscore-dangle
      totalBytes: g._sum.fileSize || 0,
      // eslint-disable-next-line no-underscore-dangle
      avgBytes: g._avg.fileSize || 0,
      // eslint-disable-next-line no-underscore-dangle
      percentOfTotal: totalBytes > 0 ? ((g._sum.fileSize || 0) / totalBytes) * 100 : 0,
    }))
    .sort((a, b) => b.totalBytes - a.totalBytes);

  const uniqueHashes = Number(hashAgg[0]?.uniqueHashes ?? 0);
  const filesWithHash = Number(hashAgg[0]?.filesWithHash ?? 0);
  const duplicatesAvoided = filesWithHash - uniqueHashes;

  let storageSaved = 0;
  for (const group of hashGroups) {
    const count = Number(group.cnt ?? 0);
    const size = Number(group.size ?? 0);
    if (count > 1) {
      storageSaved += (count - 1) * size;
    }
  }

  const largestFilesData = await prisma.trackAudioFile.findMany({
    where: { fileSize: { not: null } },
    orderBy: { fileSize: "desc" },
    take: 10,
    select: {
      id: true,
      objectKey: true,
      format: true,
      fileSize: true,
      trackId: true,
      track: {
        select: {
          title: true,
          artist: {
            select: {
              name: true,
            },
          },
        },
      },
    },
  });

  const largestFiles = largestFilesData.map((f) => ({
    id: f.id,
    objectKey: f.objectKey,
    format: f.format,
    fileSize: f.fileSize || 0,
    trackId: f.trackId,
    // Orphaned storage rows keep a trackId after the Track row is gone.
    // SQLite does not always enforce that foreign key, and this list is part
    // of the page the admin overview links to for the health score.
    trackTitle: f.track?.title ?? "Missing track",
    artistName: f.track?.artist?.name ?? "—",
  }));

  return {
    totalBytes,
    totalFiles,
    avgFileSize,
    uniqueTracks,
    formatStats,
    dedup: {
      totalRecords: totalFiles,
      uniqueFiles: uniqueHashes,
      duplicatesAvoided,
      storageSaved,
    },
    largestFiles,
  };
}

/**
 * Same group total as `/music/admin/duplicates` with no filter: exact-hash and
 * similar-audio groups, excluding ones marked intentional, capped at the page size.
 */
export async function getDuplicateTracksCount(): Promise<number> {
  const dashboard = await loadDuplicateDashboard("all");
  return dashboard.stats.duplicateGroups;
}

export async function getOrphanedFilesCount(): Promise<number> {
  const orphanedFiles = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*) as count
    FROM TrackAudioFile taf
    LEFT JOIN Track t ON taf.trackId = t.id
    WHERE t.id IS NULL
  `;
  return Number(orphanedFiles[0]?.count ?? 0);
}

/**
 * Raw aggregate counts backing the admin database-quality page. Computed in one
 * cached pass so the loader does not re-run ~13 full-table aggregate queries
 * (8 COUNT scans + 5 helper queries including duplicate detection) on every
 * request.
 */
export interface DatabaseQualitySnapshot {
  totalTracks: number;
  tracksWithAudio: number;
  tracksWithCovers: number;
  tracksWithDuration: number;
  tracksWithAlbum: number;
  tracksWithYear: number;
  tracksWithGenre: number;
  tracksWithLyrics: number;
  metadataIssues: MetadataIssues;
  tracksWithMetadataIssues: number;
  storageStats: StorageStats;
  duplicateTracksCount: number;
  orphanedFilesCount: number;
  /** ISO timestamp of the most recent cache refresh (not the request time). */
  lastUpdated: string;
}

export function getDatabaseQualitySnapshot(): Promise<DatabaseQualitySnapshot> {
  return cachified({
    key: DATABASE_QUALITY_CACHE_KEY,
    cache,
    ttl: DATABASE_QUALITY_CACHE_TTL_MS,
    async getFreshValue(): Promise<DatabaseQualitySnapshot> {
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

      return {
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
        lastUpdated: new Date().toISOString(),
      };
    },
  });
}

/** Score and color for the admin overview. Same weights as the quality page. */
export async function getDatabaseHealthSummary(): Promise<{
  score: number;
  color: "green" | "yellow" | "red";
}> {
  const [
    totalTracks,
    tracksWithAudio,
    tracksWithCovers,
    tracksWithDuration,
    tracksWithAlbum,
    tracksWithYear,
    tracksWithGenre,
    tracksWithLyrics,
  ] = await Promise.all([
    prisma.track.count(),
    prisma.track.count({ where: { audioFiles: { some: {} } } }),
    prisma.track.count({ where: { coverImageId: { not: null } } }),
    prisma.track.count({ where: { duration: { not: null } } }),
    prisma.track.count({ where: { albumId: { not: null } } }),
    prisma.track.count({ where: { year: { not: null } } }),
    prisma.track.count({ where: { OR: [{ genre: { not: null } }, { genres: { some: {} } }] } }),
    prisma.track.count({ where: { lyrics: { not: null } } }),
  ]);

  const pct = (count: number) => (totalTracks > 0 ? (count / totalTracks) * 100 : 0);
  const score = Math.round(
    calculateHealthScore({
      audio: pct(tracksWithAudio),
      covers: pct(tracksWithCovers),
      duration: pct(tracksWithDuration),
      album: pct(tracksWithAlbum),
      year: pct(tracksWithYear),
      genre: pct(tracksWithGenre),
      lyrics: pct(tracksWithLyrics),
    }),
  );
  return { score, color: getHealthColor(score) };
}

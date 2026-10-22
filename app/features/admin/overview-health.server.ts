import { countTracksWithoutCovers } from "#app/features/admin/cover-fetch.server.ts";
import { getDatabaseHealthSummary } from "#app/features/admin/database-quality.server.ts";
import { getOrphanedTrackStats } from "#app/features/admin/orphaned-tracks.server.ts";
import {
  countFailedLoginsSince,
  isFailedLoginBadgeActive,
  SECURITY_WINDOWS,
} from "#app/features/security/suspicious-activity.server.ts";
import { prisma } from "#app/utils/db.server.ts";

export async function getAdminOverviewHealth(now = new Date()) {
  const since = new Date(now.getTime() - SECURITY_WINDOWS.reportMs);
  const [summary, storageRows, orphanStats, missingCovers, failedLogins24h] = await Promise.all([
    getDatabaseHealthSummary(),
    prisma.$queryRaw<Array<{ total: number | bigint | null }>>`
      SELECT SUM(fileSize) as total FROM TrackAudioFile
    `,
    getOrphanedTrackStats(),
    countTracksWithoutCovers(),
    countFailedLoginsSince(since),
  ]);

  return {
    score: summary.score,
    color: summary.color,
    storageBytes: Number(storageRows[0]?.total ?? 0),
    orphanedWasteMb: orphanStats.storageWasteMB,
    missingAudio: orphanStats.missingAudio,
    missingCovers,
    failedLogins24h,
    securityAlert: isFailedLoginBadgeActive(failedLogins24h),
  };
}

import { prisma } from "#app/utils/db.server.ts";
import { deleteUnreferencedObjectKeys } from "#app/utils/audio-cleanup.server.ts";
import { scheduleQueueTick } from "#app/features/audio-archive/worker.server.ts";

const MAX_ROWS = 500;

export interface TrackWithoutAudio {
  id: string;
  title: string;
  artistName: string;
  serviceName: string;
  serviceDisplayName: string;
  createdAt: Date;
}

export interface TrackWithFailedJob {
  id: string;
  title: string;
  artistName: string;
  jobStatus: string;
  errorHistory: string;
  retryCount: number;
  lastAttemptAt: Date | null;
  errorCategory: string;
}

export interface OrphanedAudioFile {
  id: string;
  objectKey: string;
  fileSize: number | null;
  format: string | null;
  uploadedAt: Date;
}

export interface UnusedTrack {
  id: string;
  title: string;
  artistName: string;
  serviceName: string;
  serviceDisplayName: string;
  createdAt: Date;
}

export interface OrphanedTrackStats {
  missingAudio: number;
  failedDownloads: number;
  storageOrphans: number;
  unusedTracks: number;
  storageWasteMB: number;
}

function unusedTrackAgeCutoff(ageDays: number | null): Date | null {
  if (ageDays === null) return null;
  return new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
}

/** Tracks nobody saved that are also unused by rooms and service playlists. */
function unusedTrackWhere(ageDays: number | null) {
  const ageFilter = unusedTrackAgeCutoff(ageDays);
  return {
    userTracks: { none: {} },
    playlists: { none: {} },
    servicePlaylistTracks: { none: {} },
    roomQueueItems: { none: {} },
    ...(ageFilter ? { createdAt: { lt: ageFilter } } : {}),
  };
}

function categorizeError(errorHistoryJson: string): string {
  try {
    const errors = JSON.parse(errorHistoryJson);
    if (Array.isArray(errors) && errors.length > 0) {
      const latest = errors[errors.length - 1] as { category?: string };
      return latest.category ?? "UNKNOWN";
    }
  } catch {
    return "UNKNOWN";
  }
  return "UNKNOWN";
}

export async function getOrphanedTrackStats(
  unusedTracksAgeDays: number | null = 30,
): Promise<OrphanedTrackStats> {
  const missingAudio = await prisma.track.count({
    where: { audioFiles: { none: {} } },
  });

  const failedDownloads = await prisma.archiveJob.count({
    where: { status: "failed" },
  });

  const storageOrphansResult = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*) as count
    FROM TrackAudioFile taf
    LEFT JOIN Track t ON taf.trackId = t.id
    WHERE t.id IS NULL
  `;
  const storageOrphans = Number(storageOrphansResult[0]?.count ?? 0);

  const orphanedFilesSize = await prisma.$queryRaw<Array<{ totalSize: bigint | null }>>`
    SELECT SUM(taf.fileSize) as totalSize
    FROM TrackAudioFile taf
    LEFT JOIN Track t ON taf.trackId = t.id
    WHERE t.id IS NULL
  `;
  const storageWasteBytes = Number(orphanedFilesSize[0]?.totalSize ?? 0);
  const storageWasteMB = Math.round(storageWasteBytes / (1024 * 1024));

  const unusedTracks = await prisma.track.count({
    where: unusedTrackWhere(unusedTracksAgeDays),
  });

  return {
    missingAudio,
    failedDownloads,
    storageOrphans,
    unusedTracks,
    storageWasteMB,
  };
}

export async function getTracksWithoutAudio(
  serviceFilter: string | null = null,
  { skip = 0, take = MAX_ROWS }: { skip?: number; take?: number } = {},
): Promise<{ items: TrackWithoutAudio[]; total: number }> {
  const where = {
    audioFiles: { none: {} },
    ...(serviceFilter && serviceFilter !== "all" ? { service: { name: serviceFilter } } : {}),
  };

  const [tracks, total] = await Promise.all([
    prisma.track.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        artist: { select: { name: true } },
        service: { select: { name: true, displayName: true } },
      },
    }),
    prisma.track.count({ where }),
  ]);

  return {
    items: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artistName: track.artist.name,
      serviceName: track.service.name,
      serviceDisplayName: track.service.displayName,
      createdAt: track.createdAt,
    })),
    total,
  };
}

export async function getTracksWithFailedJobs(
  errorCategoryFilter: string | null = null,
  { skip = 0, take = MAX_ROWS }: { skip?: number; take?: number } = {},
): Promise<{ items: TrackWithFailedJob[]; total: number }> {
  const filterActive = Boolean(errorCategoryFilter && errorCategoryFilter !== "all");

  if (!filterActive) {
    const [jobs, total] = await Promise.all([
      prisma.archiveJob.findMany({
        where: { status: "failed" },
        skip,
        take,
        orderBy: { lastAttemptAt: "desc" },
        select: {
          status: true,
          errorHistory: true,
          retryCount: true,
          lastAttemptAt: true,
          track: {
            select: {
              id: true,
              title: true,
              artist: { select: { name: true } },
            },
          },
        },
      }),
      prisma.archiveJob.count({ where: { status: "failed" } }),
    ]);

    return {
      items: jobs.map((job) => ({
        id: job.track.id,
        title: job.track.title,
        artistName: job.track.artist.name,
        jobStatus: job.status,
        errorHistory: job.errorHistory,
        retryCount: job.retryCount,
        lastAttemptAt: job.lastAttemptAt,
        errorCategory: categorizeError(job.errorHistory),
      })),
      total,
    };
  }

  // The error-category filter reads the latest error's category out of the JSON
  // errorHistory column. Filter in SQL (json_extract) so pagination stays correct
  // without loading every failed job into memory.
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      artistName: string;
      jobStatus: string;
      errorHistory: string;
      retryCount: number;
      lastAttemptAt: Date | string | number | null;
    }>
  >`
    SELECT
      t.id AS id,
      t.title AS title,
      a.name AS artistName,
      aj.status AS jobStatus,
      aj.errorHistory AS errorHistory,
      aj.retryCount AS retryCount,
      aj.lastAttemptAt AS lastAttemptAt
    FROM ArchiveJob aj
    INNER JOIN Track t ON aj.trackId = t.id
    INNER JOIN Artist a ON t.artistId = a.id
    WHERE aj.status = 'failed'
      AND json_extract(aj.errorHistory, '$[#-1].category') = ${errorCategoryFilter}
    ORDER BY aj.lastAttemptAt DESC
    LIMIT ${take} OFFSET ${skip}
  `;

  const countRows = await prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*) AS count
    FROM ArchiveJob aj
    WHERE aj.status = 'failed'
      AND json_extract(aj.errorHistory, '$[#-1].category') = ${errorCategoryFilter}
  `;

  return {
    items: rows.map((row) => ({
      id: row.id,
      title: row.title,
      artistName: row.artistName,
      jobStatus: row.jobStatus,
      errorHistory: row.errorHistory,
      retryCount: row.retryCount,
      lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt as Date) : null,
      errorCategory: errorCategoryFilter as string,
    })),
    total: Number(countRows[0]?.count ?? 0),
  };
}

export async function getOrphanedAudioFiles({
  skip = 0,
  take = MAX_ROWS,
}: { skip?: number; take?: number } = {}): Promise<{ items: OrphanedAudioFile[]; total: number }> {
  const [orphaned, totalRows] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        objectKey: string;
        fileSize: number | null;
        format: string | null;
        uploadedAt: Date;
      }>
    >`
      SELECT taf.id, taf.objectKey, taf.fileSize, taf.format, taf.uploadedAt
      FROM TrackAudioFile taf
      LEFT JOIN Track t ON taf.trackId = t.id
      WHERE t.id IS NULL
      ORDER BY taf.uploadedAt DESC
      LIMIT ${take} OFFSET ${skip}
    `,
    prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*) AS count
      FROM TrackAudioFile taf
      LEFT JOIN Track t ON taf.trackId = t.id
      WHERE t.id IS NULL
    `,
  ]);

  return { items: orphaned, total: Number(totalRows[0]?.count ?? 0) };
}

export async function getUnusedTracks(
  ageDays: number | null = 30,
  { skip = 0, take = MAX_ROWS }: { skip?: number; take?: number } = {},
): Promise<{ items: UnusedTrack[]; total: number }> {
  const where = unusedTrackWhere(ageDays);

  const [tracks, total] = await Promise.all([
    prisma.track.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
        artist: { select: { name: true } },
        service: { select: { name: true, displayName: true } },
      },
    }),
    prisma.track.count({ where }),
  ]);

  return {
    items: tracks.map((track) => ({
      id: track.id,
      title: track.title,
      artistName: track.artist.name,
      serviceName: track.service.name,
      serviceDisplayName: track.service.displayName,
      createdAt: track.createdAt,
    })),
    total,
  };
}

export async function filterTracksWithoutAudio(trackIds: string[]): Promise<string[]> {
  if (trackIds.length === 0) return [];
  const rows = await prisma.trackAudioFile.findMany({
    where: { trackId: { in: trackIds } },
    select: { trackId: true },
  });
  const withAudio = new Set(rows.map((row) => row.trackId));
  return trackIds.filter((id) => !withAudio.has(id));
}

export async function filterUnusedTracks(trackIds: string[]): Promise<string[]> {
  if (trackIds.length === 0) return [];
  const rows = await prisma.track.findMany({
    where: { id: { in: trackIds }, ...unusedTrackWhere(null) },
    select: { id: true },
  });
  const unused = new Set(rows.map((row) => row.id));
  return trackIds.filter((id) => unused.has(id));
}

export async function queueTrackForDownload(trackId: string): Promise<void> {
  await prisma.archiveJob.upsert({
    where: { trackId },
    create: { trackId, status: "pending", priority: true },
    update: { status: "pending", priority: true, retryCount: 0, errorHistory: "[]" },
  });
}

export async function queueTracksForDownload(trackIds: string[]): Promise<number> {
  let queued = 0;
  for (const trackId of trackIds) {
    await queueTrackForDownload(trackId);
    queued++;
  }
  // Schedule the worker tick once after the batch instead of per-track.
  if (queued > 0) scheduleQueueTick();
  return queued;
}

export interface DeleteImpact {
  trackCount: number;
  audioFilesCount: number;
  storageMB: number;
  userTracksCount: number;
  playlistReferencesCount: number;
}

export async function getDeleteImpact(trackIds: string[]): Promise<DeleteImpact> {
  if (trackIds.length === 0) {
    return {
      trackCount: 0,
      audioFilesCount: 0,
      storageMB: 0,
      userTracksCount: 0,
      playlistReferencesCount: 0,
    };
  }

  const [audioFiles, userTracks, playlistRefs] = await Promise.all([
    prisma.trackAudioFile.findMany({
      where: { trackId: { in: trackIds } },
      select: { fileSize: true },
    }),
    prisma.userTrack.count({
      where: { trackId: { in: trackIds } },
    }),
    prisma.userPlaylistTrack.count({
      where: { trackId: { in: trackIds } },
    }),
  ]);

  const storageBytes = audioFiles.reduce((sum, file) => sum + (file.fileSize ?? 0), 0);
  const storageMB = Math.round(storageBytes / (1024 * 1024));

  return {
    trackCount: trackIds.length,
    audioFilesCount: audioFiles.length,
    storageMB,
    userTracksCount: userTracks,
    playlistReferencesCount: playlistRefs,
  };
}

export async function deleteTracks(trackIds: string[]): Promise<{ deleted: number }> {
  if (trackIds.length === 0) {
    return { deleted: 0 };
  }

  const queuedOnRooms = await prisma.roomQueueItem.findMany({
    where: { trackId: { in: trackIds } },
    select: { trackId: true },
  });
  const blockedIds = new Set(queuedOnRooms.map((row) => row.trackId));
  const deletableIds = trackIds.filter((id) => !blockedIds.has(id));
  if (deletableIds.length === 0) {
    return { deleted: 0 };
  }

  const audioFiles = await prisma.trackAudioFile.findMany({
    where: { trackId: { in: deletableIds } },
    select: { objectKey: true },
  });

  // Cascade-delete first, then re-count remaining TrackAudioFile rows.
  // persistTrackAudio can reuse the same objectKey for another track; a
  // pre-delete cleanup would wipe audio still needed for playback.
  const result = await prisma.track.deleteMany({
    where: { id: { in: deletableIds } },
  });

  await deleteUnreferencedObjectKeys(audioFiles.map((file) => file.objectKey));

  return { deleted: result.count };
}

export async function cleanupOrphanedAudioFiles(fileIds: string[]): Promise<{ deleted: number }> {
  if (fileIds.length === 0) {
    return { deleted: 0 };
  }

  const allFiles = await prisma.trackAudioFile.findMany({
    where: { id: { in: fileIds } },
    select: { id: true, objectKey: true, trackId: true },
  });

  const trackIds = [...new Set(allFiles.map((f) => f.trackId))];
  const existingTracks = await prisma.track.findMany({
    where: { id: { in: trackIds } },
    select: { id: true },
  });

  const existingTrackIds = new Set(existingTracks.map((t) => t.id));
  const orphanedFiles = allFiles.filter((f) => !existingTrackIds.has(f.trackId));

  let deleted = 0;

  for (const file of orphanedFiles) {
    try {
      await prisma.trackAudioFile.delete({ where: { id: file.id } });
      deleted++;
    } catch (error) {
      console.error(`Failed to cleanup orphaned file ${file.objectKey}:`, error);
    }
  }

  await deleteUnreferencedObjectKeys(orphanedFiles.map((file) => file.objectKey));

  return { deleted };
}

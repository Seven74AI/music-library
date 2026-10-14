import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";
import {
  cleanupOrphanedAudioFiles,
  deleteTracks,
  getOrphanedTrackStats,
  getUnusedTracks,
} from "./orphaned-tracks.server.ts";

vi.mock("#app/utils/storage.server.ts", () => ({
  deleteFile: vi.fn(),
}));

vi.mock("#app/features/audio-archive/worker.server.ts", () => ({
  scheduleQueueTick: vi.fn(),
}));

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

async function createTrackWithAudio({
  title,
  objectKey,
  contentHash,
}: {
  title: string;
  objectKey: string;
  contentHash?: string;
}) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: `${title} artist ${suffix}`,
      normalizedName: `${title.toLowerCase()} artist ${suffix}`,
    },
  });
  const track = await prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      artistId: artist.id,
      serviceId: service.id,
      audioFiles: {
        create: {
          objectKey,
          contentHash: contentHash ?? `hash-${suffix}`,
          format: "mp3",
          mimeType: "audio/mpeg",
          fileName: `${title}.mp3`,
          serviceId: service.id,
        },
      },
    },
  });
  return { track, artist, service };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

describe("unused tracks age=all", () => {
  const createdTrackIds: string[] = [];
  const createdArtistIds: string[] = [];

  beforeEach(() => {
    createdTrackIds.length = 0;
    createdArtistIds.length = 0;
  });

  afterEach(async () => {
    if (createdTrackIds.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } }).catch(() => {});
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } }).catch(() => {});
    }
  });

  test("returns unused tracks of every age when the age cutoff is dropped", async () => {
    const olderThan90 = await createTrackWithAudio({
      title: "Unused older than 90 days",
      objectKey: `audio/tracks/local/unused-old-${Date.now()}.mp3`,
    });
    const newerThan7 = await createTrackWithAudio({
      title: "Unused newer than 7 days",
      objectKey: `audio/tracks/local/unused-new-${Date.now()}.mp3`,
    });
    createdTrackIds.push(olderThan90.track.id, newerThan7.track.id);
    createdArtistIds.push(olderThan90.artist.id, newerThan7.artist.id);

    await prisma.track.update({
      where: { id: olderThan90.track.id },
      data: { createdAt: daysAgo(100) },
    });
    await prisma.track.update({
      where: { id: newerThan7.track.id },
      data: { createdAt: daysAgo(1) },
    });

    const within90Days = await getUnusedTracks(90);
    const within90Ids = within90Days.map((track) => track.id);
    expect(within90Ids).toContain(olderThan90.track.id);
    expect(within90Ids).not.toContain(newerThan7.track.id);

    const within7Days = await getUnusedTracks(7);
    expect(within7Days.map((track) => track.id)).not.toContain(newerThan7.track.id);

    const allTracks = await getUnusedTracks(null);
    const allIds = allTracks.map((track) => track.id);
    expect(allIds).toContain(olderThan90.track.id);
    expect(allIds).toContain(newerThan7.track.id);

    const statsAll = await getOrphanedTrackStats(null);
    const stats90 = await getOrphanedTrackStats(90);
    expect(statsAll.unusedTracks).toBeGreaterThan(stats90.unusedTracks);
  });
});

describe("unused tracks still in use elsewhere", () => {
  const createdTrackIds: string[] = [];
  const createdArtistIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdPlaylistIds: string[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deleteFile).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (createdRoomIds.length > 0) {
      await prisma.roomQueueItem.deleteMany({ where: { roomId: { in: createdRoomIds } } });
      await prisma.roomParticipant.deleteMany({ where: { roomId: { in: createdRoomIds } } });
      await prisma.room.deleteMany({ where: { id: { in: createdRoomIds } } });
      createdRoomIds.length = 0;
    }
    if (createdPlaylistIds.length > 0) {
      await prisma.servicePlaylist.deleteMany({ where: { id: { in: createdPlaylistIds } } });
      createdPlaylistIds.length = 0;
    }
    if (createdTrackIds.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } }).catch(() => {});
      createdTrackIds.length = 0;
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } }).catch(() => {});
      createdArtistIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } }).catch(() => {});
      createdUserIds.length = 0;
    }
  });

  test("does not list a catalog track that is on a live party room queue", async () => {
    const queued = await createTrackWithAudio({
      title: "Queued in a room",
      objectKey: `audio/tracks/local/room-queued-${Date.now()}.mp3`,
    });
    const trulyUnused = await createTrackWithAudio({
      title: "Truly unused",
      objectKey: `audio/tracks/local/truly-unused-${Date.now()}.mp3`,
    });
    createdTrackIds.push(queued.track.id, trulyUnused.track.id);
    createdArtistIds.push(queued.artist.id, trulyUnused.artist.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const host = await prisma.user.create({
      data: {
        email: `unused-room-${suffix}@example.com`,
        username: `unroom${suffix}`.slice(0, 20),
      },
    });
    createdUserIds.push(host.id);
    const room = await prisma.room.create({
      data: {
        code: suffix.slice(-6).toUpperCase(),
        status: "open",
        originalHostUserId: host.id,
      },
    });
    createdRoomIds.push(room.id);
    const participant = await prisma.roomParticipant.create({
      data: {
        roomId: room.id,
        userId: host.id,
        displayName: "Host",
        role: "host",
      },
    });
    await prisma.roomQueueItem.create({
      data: {
        roomId: room.id,
        trackId: queued.track.id,
        position: 0,
        addedByParticipantId: participant.id,
      },
    });

    const unusedIds = (await getUnusedTracks(null)).map((track) => track.id);
    expect(unusedIds).not.toContain(queued.track.id);
    expect(unusedIds).toContain(trulyUnused.track.id);
  });

  test("does not list a catalog track that still belongs to a service playlist", async () => {
    const onPlaylist = await createTrackWithAudio({
      title: "On a YouTube playlist",
      objectKey: `audio/tracks/local/svc-pl-${Date.now()}.mp3`,
    });
    createdTrackIds.push(onPlaylist.track.id);
    createdArtistIds.push(onPlaylist.artist.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const owner = await prisma.user.create({
      data: {
        email: `unused-pl-${suffix}@example.com`,
        username: `unpl${suffix}`.slice(0, 20),
      },
    });
    createdUserIds.push(owner.id);
    const playlist = await prisma.servicePlaylist.create({
      data: {
        serviceId: onPlaylist.service.id,
        externalId: `pl-${suffix}`,
        title: `Playlist ${suffix}`,
        itemCount: 1,
        ownerId: owner.id,
      },
    });
    createdPlaylistIds.push(playlist.id);
    await prisma.servicePlaylistTrack.create({
      data: {
        playlistId: playlist.id,
        trackId: onPlaylist.track.id,
        position: 0,
      },
    });

    const unusedIds = (await getUnusedTracks(null)).map((track) => track.id);
    expect(unusedIds).not.toContain(onPlaylist.track.id);
  });

  test("deleteTracks leaves a room-queued track and its audio in place", async () => {
    const queued = await createTrackWithAudio({
      title: "Do not delete queued",
      objectKey: `audio/tracks/local/keep-queued-${Date.now()}.mp3`,
    });
    const throwaway = await createTrackWithAudio({
      title: "Safe to delete",
      objectKey: `audio/tracks/local/safe-delete-${Date.now()}.mp3`,
    });
    createdTrackIds.push(queued.track.id, throwaway.track.id);
    createdArtistIds.push(queued.artist.id, throwaway.artist.id);

    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const host = await prisma.user.create({
      data: {
        email: `unused-del-${suffix}@example.com`,
        username: `undel${suffix}`.slice(0, 20),
      },
    });
    createdUserIds.push(host.id);
    const room = await prisma.room.create({
      data: {
        code: suffix.slice(-6).toUpperCase(),
        status: "open",
        originalHostUserId: host.id,
      },
    });
    createdRoomIds.push(room.id);
    const participant = await prisma.roomParticipant.create({
      data: {
        roomId: room.id,
        userId: host.id,
        displayName: "Host",
        role: "host",
      },
    });
    await prisma.roomQueueItem.create({
      data: {
        roomId: room.id,
        trackId: queued.track.id,
        position: 0,
        addedByParticipantId: participant.id,
      },
    });

    const result = await deleteTracks([queued.track.id, throwaway.track.id]);

    expect(result.deleted).toBe(1);
    expect(await prisma.track.findUnique({ where: { id: queued.track.id } })).not.toBeNull();
    expect(await prisma.track.findUnique({ where: { id: throwaway.track.id } })).toBeNull();
    expect(await prisma.roomQueueItem.count({ where: { trackId: queued.track.id } })).toBe(1);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(
      expect.stringContaining("audio/tracks/local/safe-delete-"),
    );
  });
});

describe("orphaned-tracks delete storage safety", () => {
  const createdTrackIds: string[] = [];
  const createdArtistIds: string[] = [];

  beforeEach(() => {
    createdTrackIds.length = 0;
    createdArtistIds.length = 0;
    vi.clearAllMocks();
    vi.mocked(deleteFile).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    if (createdTrackIds.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } }).catch(() => {});
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } }).catch(() => {});
    }
  });

  test("deletes the S3 object when no other track references it", async () => {
    const { track, artist } = await createTrackWithAudio({
      title: "Solo unused",
      objectKey: `audio/tracks/local/solo-${Date.now()}.mp3`,
    });
    createdTrackIds.push(track.id);
    createdArtistIds.push(artist.id);

    const result = await deleteTracks([track.id]);

    expect(result.deleted).toBe(1);
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(expect.stringContaining("audio/tracks/local/solo-"));
    expect(await prisma.track.findUnique({ where: { id: track.id } })).toBeNull();
  });

  test("preserves a shared S3 object used by another track", async () => {
    const objectKey = `audio/tracks/local/shared-${Date.now()}.mp3`;
    const contentHash = `hash-shared-${Date.now()}`;
    const original = await createTrackWithAudio({
      title: "Library original",
      objectKey,
      contentHash,
    });
    const unusedDuplicate = await createTrackWithAudio({
      title: "Unused duplicate",
      objectKey,
      contentHash,
    });
    createdTrackIds.push(original.track.id, unusedDuplicate.track.id);
    createdArtistIds.push(original.artist.id, unusedDuplicate.artist.id);

    const result = await deleteTracks([unusedDuplicate.track.id]);

    expect(result.deleted).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await prisma.track.findUnique({ where: { id: unusedDuplicate.track.id } })).toBeNull();
    const surviving = await prisma.trackAudioFile.findFirst({
      where: { trackId: original.track.id },
    });
    expect(surviving?.objectKey).toBe(objectKey);
  });

  test("does not delete S3 when a concurrent dedup upload attaches after tracks are removed", async () => {
    const objectKey = `audio/tracks/local/race-${Date.now()}.mp3`;
    const contentHash = `hash-race-${Date.now()}`;
    const doomed = await createTrackWithAudio({
      title: "Doomed unused",
      objectKey,
      contentHash,
    });
    const incoming = await createTrackWithAudio({
      title: "Incoming dedup upload",
      objectKey: `audio/tracks/local/incoming-${Date.now()}.mp3`,
      contentHash: `hash-incoming-${Date.now()}`,
    });
    createdTrackIds.push(doomed.track.id, incoming.track.id);
    createdArtistIds.push(doomed.artist.id, incoming.artist.id);

    const incomingAudio = await prisma.trackAudioFile.findFirst({
      where: { trackId: incoming.track.id },
    });
    expect(incomingAudio).toBeTruthy();

    const originalDeleteMany = prisma.track.deleteMany.bind(prisma.track);
    const deleteSpy = vi.spyOn(prisma.track, "deleteMany").mockImplementation((async (args) => {
      const deleted = await originalDeleteMany(args);
      await prisma.trackAudioFile.update({
        where: { id: incomingAudio!.id },
        data: { objectKey, contentHash },
      });
      return deleted;
    }) as typeof prisma.track.deleteMany);

    const result = await deleteTracks([doomed.track.id]);
    deleteSpy.mockRestore();

    expect(result.deleted).toBe(1);
    expect(deleteFile).not.toHaveBeenCalled();
    const surviving = await prisma.trackAudioFile.findUnique({
      where: { id: incomingAudio!.id },
    });
    expect(surviving?.objectKey).toBe(objectKey);
  });

  test("cleanupOrphanedAudioFiles preserves a shared S3 object", async () => {
    const objectKey = `audio/tracks/local/orphan-shared-${Date.now()}.mp3`;
    const contentHash = `hash-orphan-shared-${Date.now()}`;
    const live = await createTrackWithAudio({
      title: "Live shared",
      objectKey,
      contentHash,
    });
    createdTrackIds.push(live.track.id);
    createdArtistIds.push(live.artist.id);

    const liveAudio = await prisma.trackAudioFile.findFirst({
      where: { trackId: live.track.id },
    });
    expect(liveAudio).toBeTruthy();

    await prisma.$executeRaw`PRAGMA foreign_keys = OFF`;
    const orphanId = `orphan-audio-${Date.now()}`;
    await prisma.$executeRaw`
      INSERT INTO TrackAudioFile (id, trackId, objectKey, contentHash, format, mimeType, fileName, createdAt, updatedAt, uploadedAt)
      VALUES (
        ${orphanId},
        ${"missing-track-id"},
        ${objectKey},
        ${contentHash},
        ${"mp3"},
        ${"audio/mpeg"},
        ${"orphan.mp3"},
        ${new Date().toISOString()},
        ${new Date().toISOString()},
        ${new Date().toISOString()}
      )
    `;
    await prisma.$executeRaw`PRAGMA foreign_keys = ON`;

    try {
      const result = await cleanupOrphanedAudioFiles([orphanId]);

      expect(result.deleted).toBe(1);
      expect(deleteFile).not.toHaveBeenCalled();
      expect(await prisma.trackAudioFile.findUnique({ where: { id: orphanId } })).toBeNull();
      const surviving = await prisma.trackAudioFile.findUnique({
        where: { id: liveAudio!.id },
      });
      expect(surviving?.objectKey).toBe(objectKey);
    } finally {
      await prisma.trackAudioFile.deleteMany({ where: { id: orphanId } }).catch(() => {});
    }
  });
});

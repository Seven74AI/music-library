import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { requireUserWithRole } from "#app/utils/permissions.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";
import { action } from "./tracks.$trackId.tsx";

vi.mock("#app/utils/permissions.server.ts", () => ({
  requireUserWithRole: vi.fn(),
}));

vi.mock("#app/utils/storage.server.ts", () => ({
  deleteFile: vi.fn(),
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

function deleteRequest(trackId?: string) {
  return {
    request: new Request(`http://localhost/api/admin/tracks/${trackId ?? ""}`, {
      method: "DELETE",
    }),
    params: { trackId },
    context: {},
  } as never;
}

async function readThrownStatus(error: unknown): Promise<number | undefined> {
  if (error instanceof Response) return error.status;
  if (typeof error === "object" && error !== null && "init" in error) {
    const init = (error as { init?: { status?: number } }).init;
    return init?.status;
  }
  return undefined;
}

describe("DELETE /api/admin/tracks/:trackId", () => {
  const createdTrackIds: string[] = [];
  const createdArtistIds: string[] = [];

  beforeEach(() => {
    createdTrackIds.length = 0;
    createdArtistIds.length = 0;
    vi.clearAllMocks();
    vi.mocked(requireUserWithRole).mockResolvedValue("admin-user");
    vi.mocked(deleteFile).mockResolvedValue(undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (createdTrackIds.length > 0) {
      await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } }).catch(() => {});
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } }).catch(() => {});
    }
  });

  test("rejects non-DELETE methods", async () => {
    try {
      await action({
        request: new Request("http://localhost/api/admin/tracks/track-1", { method: "POST" }),
        params: { trackId: "track-1" },
        context: {},
      } as never);
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(await readThrownStatus(error)).toBe(405);
    }
  });

  test("returns 404 for a missing track", async () => {
    try {
      await action(deleteRequest("missing-track-id"));
      expect.unreachable("Should have thrown");
    } catch (error) {
      expect(await readThrownStatus(error)).toBe(404);
    }
    expect(deleteFile).not.toHaveBeenCalled();
  });

  test("deletes the S3 object when no other track references it", async () => {
    const { track, artist } = await createTrackWithAudio({
      title: "Solo audio",
      objectKey: `audio/tracks/local/solo-${Date.now()}.mp3`,
    });
    createdTrackIds.push(track.id);
    createdArtistIds.push(artist.id);

    const result = await action(deleteRequest(track.id));

    expect(result).toMatchObject({
      data: {
        success: true,
        trackId: track.id,
      },
    });
    expect(deleteFile).toHaveBeenCalledTimes(1);
    expect(deleteFile).toHaveBeenCalledWith(expect.stringContaining("audio/tracks/local/solo-"));
    expect(await prisma.track.findUnique({ where: { id: track.id } })).toBeNull();
  });

  test("preserves a shared S3 object used by another track", async () => {
    const objectKey = `audio/tracks/local/shared-${Date.now()}.mp3`;
    const contentHash = `hash-shared-${Date.now()}`;
    const original = await createTrackWithAudio({
      title: "Original shared",
      objectKey,
      contentHash,
    });
    const duplicate = await createTrackWithAudio({
      title: "Duplicate shared",
      objectKey,
      contentHash,
    });
    createdTrackIds.push(original.track.id, duplicate.track.id);
    createdArtistIds.push(original.artist.id, duplicate.artist.id);

    const result = await action(deleteRequest(duplicate.track.id));

    expect(result).toMatchObject({
      data: {
        success: true,
        trackId: duplicate.track.id,
      },
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(await prisma.track.findUnique({ where: { id: duplicate.track.id } })).toBeNull();
    const surviving = await prisma.trackAudioFile.findFirst({
      where: { trackId: original.track.id },
    });
    expect(surviving?.objectKey).toBe(objectKey);
  });

  test("does not delete S3 when a concurrent dedup upload attaches after the track is removed", async () => {
    const objectKey = `audio/tracks/local/race-${Date.now()}.mp3`;
    const contentHash = `hash-race-${Date.now()}`;
    const doomed = await createTrackWithAudio({
      title: "Doomed original",
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

    const originalDelete = prisma.track.delete.bind(prisma.track);
    const deleteSpy = vi.spyOn(prisma.track, "delete").mockImplementation((async (args) => {
      const deleted = await originalDelete(args);
      // persistTrackAudio reused the doomed track's objectKey after the
      // pre-delete refcount but before S3 cleanup.
      await prisma.trackAudioFile.update({
        where: { id: incomingAudio!.id },
        data: { objectKey, contentHash },
      });
      return deleted;
    }) as typeof prisma.track.delete);

    const result = await action(deleteRequest(doomed.track.id));
    deleteSpy.mockRestore();

    expect(result).toMatchObject({
      data: {
        success: true,
        trackId: doomed.track.id,
      },
    });
    expect(deleteFile).not.toHaveBeenCalled();
    const surviving = await prisma.trackAudioFile.findUnique({
      where: { id: incomingAudio!.id },
    });
    expect(surviving?.objectKey).toBe(objectKey);
  });
});

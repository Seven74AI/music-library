import { beforeEach, describe, expect, test, vi } from "vitest";
import { LOCAL_SERVICE } from "#app/constants/services.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import {
  createLocalUpload,
  mergeMetadataForLocalUploadBackfill,
} from "./create-local-upload.server.ts";

vi.mock(
  "#app/features/track-audio-ingest/persist-track-audio.server.ts",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("#app/features/track-audio-ingest/persist-track-audio.server.ts")
      >();
    return {
      ...original,
      createTrackAudioFile: vi
        .fn()
        .mockResolvedValue({ id: "audio-1", trackId: "t1", objectKey: "k" }),
    };
  },
);

describe("createLocalUpload", () => {
  let serviceId: string;

  beforeEach(async () => {
    const service = await prisma.service.upsert({
      where: { name: LOCAL_SERVICE.NAME },
      update: {},
      create: {
        name: LOCAL_SERVICE.NAME,
        displayName: LOCAL_SERVICE.DISPLAY_NAME,
        baseUrl: LOCAL_SERVICE.BASE_URL,
      },
    });
    serviceId = service.id;
  });

  test("creates a thin track row without extended metadata columns", async () => {
    const trackId = `thin-${Date.now()}`;
    const title = `Thin track ${trackId}`;
    const artist = `Artist ${trackId}`;

    const result = await createLocalUpload({
      trackId,
      externalId: `ext-${trackId}`,
      userId: (await prisma.user.create({ data: createUser() })).id,
      serviceId,
      title,
      artist,
      artistMetadata: {},
      album: null,
      albumArtist: artist,
      yearForAlbum: 2020,
      extractedMetadata: {
        title,
        artist,
        duration: 120,
        isrc: "USRC17607839",
        year: 2020,
        genre: ["Rock"],
      },
      preparedCover: null,
      preparedAudio: {
        objectKey: `audio/${trackId}.mp3`,
        contentHash: "hash",
        audioFingerprint: null,
        isDuplicate: false,
      },
      audioFileName: "song.mp3",
      buffer: Buffer.from("x"),
      uploadedBy: "user",
    });

    const stored = await prisma.track.findUniqueOrThrow({ where: { id: result.track.id } });
    expect(stored.isrc).toBeNull();
    expect(stored.year).toBeNull();
    expect(stored.lyrics).toBeNull();
    expect(stored.releaseDate).toBeNull();
  });
});

describe("mergeMetadataForLocalUploadBackfill", () => {
  test("merges user overrides including genre string", () => {
    const merged = mergeMetadataForLocalUploadBackfill(
      { title: "File", artist: "A", genre: ["Pop"] },
      { genre: "Jazz, Blues", isrc: "XYZ" },
    );
    expect(merged.genre).toEqual(["Jazz", "Blues"]);
    expect(merged.isrc).toBe("XYZ");
  });
});

import { beforeEach, describe, expect, test, vi } from "vitest";
import { LOCAL_SERVICE } from "#app/constants/services.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { createTrackAudioFile } from "./persist-track-audio.server.ts";
import {
  createLocalUpload,
  createLocalUploadInTransaction,
  mergeMetadataForLocalUploadBackfill,
  type PreparedCoverHolder,
} from "./create-local-upload.server.ts";
import { type PreparedCoverImage } from "#app/utils/cover-management.server.ts";

const { mockAbandonUnpersistedPreparedCover } = vi.hoisted(() => ({
  mockAbandonUnpersistedPreparedCover: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#app/utils/cover-management.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("#app/utils/cover-management.server")>();
  return {
    ...original,
    abandonUnpersistedPreparedCover: mockAbandonUnpersistedPreparedCover,
    createCoverImageInTx: vi.fn().mockRejectedValue(new Error("cover row failed")),
  };
});

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
    mockAbandonUnpersistedPreparedCover.mockClear();
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

  test("treats user-cleared string fields as absent so file tags apply", () => {
    const merged = mergeMetadataForLocalUploadBackfill(
      { title: "From file", artist: "File artist", isrc: "TAG-ISRC", lyrics: "File lyrics" },
      { title: "", artist: "", isrc: "", lyrics: "" },
    );
    expect(merged.title).toBe("From file");
    expect(merged.artist).toBe("File artist");
    expect(merged.isrc).toBe("TAG-ISRC");
    expect(merged.lyrics).toBe("File lyrics");
  });
});

describe("preparedCoverHolder", () => {
  beforeEach(async () => {
    mockAbandonUnpersistedPreparedCover.mockClear();
    await prisma.service.upsert({
      where: { name: LOCAL_SERVICE.NAME },
      update: {},
      create: {
        name: LOCAL_SERVICE.NAME,
        displayName: LOCAL_SERVICE.DISPLAY_NAME,
        baseUrl: LOCAL_SERVICE.BASE_URL,
      },
    });
  });

  const preparedCover: PreparedCoverImage = {
    kind: "new",
    objectKey: `covers/holder-test-${Date.now()}.jpg`,
    contentHash: "hash",
    width: 10,
    height: 10,
    format: "jpeg",
    fileSize: 10,
  };

  test("nulls the holder when cover persistence is abandoned before a later transaction error", async () => {
    vi.mocked(createTrackAudioFile).mockRejectedValueOnce(new Error("audio row failed"));
    const holder: PreparedCoverHolder = { current: preparedCover };
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.findUniqueOrThrow({
      where: { name: LOCAL_SERVICE.NAME },
    });

    await expect(
      createLocalUploadInTransaction({
        tx: prisma,
        trackId: `holder-${Date.now()}`,
        externalId: `ext-holder-${Date.now()}`,
        userId: user.id,
        serviceId: service.id,
        title: "Holder",
        artist: "Artist",
        artistMetadata: {},
        album: null,
        albumArtist: "Artist",
        yearForAlbum: 2020,
        extractedMetadata: { title: "Holder", artist: "Artist", duration: 1 },
        preparedCover,
        preparedCoverHolder: holder,
        preparedAudio: {
          objectKey: `audio/holder-${Date.now()}.mp3`,
          contentHash: "audio-hash",
          audioFingerprint: null,
          isDuplicate: false,
        },
        audioFileName: "song.mp3",
        buffer: Buffer.from("x"),
        uploadedBy: user.id,
      }),
    ).rejects.toThrow();

    expect(mockAbandonUnpersistedPreparedCover).toHaveBeenCalledTimes(1);
    expect(holder.current).toBeNull();
    await prisma.user.delete({ where: { id: user.id } });
  });
});

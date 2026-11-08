import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";

vi.mock("#app/utils/artist-management.server", () => ({
  getOrCreateArtist: vi.fn().mockResolvedValue({ id: "artist-1" }),
}));
vi.mock("#app/utils/cover-management.server", () => ({
  getOrCreateAlbum: vi.fn().mockResolvedValue({ id: "album-1" }),
}));
vi.mock("#app/utils/track-genres.server.ts", () => ({
  replaceTrackGenresFromStrings: vi.fn(),
}));

import { getOrCreateAlbum } from "#app/utils/cover-management.server";
import { replaceTrackGenresFromStrings } from "#app/utils/track-genres.server.ts";
import { backfillTrackMetadata } from "./backfill-track-metadata.server.ts";

describe("backfillTrackMetadata", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
  });

  test("rounds float bpm and omits non-finite int metadata", async () => {
    const artist = await prisma.artist.create({
      data: { name: "Artist", normalizedName: "artist" },
    });
    const track = await prisma.track.create({
      data: {
        title: "T",
        externalId: "ext",
        serviceId: (
          await prisma.service.upsert({
            where: { name: "local" },
            update: {},
            create: { name: "local", displayName: "Local", baseUrl: "", isActive: true },
          })
        ).id,
        artistId: artist.id,
      },
    });

    await backfillTrackMetadata(track.id, {
      bpm: 128.6,
      year: 2020.9,
      originalYear: Number.NaN,
      totalTracks: 12.2,
      totalDiscs: 1.8,
      track: { no: 3.7 },
    });

    const updated = await prisma.track.findUniqueOrThrow({ where: { id: track.id } });
    expect(updated.bpm).toBe(129);
    expect(updated.year).toBe(2021);
    expect(updated.originalYear).toBeNull();
    expect(updated.totalTracks).toBe(12);
    expect(updated.totalDiscs).toBe(2);
    expect(updated.trackNumber).toBe(4);
  });

  test("passes a rounded album year into getOrCreateAlbum", async () => {
    const artist = await prisma.artist.create({
      data: { name: "Artist2", normalizedName: "artist2" },
    });
    const album = await prisma.album.create({
      data: { name: "Some Album", artistId: artist.id },
    });
    vi.mocked(getOrCreateAlbum).mockResolvedValue({ id: album.id });
    const track = await prisma.track.create({
      data: {
        title: "T2",
        externalId: "ext2",
        serviceId: (
          await prisma.service.upsert({
            where: { name: "local" },
            update: {},
            create: { name: "local", displayName: "Local", baseUrl: "", isActive: true },
          })
        ).id,
        artistId: artist.id,
      },
    });

    await backfillTrackMetadata(track.id, {
      album: "Some Album",
      year: 1984.6,
    });

    expect(getOrCreateAlbum).toHaveBeenCalledWith(artist.id, "Some Album", 1985);
  });

  test("runs genre backfill when scalar metadata is already complete", async () => {
    const artist = await prisma.artist.create({
      data: { name: "Genre Artist", normalizedName: "genre artist" },
    });
    const track = await prisma.track.create({
      data: {
        title: "Complete",
        externalId: "ext-genre-only",
        serviceId: (
          await prisma.service.upsert({
            where: { name: "local" },
            update: {},
            create: { name: "local", displayName: "Local", baseUrl: "", isActive: true },
          })
        ).id,
        artistId: artist.id,
      },
    });

    await backfillTrackMetadata(track.id, { genre: ["Jazz", "Fusion"] });

    expect(replaceTrackGenresFromStrings).toHaveBeenCalledWith(expect.anything(), track.id, [
      "Jazz",
      "Fusion",
    ]);
  });
});

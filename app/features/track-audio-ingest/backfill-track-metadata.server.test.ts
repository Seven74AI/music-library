import { beforeEach, describe, expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";

vi.mock("#app/utils/artist-management.server", () => ({
  getOrCreateArtist: vi.fn(),
}));
vi.mock("#app/utils/cover-management.server", () => ({
  getOrCreateAlbum: vi.fn(),
}));
vi.mock("#app/utils/track-genres.server.ts", () => ({
  replaceTrackGenresFromStrings: vi.fn(),
}));

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
});

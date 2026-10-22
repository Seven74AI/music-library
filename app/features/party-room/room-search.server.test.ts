import { describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { searchRoomCatalog, trackHasAudioFiles } from "./room-search.server.ts";

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

async function createTrackWithOptionalAudio(opts: {
  title: string;
  artistName: string;
  withAudio: boolean;
}) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const artist = await prisma.artist.create({
    data: {
      name: opts.artistName,
      normalizedName: opts.artistName.toLowerCase(),
    },
  });
  const track = await prisma.track.create({
    data: {
      title: opts.title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: { connect: { id: artist.id } },
    },
  });
  if (opts.withAudio) {
    await prisma.trackAudioFile.create({
      data: {
        trackId: track.id,
        objectKey: `audio/${suffix}.flac`,
        format: "flac",
        mimeType: "audio/flac",
      },
    });
  }
  return { track, artist };
}

describe("trackHasAudioFiles", () => {
  test("true only when at least one audio file exists", () => {
    expect(trackHasAudioFiles(0)).toBe(false);
    expect(trackHasAudioFiles(1)).toBe(true);
  });
});

describe("searchRoomCatalog has-audio filter", () => {
  test("returns tracks with audio and excludes tracks without audio", async () => {
    const marker = `HasAudioFilter${Date.now()}`;
    await createTrackWithOptionalAudio({
      title: `${marker} WithAudio`,
      artistName: `${marker} ArtistA`,
      withAudio: true,
    });
    await createTrackWithOptionalAudio({
      title: `${marker} NoAudio`,
      artistName: `${marker} ArtistB`,
      withAudio: false,
    });

    const result = await searchRoomCatalog({
      query: marker,
      type: "tracks",
      limit: 20,
    });

    const titles = result.results
      .filter((r) => r.type === "track")
      .map((r) => (r.type === "track" ? r.title : ""));

    expect(titles.some((t) => t.includes("WithAudio"))).toBe(true);
    expect(titles.some((t) => t.includes("NoAudio"))).toBe(false);
  });

  test("album results only include albums that have at least one has-audio track", async () => {
    const marker = `AlbumAudio${Date.now()}`;
    const service = await ensureLocalService();
    const artist = await prisma.artist.create({
      data: { name: `${marker} Artist`, normalizedName: `${marker} artist` },
    });
    const albumWith = await prisma.album.create({
      data: { name: `${marker} With`, artistId: artist.id },
    });
    const albumWithout = await prisma.album.create({
      data: { name: `${marker} Without`, artistId: artist.id },
    });

    const withTrack = await prisma.track.create({
      data: {
        title: `${marker} Track With`,
        externalId: `ext-w-${Date.now()}`,
        serviceId: service.id,
        artistId: artist.id,
        albumId: albumWith.id,
      },
    });
    await prisma.trackAudioFile.create({
      data: {
        trackId: withTrack.id,
        objectKey: `audio/${marker}-with.flac`,
        format: "flac",
      },
    });
    await prisma.track.create({
      data: {
        title: `${marker} Track Without`,
        externalId: `ext-wo-${Date.now()}`,
        serviceId: service.id,
        artistId: artist.id,
        albumId: albumWithout.id,
      },
    });

    const result = await searchRoomCatalog({
      query: marker,
      type: "albums",
      limit: 20,
    });
    const names = result.results
      .filter((r) => r.type === "album")
      .map((r) => (r.type === "album" ? r.name : ""));

    expect(names.some((n) => n.includes("With"))).toBe(true);
    expect(names.some((n) => n.includes("Without"))).toBe(false);
  });
});

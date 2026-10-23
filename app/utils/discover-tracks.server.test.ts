import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { listDiscoverTracks } from "./discover-tracks.server.ts";

async function createTrack(title: string, artistName?: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const service = await prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      service: { connect: { id: service.id } },
      artist: {
        create: {
          name: artistName || `Artist ${suffix}`,
          normalizedName: (artistName || `artist ${suffix}`).toLowerCase(),
        },
      },
    },
  });
}

async function addToLibrary(userId: string, trackId: string, createdAt: Date) {
  return prisma.userTrack.create({
    data: { userId, trackId, createdAt },
  });
}

async function seedCompleted(userId: string, trackId: string, createdAt: Date, count = 1) {
  for (let i = 0; i < count; i++) {
    await prisma.usageEvent.create({
      data: {
        type: USAGE_EVENT_TYPES.play_completed,
        userId,
        trackId,
        createdAt,
      },
    });
  }
}

describe("listDiscoverTracks", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("recentlyAdded shows all tracks sorted by createdAt desc", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const older = await createTrack("Older Track");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newer = await createTrack("Newer Track");

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      limit: 50,
    });

    expect(tracks.length).toBeGreaterThanOrEqual(2);
    const ourTracks = tracks.filter((t) => t.id === older.id || t.id === newer.id);
    expect(ourTracks.map((t) => t.title)).toEqual(["Newer Track", "Older Track"]);
  });

  test("recentlyAdded respects ascending direction", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const older = await createTrack("Older Track");
    await new Promise((resolve) => setTimeout(resolve, 10));
    const newer = await createTrack("Newer Track");

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      direction: "asc",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => t.id === older.id || t.id === newer.id);
    expect(ourTracks.map((t) => t.title)).toEqual(["Older Track", "Newer Track"]);
  });

  test("titleAZ sorts tracks alphabetically by title", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const zebra = await createTrack("Zebra Song");
    const alpha = await createTrack("Alpha Song");
    const middle = await createTrack("Middle Song");

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "titleAZ",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => [zebra.id, alpha.id, middle.id].includes(t.id));
    expect(ourTracks.map((t) => t.title)).toEqual(["Alpha Song", "Middle Song", "Zebra Song"]);
  });

  test("titleAZ respects descending direction", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const zebra = await createTrack("Zebra Song");
    const alpha = await createTrack("Alpha Song");
    const middle = await createTrack("Middle Song");

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "titleAZ",
      direction: "desc",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => [zebra.id, alpha.id, middle.id].includes(t.id));
    expect(ourTracks.map((t) => t.title)).toEqual(["Zebra Song", "Middle Song", "Alpha Song"]);
  });

  test("artistAZ sorts tracks by artist name then title", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const suffix1 = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const suffix2 = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const zebraArtist = await prisma.artist.create({
      data: { name: `Zebra Artist ${suffix1}`, normalizedName: `zebra artist ${suffix1}` },
    });

    const alphaArtist = await prisma.artist.create({
      data: { name: `Alpha Artist ${suffix2}`, normalizedName: `alpha artist ${suffix2}` },
    });

    const service = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
    });

    const track1 = await prisma.track.create({
      data: {
        title: "Song A",
        externalId: `ext-${Date.now()}-1`,
        serviceId: service.id,
        artistId: zebraArtist.id,
      },
    });

    const track2 = await prisma.track.create({
      data: {
        title: "Song B",
        externalId: `ext-${Date.now()}-2`,
        serviceId: service.id,
        artistId: alphaArtist.id,
      },
    });

    const track3 = await prisma.track.create({
      data: {
        title: "Song A",
        externalId: `ext-${Date.now()}-3`,
        serviceId: service.id,
        artistId: alphaArtist.id,
      },
    });

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "artistAZ",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => [track1.id, track2.id, track3.id].includes(t.id));
    expect(ourTracks.map((t) => `${t.artist.name} - ${t.title}`)).toEqual([
      `Alpha Artist ${suffix2} - Song A`,
      `Alpha Artist ${suffix2} - Song B`,
      `Zebra Artist ${suffix1} - Song A`,
    ]);
  });

  test("mostPlayed sorts by play count descending", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const low = await createTrack("Low Play Count");
    const high = await createTrack("High Play Count");
    const zero = await createTrack("Zero Plays");

    await seedCompleted(user.id, high.id, new Date("2026-09-05T12:00:00.000Z"), 5);
    await seedCompleted(user.id, low.id, new Date("2026-09-05T12:00:00.000Z"), 1);

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "mostPlayed",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => [low.id, high.id, zero.id].includes(t.id));
    expect(ourTracks.map((t) => t.title)).toEqual([
      "High Play Count",
      "Low Play Count",
      "Zero Plays",
    ]);
  });

  test("mostLiked sorts by number of users with track in library", async () => {
    const user1 = await prisma.user.create({ data: createUser() });
    const user2 = await prisma.user.create({ data: createUser() });
    const user3 = await prisma.user.create({ data: createUser() });

    const popular = await createTrack("Popular Track");
    const somewhat = await createTrack("Somewhat Popular");
    const unpopular = await createTrack("Unpopular Track");

    await addToLibrary(user1.id, popular.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user2.id, popular.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user3.id, popular.id, new Date("2026-01-01T00:00:00.000Z"));

    await addToLibrary(user1.id, somewhat.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user2.id, somewhat.id, new Date("2026-01-01T00:00:00.000Z"));

    await addToLibrary(user1.id, unpopular.id, new Date("2026-01-01T00:00:00.000Z"));

    const { tracks } = await listDiscoverTracks({
      userId: user1.id,
      sort: "mostLiked",
      limit: 50,
    });

    const ourTracks = tracks.filter((t) => [popular.id, somewhat.id, unpopular.id].includes(t.id));
    expect(ourTracks.map((t) => t.title)).toEqual([
      "Popular Track",
      "Somewhat Popular",
      "Unpopular Track",
    ]);
  });

  test("mostPlayed cursor pagination returns disjoint ordered pages", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const tracks: Array<{ id: string }> = [];
    for (let i = 0; i < 5; i++) {
      tracks.push(await createTrack(`Paged Play ${i}`));
    }
    // Distinct play counts: tracks[i] has i plays.
    for (let i = 0; i < tracks.length; i++) {
      await seedCompleted(user.id, tracks[i]!.id, new Date("2026-09-05T12:00:00.000Z"), i);
    }

    const page1 = await listDiscoverTracks({ userId: user.id, sort: "mostPlayed", limit: 2 });
    const page2 = await listDiscoverTracks({
      userId: user.id,
      sort: "mostPlayed",
      limit: 2,
      cursor: page1.pagination.nextCursor,
    });
    const page3 = await listDiscoverTracks({
      userId: user.id,
      sort: "mostPlayed",
      limit: 2,
      cursor: page2.pagination.nextCursor,
    });

    const allIds = [page1, page2, page3].flatMap((p) => p.tracks.map((t) => t.id));
    expect(allIds).toEqual([
      tracks[4]!.id,
      tracks[3]!.id,
      tracks[2]!.id,
      tracks[1]!.id,
      tracks[0]!.id,
    ]);
    expect(new Set(allIds).size).toBe(5);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page2.pagination.hasNext).toBe(true);
    expect(page3.pagination.hasNext).toBe(false);
  });

  test("mostLiked cursor pagination returns disjoint pages", async () => {
    const viewer = await prisma.user.create({ data: createUser() });
    const liker1 = await prisma.user.create({ data: createUser() });
    const liker2 = await prisma.user.create({ data: createUser() });
    const liker3 = await prisma.user.create({ data: createUser() });

    const tracks: Array<{ id: string }> = [];
    for (let i = 0; i < 5; i++) {
      tracks.push(await createTrack(`Paged Like ${i}`));
    }
    // like counts: tracks[0]=3, tracks[1]=2, tracks[2]=1, tracks[3..4]=0
    for (const liker of [liker1, liker2, liker3]) {
      await addToLibrary(liker.id, tracks[0]!.id, new Date("2026-01-01T00:00:00.000Z"));
    }
    await addToLibrary(liker1.id, tracks[1]!.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(liker2.id, tracks[1]!.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(liker1.id, tracks[2]!.id, new Date("2026-01-01T00:00:00.000Z"));

    const page1 = await listDiscoverTracks({ userId: viewer.id, sort: "mostLiked", limit: 2 });
    const page2 = await listDiscoverTracks({
      userId: viewer.id,
      sort: "mostLiked",
      limit: 2,
      cursor: page1.pagination.nextCursor,
    });
    const page3 = await listDiscoverTracks({
      userId: viewer.id,
      sort: "mostLiked",
      limit: 2,
      cursor: page2.pagination.nextCursor,
    });

    expect(page1.tracks.map((t) => t.id)).toEqual([tracks[0]!.id, tracks[1]!.id]);
    expect(page2.tracks[0]?.id).toBe(tracks[2]!.id);
    const allIds = [page1, page2, page3].flatMap((p) => p.tracks.map((t) => t.id));
    expect(new Set(allIds).size).toBe(5);
    expect(page3.pagination.hasNext).toBe(false);
  });

  test("isInUserLibrary flag is set correctly", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const inLibrary = await createTrack("In Library");
    const notInLibrary = await createTrack("Not In Library");

    await addToLibrary(user.id, inLibrary.id, new Date("2026-01-01T00:00:00.000Z"));

    const { tracks } = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      limit: 50,
    });

    const inLibraryTrack = tracks.find((t) => t.id === inLibrary.id);
    const notInLibraryTrack = tracks.find((t) => t.id === notInLibrary.id);

    expect(inLibraryTrack?.isInUserLibrary).toBe(true);
    expect(notInLibraryTrack?.isInUserLibrary).toBe(false);
  });

  test("pagination works correctly", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
    });

    const trackIds: string[] = [];
    for (let i = 0; i < 15; i++) {
      const artist = await prisma.artist.create({
        data: { name: `Artist ${i}`, normalizedName: `artist ${i}` },
      });
      const track = await prisma.track.create({
        data: {
          title: `Track ${i}`,
          externalId: `ext-discover-${i}-${Date.now()}`,
          serviceId: service.id,
          artistId: artist.id,
        },
      });
      trackIds.push(track.id);
    }

    const page1 = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      limit: 10,
    });

    expect(page1.tracks.length).toBeGreaterThanOrEqual(10);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page1.pagination.nextCursor).toBeTruthy();

    const page2 = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      limit: 10,
      cursor: page1.pagination.nextCursor,
    });

    expect(page2.tracks.length).toBeGreaterThan(0);

    const page1Ids = new Set(page1.tracks.map((t) => t.id));
    const page2Ids = new Set(page2.tracks.map((t) => t.id));
    const intersection = [...page1Ids].filter((id) => page2Ids.has(id));
    expect(intersection).toEqual([]);
  });

  test("returns empty array when no tracks exist", async () => {
    const user = await prisma.user.create({ data: createUser() });

    const { tracks, pagination } = await listDiscoverTracks({
      userId: user.id,
      sort: "recentlyAdded",
      limit: 50,
    });

    expect(tracks).toEqual([]);
    expect(pagination.hasNext).toBe(false);
    expect(pagination.nextCursor).toBeNull();
  });
});

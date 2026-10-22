import { beforeEach, describe, expect, test } from "vitest";
import { USAGE_EVENT_TYPES } from "#app/features/usage-analytics/record-usage.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { createUser } from "#tests/db-utils.ts";
import { listLibraryQueueSpineTracks, listLibraryUserTracks } from "./library-tracks.server.ts";

async function createTrack(title: string) {
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
        create: { name: `Artist ${suffix}`, normalizedName: `artist ${suffix}` },
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

describe("listLibraryQueueSpineTracks", () => {
  beforeEach(async () => {
    await prisma.usageEvent.deleteMany();
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("mostPlayedMonth spine matches library page order with minimal projection", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const low = await createTrack("Low");
    const high = await createTrack("High");
    const zero = await createTrack("Zero");
    const now = new Date("2026-09-20T12:00:00.000Z");

    await addToLibrary(user.id, low.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user.id, high.id, new Date("2026-01-02T00:00:00.000Z"));
    await addToLibrary(user.id, zero.id, new Date("2026-01-03T00:00:00.000Z"));

    await seedCompleted(user.id, high.id, new Date("2026-09-05T12:00:00.000Z"), 5);
    await seedCompleted(user.id, low.id, new Date("2026-09-05T12:00:00.000Z"), 1);

    const tracks = await listLibraryQueueSpineTracks({
      userId: user.id,
      sort: "mostPlayedMonth",
      hasAudioOnly: false,
      now,
    });

    expect(tracks.map((track) => track.title)).toEqual(["High", "Low", "Zero"]);
    expect(tracks[0]).toEqual({
      id: high.id,
      title: "High",
      artist: expect.objectContaining({ name: expect.any(String) }),
    });
    expect(tracks[0]).not.toHaveProperty("audioFiles");
  });
});

describe("listLibraryUserTracks most-played sorts", () => {
  beforeEach(async () => {
    await prisma.curatorNote.deleteMany();
    await prisma.usageEvent.deleteMany();
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.artist.deleteMany();
    await prisma.session.deleteMany();
    await prisma.user.deleteMany();
  });

  test("mostPlayedMonth orders full library by this-month completes with zero last", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const low = await createTrack("Low");
    const high = await createTrack("High");
    const zero = await createTrack("Zero");
    const now = new Date("2026-09-20T12:00:00.000Z");

    await addToLibrary(user.id, low.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user.id, high.id, new Date("2026-01-02T00:00:00.000Z"));
    await addToLibrary(user.id, zero.id, new Date("2026-01-03T00:00:00.000Z"));

    await seedCompleted(user.id, high.id, new Date("2026-09-05T12:00:00.000Z"), 5);
    await seedCompleted(user.id, low.id, new Date("2026-09-05T12:00:00.000Z"), 1);
    // last month only — does not help low for month sort
    await seedCompleted(user.id, low.id, new Date("2026-08-05T12:00:00.000Z"), 20);

    const { userTracks } = await listLibraryUserTracks({
      userId: user.id,
      sort: "mostPlayedMonth",
      limit: 50,
      now,
    });

    expect(userTracks.map((ut) => ut.track.title)).toEqual(["High", "Low", "Zero"]);
  });

  test("mostPlayedEver uses lifetime counts and has no home-style 50 cap", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const service = await prisma.service.upsert({
      where: { name: "local" },
      update: {},
      create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
    });

    const trackIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      const artist = await prisma.artist.create({
        data: { name: `Artist ${i}`, normalizedName: `artist ${i}` },
      });
      const track = await prisma.track.create({
        data: {
          title: `T${i}`,
          externalId: `ext-lib-${i}`,
          serviceId: service.id,
          artistId: artist.id,
        },
      });
      trackIds.push(track.id);
      await prisma.userTrack.create({
        data: {
          userId: user.id,
          trackId: track.id,
          createdAt: new Date(`2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
        },
      });
    }

    await prisma.usageEvent.createMany({
      data: trackIds.flatMap((trackId, i) =>
        Array.from({ length: i + 1 }, () => ({
          type: USAGE_EVENT_TYPES.play_completed,
          userId: user.id,
          trackId,
          createdAt: new Date("2025-06-01T12:00:00.000Z"),
        })),
      ),
    });

    const page1 = await listLibraryUserTracks({
      userId: user.id,
      sort: "mostPlayedEver",
      limit: 5,
    });
    expect(page1.userTracks).toHaveLength(5);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page1.userTracks[0]?.track.title).toBe("T11");
    expect(page1.userTracks.map((ut) => ut.track.title)).toEqual(["T11", "T10", "T9", "T8", "T7"]);

    const page2 = await listLibraryUserTracks({
      userId: user.id,
      sort: "mostPlayedEver",
      limit: 5,
      cursor: page1.pagination.nextCursor,
    });
    expect(page2.userTracks).toHaveLength(5);
    expect(page2.pagination.hasNext).toBe(true);
    expect(page2.userTracks[0]?.track.title).toBe("T6");

    const page3 = await listLibraryUserTracks({
      userId: user.id,
      sort: "mostPlayedEver",
      limit: 5,
      cursor: page2.pagination.nextCursor,
    });
    expect(page3.userTracks).toHaveLength(2);
    expect(page3.pagination.hasNext).toBe(false);
    expect(page3.userTracks.map((ut) => ut.track.title)).toEqual(["T1", "T0"]);
  }, 20_000);

  test("dateAdded keeps newest-first ordering", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const older = await createTrack("Older");
    const newer = await createTrack("Newer");
    await addToLibrary(user.id, older.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user.id, newer.id, new Date("2026-06-01T00:00:00.000Z"));

    const { userTracks } = await listLibraryUserTracks({
      userId: user.id,
      sort: "dateAdded",
      limit: 10,
    });

    expect(userTracks.map((ut) => ut.track.title)).toEqual(["Newer", "Older"]);
  });

  test("genreId returns only that user's active library tracks tagged with the genre", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const otherUser = await prisma.user.create({ data: createUser() });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const taggedNew = await createTrack("Tagged New");
    const taggedOld = await createTrack("Tagged Old");
    const untagged = await createTrack("Untagged");
    const otherUsersTrack = await createTrack("Other Library");
    const removed = await createTrack("Removed");
    const silent = await createTrack("Silent");
    const playable = await createTrack("Playable");

    const genre = await prisma.genre.create({
      data: {
        name: `Jazz ${suffix}`,
        normalizedName: `jazz ${suffix}`,
        tracks: {
          connect: [
            { id: taggedNew.id },
            { id: taggedOld.id },
            { id: otherUsersTrack.id },
            { id: removed.id },
            { id: silent.id },
            { id: playable.id },
          ],
        },
      },
    });
    const emptyGenre = await prisma.genre.create({
      data: {
        name: `Empty ${suffix}`,
        normalizedName: `empty ${suffix}`,
      },
    });

    try {
      await addToLibrary(user.id, taggedOld.id, new Date("2026-01-01T00:00:00.000Z"));
      await addToLibrary(user.id, taggedNew.id, new Date("2026-03-01T00:00:00.000Z"));
      await addToLibrary(user.id, untagged.id, new Date("2026-04-01T00:00:00.000Z"));
      await addToLibrary(otherUser.id, otherUsersTrack.id, new Date("2026-05-01T00:00:00.000Z"));
      await prisma.userTrack.create({
        data: {
          userId: user.id,
          trackId: removed.id,
          isActive: false,
          deletedAt: new Date("2026-05-02T00:00:00.000Z"),
          createdAt: new Date("2026-05-02T00:00:00.000Z"),
        },
      });
      await addToLibrary(user.id, silent.id, new Date("2026-02-01T00:00:00.000Z"));
      await addToLibrary(user.id, playable.id, new Date("2026-02-15T00:00:00.000Z"));
      await prisma.trackAudioFile.create({
        data: { trackId: playable.id, objectKey: `audio/${playable.id}.mp3`, format: "mp3" },
      });

      const { userTracks } = await listLibraryUserTracks({
        userId: user.id,
        sort: "dateAdded",
        genreId: genre.id,
        limit: 10,
      });

      expect(userTracks.map((row) => row.track.title)).toEqual([
        "Tagged New",
        "Playable",
        "Silent",
        "Tagged Old",
      ]);

      const empty = await listLibraryUserTracks({
        userId: user.id,
        sort: "dateAdded",
        genreId: emptyGenre.id,
        limit: 10,
      });
      expect(empty.userTracks).toEqual([]);

      const playableOnly = await listLibraryUserTracks({
        userId: user.id,
        sort: "dateAdded",
        genreId: genre.id,
        hasAudioOnly: true,
        limit: 10,
      });
      expect(playableOnly.userTracks.map((row) => row.track.title)).toEqual(["Playable"]);

      await seedCompleted(user.id, untagged.id, new Date("2026-06-01T00:00:00.000Z"), 4);
      const mostPlayed = await listLibraryUserTracks({
        userId: user.id,
        sort: "mostPlayedEver",
        genreId: genre.id,
        limit: 10,
        now: new Date("2026-06-15T00:00:00.000Z"),
      });
      expect(mostPlayed.userTracks.map((row) => row.track.title)).not.toContain("Untagged");
      expect(mostPlayed.userTracks.map((row) => row.track.id)).toEqual(
        expect.arrayContaining([taggedNew.id, taggedOld.id, silent.id, playable.id]),
      );
    } finally {
      await prisma.genre.deleteMany({ where: { id: { in: [genre.id, emptyGenre.id] } } });
    }
  });

  test("genre filter paginates matching tracks only", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const oldest = await createTrack("Oldest Tagged");
    const middle = await createTrack("Middle Tagged");
    const newest = await createTrack("Newest Tagged");
    const untagged = await createTrack("Newest Untagged");
    const genre = await prisma.genre.create({
      data: {
        name: `Page ${suffix}`,
        normalizedName: `page ${suffix}`,
        tracks: { connect: [{ id: oldest.id }, { id: middle.id }, { id: newest.id }] },
      },
    });

    try {
      await addToLibrary(user.id, oldest.id, new Date("2026-01-01T00:00:00.000Z"));
      await addToLibrary(user.id, middle.id, new Date("2026-02-01T00:00:00.000Z"));
      await addToLibrary(user.id, newest.id, new Date("2026-03-01T00:00:00.000Z"));
      await addToLibrary(user.id, untagged.id, new Date("2026-04-01T00:00:00.000Z"));

      const page1 = await listLibraryUserTracks({
        userId: user.id,
        sort: "dateAdded",
        genreId: genre.id,
        limit: 2,
      });
      expect(page1.userTracks.map((row) => row.track.title)).toEqual([
        "Newest Tagged",
        "Middle Tagged",
      ]);
      expect(page1.pagination.hasNext).toBe(true);

      const page2 = await listLibraryUserTracks({
        userId: user.id,
        sort: "dateAdded",
        genreId: genre.id,
        limit: 2,
        cursor: page1.pagination.nextCursor,
      });
      expect(page2.userTracks.map((row) => row.track.title)).toEqual(["Oldest Tagged"]);
      expect(page2.pagination.hasNext).toBe(false);
    } finally {
      await prisma.genre.delete({ where: { id: genre.id } });
    }
  });

  test("includes curator note counts on library tracks for date added and most played", async () => {
    const user = await prisma.user.create({ data: createUser() });
    const noted = await createTrack("Noted");
    const plain = await createTrack("Plain");
    await addToLibrary(user.id, noted.id, new Date("2026-01-01T00:00:00.000Z"));
    await addToLibrary(user.id, plain.id, new Date("2026-03-01T00:00:00.000Z"));

    const parent = await prisma.curatorNote.create({
      data: {
        entityType: "track",
        entityId: noted.id,
        curatorId: user.id,
        content: "Check the mastering",
      },
    });
    await prisma.curatorNote.create({
      data: {
        entityType: "track",
        entityId: noted.id,
        curatorId: user.id,
        parentId: parent.id,
        content: "Agreed",
      },
    });
    await prisma.curatorNote.create({
      data: {
        entityType: "artist",
        entityId: noted.artistId,
        curatorId: user.id,
        content: "Not a track note",
      },
    });

    const countsByTitle = (
      userTracks: Awaited<ReturnType<typeof listLibraryUserTracks>>["userTracks"],
    ) =>
      Object.fromEntries(userTracks.map((row) => [row.track.title, row.track.curatorNotesCount]));

    const dateAdded = await listLibraryUserTracks({
      userId: user.id,
      sort: "dateAdded",
      limit: 10,
    });
    expect(countsByTitle(dateAdded.userTracks)).toEqual({ Noted: 2, Plain: 0 });

    const mostPlayed = await listLibraryUserTracks({
      userId: user.id,
      sort: "mostPlayedEver",
      limit: 10,
    });
    expect(countsByTitle(mostPlayed.userTracks)).toEqual({ Noted: 2, Plain: 0 });
  });
});

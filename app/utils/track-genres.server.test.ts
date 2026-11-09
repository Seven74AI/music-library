import { afterEach, describe, expect, test, vi } from "vitest";
import { Prisma } from "#prisma/client.js";
import { prisma } from "#app/utils/db.server.ts";
import { normalizeGenreName } from "#app/utils/genre-migration.server.ts";
import { linkGenresToTrack } from "#tests/track-genre-test-utils.ts";
import {
  replaceTrackGenresFromStrings,
  resolveOrderedGenresFromNames,
} from "./track-genres.server.ts";

const createdTrackIds: string[] = [];
const createdArtistIds: string[] = [];

async function createTrackWithGenre(genreName: string) {
  const service = await prisma.service.upsert({
    where: { name: "track-genres-test" },
    update: {},
    create: {
      name: "track-genres-test",
      displayName: "Track Genres Test",
      baseUrl: "http://localhost",
      isActive: true,
    },
  });
  const artist = await prisma.artist.create({
    data: {
      name: `Artist ${genreName}`,
      normalizedName: `artist-${genreName}-${Math.random().toString(36).slice(2, 8)}`.toLowerCase(),
    },
  });
  createdArtistIds.push(artist.id);
  const track = await prisma.track.create({
    data: {
      title: `Track ${genreName}`,
      artistId: artist.id,
      serviceId: service.id,
      externalId: `genres-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  await linkGenresToTrack(track.id, genreName);
  createdTrackIds.push(track.id);
  return track;
}

async function trackGenreNames(trackId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ name: string }>>`
    SELECT g.name AS name
    FROM _TrackGenres tg
    INNER JOIN Genre g ON g.id = tg.A
    WHERE tg.B = ${trackId}
    ORDER BY g.name ASC
  `;
  return rows.map((row) => row.name);
}

afterEach(async () => {
  if (createdTrackIds.length) {
    await prisma.$executeRaw`DELETE FROM _TrackGenres WHERE B IN (${Prisma.join(createdTrackIds)})`;
    await prisma.track.deleteMany({ where: { id: { in: createdTrackIds } } });
    createdTrackIds.length = 0;
  }
  if (createdArtistIds.length) {
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
});

describe("resolveOrderedGenresFromNames", () => {
  test("two concurrent resolves of the same normalized name both succeed", async () => {
    const genreName = `Concurrent-${Math.random().toString(36).slice(2, 10)}`;
    const normalizedName = normalizeGenreName(genreName);
    await prisma.genre.deleteMany({ where: { normalizedName } });

    const [left, right] = await Promise.all([
      resolveOrderedGenresFromNames([genreName]),
      resolveOrderedGenresFromNames([genreName]),
    ]);

    expect(left).toEqual({ ok: true, genres: expect.any(Array) });
    expect(right).toEqual({ ok: true, genres: expect.any(Array) });
    if (!left.ok || !right.ok) throw new Error("expected success");
    expect(left.genres[0]!.id).toBe(right.genres[0]!.id);
    expect(await prisma.genre.count({ where: { normalizedName } })).toBe(1);

    await prisma.genre.delete({ where: { id: left.genres[0]!.id } });
  });
});

describe("replaceTrackGenresFromStrings", () => {
  test("two concurrent writes of the same new genre both succeed", async () => {
    const genreName = `ConcurrentLink-${Math.random().toString(36).slice(2, 10)}`;
    const normalizedName = normalizeGenreName(genreName);
    await prisma.genre.deleteMany({ where: { normalizedName } });

    const trackA = await createTrackWithGenre("Placeholder-A");
    const trackB = await createTrackWithGenre("Placeholder-B");

    await Promise.all([
      replaceTrackGenresFromStrings(prisma, trackA.id, [genreName]),
      replaceTrackGenresFromStrings(prisma, trackB.id, [genreName]),
    ]);

    const namesA = await trackGenreNames(trackA.id);
    const namesB = await trackGenreNames(trackB.id);
    expect(namesA).toHaveLength(1);
    expect(namesB).toHaveLength(1);
    expect(namesA[0]).toBe(namesB[0]);
    expect(normalizeGenreName(namesA[0]!)).toBe(normalizedName);
    expect(await prisma.genre.count({ where: { normalizedName } })).toBe(1);

    await prisma.genre.deleteMany({ where: { normalizedName } });
  });

  test("keeps prior genres when the insert step fails mid-write", async () => {
    const track = await createTrackWithGenre("Jazz");
    expect(await trackGenreNames(track.id)).toEqual(["Jazz"]);

    const originalTransaction = prisma.$transaction.bind(prisma);
    const transactionSpy = vi.spyOn(prisma, "$transaction").mockImplementation((fn) =>
      originalTransaction(async (tx) => {
        const wrappedTx = {
          genre: tx.genre,
          $executeRaw: (async (strings: TemplateStringsArray, ...values: unknown[]) => {
            if (String(strings[0] ?? "").includes("INSERT INTO _TrackGenres")) {
              throw new Error("simulated insert failure");
            }
            return tx.$executeRaw(strings, ...values);
          }) as typeof tx.$executeRaw,
        };
        if (typeof fn === "function") {
          return (fn as (tx: typeof wrappedTx) => Promise<unknown>)(wrappedTx);
        }
        throw new Error("unexpected transaction batch");
      }),
    );

    await expect(
      replaceTrackGenresFromStrings(prisma, track.id, ["Rock", "Blues"]),
    ).rejects.toThrow();

    expect(await trackGenreNames(track.id)).toEqual(["Jazz"]);
    transactionSpy.mockRestore();
  });
});

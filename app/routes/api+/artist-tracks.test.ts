import { beforeEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { loader } from "./artist-tracks.tsx";

async function ensureLocalService() {
  return prisma.service.upsert({
    where: { name: "local" },
    update: {},
    create: { name: "local", displayName: "Local Upload", baseUrl: "", isActive: true },
  });
}

async function createArtist(name: string) {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.artist.create({
    data: {
      name: `${name} ${suffix}`,
      normalizedName: `${name.toLowerCase()} ${suffix}`,
    },
  });
}

async function createTrack({
  artistId,
  title,
  createdAt,
}: {
  artistId: string;
  title: string;
  createdAt?: Date;
}) {
  const service = await ensureLocalService();
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return prisma.track.create({
    data: {
      title,
      externalId: `ext-${suffix}`,
      artistId,
      serviceId: service.id,
      ...(createdAt ? { createdAt } : {}),
    },
  });
}

function apiRequest(url: string) {
  const request = new Request(url);
  return { request, url: new URL(request.url), params: {}, context: {} };
}

type Page = {
  tracks: Array<{ id: string; title: string; isInUserLibrary: boolean }>;
  pagination: { limit: number; hasNext: boolean; nextCursor: string | null };
};

const T0 = new Date("2026-09-01T10:00:00.000Z");

function at(seconds: number) {
  return new Date(T0.getTime() + seconds * 1000);
}

describe("artist-tracks API loader", () => {
  beforeEach(async () => {
    await prisma.trackAudioFile.deleteMany();
    await prisma.userTrack.deleteMany();
    await prisma.track.deleteMany();
    await prisma.album.deleteMany();
    await prisma.artist.deleteMany();
  });

  test("returns 400 when artistId is missing", async () => {
    const response = await loader(apiRequest("http://localhost/api/artist-tracks") as never);

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Artist ID is required");
  });

  test("returns 400 for an invalid limit", async () => {
    const response = await loader(
      apiRequest("http://localhost/api/artist-tracks?artistId=a&limit=invalid") as never,
    );

    expect(response.status).toBe(400);
  });

  test("cursor-paginates tracks createdAt desc without overlap or gaps", async () => {
    const artist = await createArtist("Pagination Artist");
    for (let i = 0; i < 5; i++) {
      await createTrack({ artistId: artist.id, title: `Track ${i}`, createdAt: at(i) });
    }

    const page1 = (await (
      await loader(
        apiRequest(`http://localhost/api/artist-tracks?artistId=${artist.id}&limit=2`) as never,
      )
    ).json()) as Page;
    expect(page1.tracks.map((t) => t.title)).toEqual(["Track 4", "Track 3"]);
    expect(page1.pagination.hasNext).toBe(true);
    expect(page1.pagination.nextCursor).not.toBeNull();

    const page2 = (await (
      await loader(
        apiRequest(
          `http://localhost/api/artist-tracks?artistId=${artist.id}&limit=2&cursor=${page1.pagination.nextCursor}`,
        ) as never,
      )
    ).json()) as Page;
    expect(page2.tracks.map((t) => t.title)).toEqual(["Track 2", "Track 1"]);
    expect(page2.pagination.hasNext).toBe(true);

    const page3 = (await (
      await loader(
        apiRequest(
          `http://localhost/api/artist-tracks?artistId=${artist.id}&limit=2&cursor=${page2.pagination.nextCursor}`,
        ) as never,
      )
    ).json()) as Page;
    expect(page3.tracks.map((t) => t.title)).toEqual(["Track 0"]);
    expect(page3.pagination.hasNext).toBe(false);
    expect(page3.pagination.nextCursor).toBeNull();

    const allIds = [...page1.tracks, ...page2.tracks, ...page3.tracks].map((t) => t.id);
    expect(new Set(allIds).size).toBe(5);
  });

  test("returns the track shape and guest library status", async () => {
    const artist = await createArtist("Shape Artist");
    const track = await createTrack({ artistId: artist.id, title: "Shape Track" });

    const response = await loader(
      apiRequest(`http://localhost/api/artist-tracks?artistId=${artist.id}`) as never,
    );
    const body = (await response.json()) as Page & {
      tracks: Array<{
        id: string;
        title: string;
        isInUserLibrary: boolean;
        userTrackCreatedAt: string;
      }>;
    };

    expect(body.tracks).toHaveLength(1);
    const first = body.tracks[0]!;
    expect(first.id).toBe(track.id);
    expect(first.title).toBe("Shape Track");
    expect(first.isInUserLibrary).toBe(false);
    expect(typeof first.userTrackCreatedAt).toBe("string");
    expect(body.pagination).toEqual({ limit: 50, hasNext: false, nextCursor: null });
  });
});

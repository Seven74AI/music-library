import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { loader } from "./albums.$albumId.tsx";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

describe("album page merge redirect", () => {
  const createdArtistIds: string[] = [];
  const createdAlbumIds: string[] = [];

  afterEach(async () => {
    if (createdAlbumIds.length > 0) {
      await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
      createdAlbumIds.length = 0;
    }
    if (createdArtistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
      createdArtistIds.length = 0;
    }
  });

  async function load(albumId: string) {
    try {
      return await loader({
        request: new Request(`http://localhost/albums/${albumId}`),
        params: { albumId },
        context: {},
      } as never);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
  }

  test("redirects a merged source to the canonical album", async () => {
    const mark = stamp();
    const artist = await prisma.artist.create({
      data: { name: `Artist ${mark}`, normalizedName: `artist ${mark}` },
    });
    const target = await prisma.album.create({
      data: { name: `Canonical ${mark}`, artistId: artist.id },
    });
    const source = await prisma.album.create({
      data: {
        name: `Alias ${mark}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdArtistIds.push(artist.id);
    createdAlbumIds.push(source.id, target.id);

    const response = await load(source.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe(`/albums/${target.id}`);
  });

  test("404s when the merge chain cycles", async () => {
    const mark = stamp();
    const artist = await prisma.artist.create({
      data: { name: `Artist ${mark}`, normalizedName: `artist ${mark}` },
    });
    const left = await prisma.album.create({
      data: { name: `Cycle Left ${mark}`, artistId: artist.id },
    });
    const right = await prisma.album.create({
      data: { name: `Cycle Right ${mark}`, artistId: artist.id },
    });
    createdArtistIds.push(artist.id);
    createdAlbumIds.push(left.id, right.id);
    await prisma.album.update({ where: { id: left.id }, data: { mergedIntoId: right.id } });
    await prisma.album.update({ where: { id: right.id }, data: { mergedIntoId: left.id } });

    const response = await load(left.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
  });
});

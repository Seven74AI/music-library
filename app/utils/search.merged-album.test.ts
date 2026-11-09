import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { searchAlbums, searchAll } from "#app/utils/search.server.ts";

function stamp() {
  return `qadupalb${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function albumResultIds(results: Array<{ type: string; id: string }>) {
  return results.filter((result) => result.type === "album").map((result) => result.id);
}

describe("catalog album search hides merged albums", () => {
  const artistIds: string[] = [];
  const albumIds: string[] = [];

  afterEach(async () => {
    if (albumIds.length > 0) {
      await prisma.album.deleteMany({ where: { id: { in: albumIds } } });
      albumIds.length = 0;
    }
    if (artistIds.length > 0) {
      await prisma.artist.deleteMany({ where: { id: { in: artistIds } } });
      artistIds.length = 0;
    }
  });

  test("does not return an album that has been merged into another album", async () => {
    const mark = stamp();
    const artist = await prisma.artist.create({
      data: { name: `Artist ${mark}`, normalizedName: `artist ${mark}` },
    });
    const target = await prisma.album.create({
      data: { name: `Canon ${mark}`, artistId: artist.id },
    });
    const source = await prisma.album.create({
      data: {
        name: `Alias ${mark}`,
        artistId: artist.id,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    artistIds.push(artist.id);
    albumIds.push(source.id, target.id);

    const albumsTab = await searchAll(mark, 20, undefined, "albums");
    const headerSearch = await searchAll(mark, 20, undefined, "all");
    const direct = await searchAlbums(mark, 20);

    expect(albumResultIds(albumsTab.results)).not.toContain(source.id);
    expect(albumResultIds(albumsTab.results)).toContain(target.id);
    expect(albumResultIds(headerSearch.results)).not.toContain(source.id);
    expect(albumResultIds(headerSearch.results)).toContain(target.id);
    expect(albumResultIds(direct.results)).not.toContain(source.id);
  });
});

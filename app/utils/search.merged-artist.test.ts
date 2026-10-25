import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { searchAll, searchArtists } from "#app/utils/search.server.ts";

function stamp() {
  return `qadup${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function artistIds(results: Array<{ type: string; id: string }>) {
  return results.filter((result) => result.type === "artist").map((result) => result.id);
}

describe("catalog artist search hides merged artists", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.artist.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  test("does not return an artist that has been merged into another artist", async () => {
    const mark = stamp();
    const target = await prisma.artist.create({
      data: { name: `Canon ${mark}`, normalizedName: `canon ${mark}` },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Alias ${mark}`,
        normalizedName: `alias ${mark}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const artistsTab = await searchAll(mark, 20, undefined, "artists");
    const headerSearch = await searchAll(mark, 20, undefined, "all");
    const direct = await searchArtists(mark, 20);

    expect(artistIds(artistsTab.results)).not.toContain(source.id);
    expect(artistIds(artistsTab.results)).toContain(target.id);
    expect(artistIds(headerSearch.results)).not.toContain(source.id);
    expect(artistIds(headerSearch.results)).toContain(target.id);
    expect(artistIds(direct.results)).not.toContain(source.id);

    const stillThere = await prisma.artist.findUnique({ where: { id: source.id } });
    expect(stillThere?.mergedIntoId).toBe(target.id);
  });
});

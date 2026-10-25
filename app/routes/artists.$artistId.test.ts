import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { loader } from "./artists.$artistId.tsx";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

describe("artist page merge redirect", () => {
  const createdIds: string[] = [];

  afterEach(async () => {
    if (createdIds.length === 0) return;
    await prisma.artist.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  });

  async function load(artistId: string) {
    try {
      return await loader({
        request: new Request(`http://localhost/artists/${artistId}`),
        params: { artistId },
        context: {},
      } as never);
    } catch (error) {
      if (error instanceof Response) return error;
      throw error;
    }
  }

  test("redirects a merged source to the canonical artist", async () => {
    const mark = stamp();
    const target = await prisma.artist.create({
      data: { name: `QA Dupnamf ${mark}`, normalizedName: `qa dupnamf ${mark}` },
    });
    const source = await prisma.artist.create({
      data: {
        name: `QA Dupname ${mark}`,
        normalizedName: `qa dupname ${mark}`,
        mergedIntoId: target.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, target.id);

    const response = await load(source.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(302);
    expect((response as Response).headers.get("Location")).toBe(`/artists/${target.id}`);

    const stillThere = await prisma.artist.findUnique({ where: { id: source.id } });
    expect(stillThere?.mergedIntoId).toBe(target.id);
  });

  test("follows a merge chain to the living artist", async () => {
    const mark = stamp();
    const canonical = await prisma.artist.create({
      data: { name: `Canonical ${mark}`, normalizedName: `canonical ${mark}` },
    });
    const mid = await prisma.artist.create({
      data: {
        name: `Mid ${mark}`,
        normalizedName: `mid ${mark}`,
        mergedIntoId: canonical.id,
        mergedAt: new Date(),
      },
    });
    const source = await prisma.artist.create({
      data: {
        name: `Source ${mark}`,
        normalizedName: `source ${mark}`,
        mergedIntoId: mid.id,
        mergedAt: new Date(),
      },
    });
    createdIds.push(source.id, mid.id, canonical.id);

    const response = await load(source.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe(`/artists/${canonical.id}`);

    const living = await load(canonical.id);
    expect(living).not.toBeInstanceOf(Response);
    expect(
      (living as { data: { artist: { id: string; name: string } } }).data.artist,
    ).toMatchObject({ id: canonical.id, name: `Canonical ${mark}` });
  });

  test("404s when the merge chain cycles", async () => {
    const mark = stamp();
    const left = await prisma.artist.create({
      data: { name: `Cycle Left ${mark}`, normalizedName: `cycle left ${mark}` },
    });
    const right = await prisma.artist.create({
      data: { name: `Cycle Right ${mark}`, normalizedName: `cycle right ${mark}` },
    });
    createdIds.push(left.id, right.id);
    await prisma.artist.update({ where: { id: left.id }, data: { mergedIntoId: right.id } });
    await prisma.artist.update({ where: { id: right.id }, data: { mergedIntoId: left.id } });

    const response = await load(left.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
  });

  test("404s when the merge target is missing", async () => {
    const mark = stamp();
    const source = await prisma.artist.create({
      data: { name: `Dangling ${mark}`, normalizedName: `dangling ${mark}` },
    });
    createdIds.push(source.id);
    await prisma.$executeRawUnsafe("PRAGMA foreign_keys = OFF");
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Artist" SET "mergedIntoId" = ? WHERE id = ?`,
        "missing-merge-target",
        source.id,
      );
    } finally {
      await prisma.$executeRawUnsafe("PRAGMA foreign_keys = ON");
    }

    const response = await load(source.id);

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(404);
  });
});

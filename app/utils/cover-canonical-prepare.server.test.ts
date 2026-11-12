import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterEach, describe, expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  calculateImageHash,
  findOrCreateCoverImage,
  prepareCoverImageUpload,
} from "#app/utils/cover-management.server.ts";

const createdCoverIds: string[] = [];
const createdAlbumIds: string[] = [];
const createdArtistIds: string[] = [];

async function canonicalBytes(image: Buffer): Promise<Buffer> {
  return sharp(image)
    .resize(1000, 1000, { fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
}

afterEach(async () => {
  if (createdAlbumIds.length > 0) {
    await prisma.album.deleteMany({ where: { id: { in: createdAlbumIds } } });
    createdAlbumIds.length = 0;
  }
  if (createdCoverIds.length > 0) {
    await prisma.coverImage.deleteMany({ where: { id: { in: createdCoverIds } } });
    createdCoverIds.length = 0;
  }
  if (createdArtistIds.length > 0) {
    await prisma.artist.deleteMany({ where: { id: { in: createdArtistIds } } });
    createdArtistIds.length = 0;
  }
});

describe("canonical cover preparation", () => {
  test("contentHash and dimensions come from the re-encoded master, not raw bytes", async () => {
    const raw = await sharp({
      create: {
        width: 720,
        height: 720,
        channels: 3,
        background: { r: 40, g: 120, b: 200 },
      },
    })
      .png()
      .toBuffer();

    const reencoded = await canonicalBytes(raw);
    const expectedHash = createHash("sha256").update(reencoded).digest("hex");
    const rawHash = createHash("sha256").update(raw).digest("hex");

    const prepared = await prepareCoverImageUpload({ imageBuffer: raw });
    expect(prepared.kind).toBe("new");
    if (prepared.kind !== "new") return;

    expect(prepared.contentHash).toBe(expectedHash);
    expect(prepared.contentHash).not.toBe(rawHash);
    expect(prepared.width).toBeLessThanOrEqual(1000);
    expect(prepared.height).toBeLessThanOrEqual(1000);
    const reencodedMeta = await sharp(reencoded).metadata();
    expect(prepared.width).toBe(reencodedMeta.width ?? null);
    expect(prepared.height).toBe(reencodedMeta.height ?? null);
  });

  test("findOrCreateCoverImage without albumId stores a new cover when the album already has one", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const artist = await prisma.artist.create({
      data: { name: `Canon Artist ${suffix}`, normalizedName: `canon artist ${suffix}` },
    });
    createdArtistIds.push(artist.id);

    const existingBytes = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: 10, g: 10, b: 10 },
      },
    })
      .jpeg()
      .toBuffer();
    const existingHash = await calculateImageHash(await canonicalBytes(existingBytes));

    const existingCover = await prisma.coverImage.create({
      data: {
        contentHash: existingHash,
        objectKey: `covers/existing-${suffix}.jpg`,
        width: 600,
        height: 600,
        format: "jpeg",
      },
    });
    createdCoverIds.push(existingCover.id);

    const album = await prisma.album.create({
      data: {
        name: `Covered Album ${suffix}`,
        artistId: artist.id,
        coverImageId: existingCover.id,
      },
    });
    createdAlbumIds.push(album.id);

    const newBytes = await sharp({
      create: {
        width: 600,
        height: 600,
        channels: 3,
        background: { r: 200, g: 50, b: 80 },
      },
    })
      .jpeg()
      .toBuffer();

    const created = await findOrCreateCoverImage({ imageBuffer: newBytes });
    createdCoverIds.push(created.id);

    expect(created.id).not.toBe(existingCover.id);

    const row = await prisma.coverImage.findUniqueOrThrow({
      where: { id: created.id },
      select: { contentHash: true, width: true, height: true },
    });
    const expectedHash = createHash("sha256")
      .update(await canonicalBytes(newBytes))
      .digest("hex");
    expect(row.contentHash).toBe(expectedHash);
    expect(row.width).toBeLessThanOrEqual(1000);
    expect(row.height).toBeLessThanOrEqual(1000);
  });
});

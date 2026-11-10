import { prisma } from "#app/utils/db.server";
import { type Prisma } from "#prisma/client.js";
import { followMergedIntoIdChain } from "./canonical-merged-entity.server.ts";
import { coerceOptionalInt } from "#app/utils/track-metadata-int.server.ts";

type AlbumLookup = {
  id: string;
  mergedIntoId: string | null;
};

type AlbumClient = {
  album: {
    findFirst: (args: {
      where: { artistId: string; name: string; mergedIntoId?: null };
      select: { id: true; mergedIntoId: true };
      orderBy?: { createdAt: "asc" };
    }) => Promise<AlbumLookup | null>;
    findUnique: (args: {
      where: { id: string };
      select: { id: true; mergedIntoId: true };
    }) => Promise<AlbumLookup | null>;
    create: (args: {
      data: { name: string; artistId: string; year?: number };
      select: { id: true; mergedIntoId: true };
    }) => Promise<AlbumLookup>;
  };
};

async function resolveCanonicalAlbum(db: AlbumClient, album: AlbumLookup): Promise<{ id: string }> {
  const living = await followMergedIntoIdChain(album, (mergedIntoId) =>
    db.album.findUnique({
      where: { id: mergedIntoId },
      select: { id: true, mergedIntoId: true },
    }),
  );
  return { id: living.id };
}

/**
 * Shared get-or-create core, parameterized by client (global `prisma` or a
 * transaction client).
 */
async function getOrCreateAlbumCore(
  client: AlbumClient,
  artistId: string,
  albumName: string | null | undefined,
  year?: number | null,
): Promise<{ id: string } | null> {
  if (!albumName) {
    return null;
  }

  const albumYear = year === undefined || year === null ? year : (coerceOptionalInt(year) ?? null);

  let album = await client.album.findFirst({
    where: {
      artistId,
      name: albumName,
      mergedIntoId: null,
    },
    select: {
      id: true,
      mergedIntoId: true,
    },
  });

  if (!album) {
    album = await client.album.findFirst({
      where: {
        artistId,
        name: albumName,
      },
      select: {
        id: true,
        mergedIntoId: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  if (!album) {
    album = await client.album.create({
      data: {
        name: albumName,
        artistId,
        ...(albumYear != null && { year: albumYear }),
      },
      select: {
        id: true,
        mergedIntoId: true,
      },
    });
  }

  return resolveCanonicalAlbum(client, album);
}

/**
 * Get or create an Album record
 * Uses (artistId, name) as unique identifier
 */
export async function getOrCreateAlbum(
  artistId: string,
  albumName: string | null | undefined,
  year?: number | null,
): Promise<{ id: string } | null> {
  return getOrCreateAlbumCore(prisma, artistId, albumName, year);
}

/**
 * Transaction-aware version of getOrCreateAlbum
 */
export async function getOrCreateAlbumTx(
  tx: Prisma.TransactionClient,
  artistId: string,
  albumName: string | null | undefined,
  year?: number | null,
): Promise<{ id: string } | null> {
  return getOrCreateAlbumCore(tx, artistId, albumName, year);
}

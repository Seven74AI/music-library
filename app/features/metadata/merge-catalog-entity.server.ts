/**
 * Shared curator merge transaction for albums and artists.
 */

import { type Prisma } from "#prisma/client.js";
import { assertEditLockInTransaction, type LockInfo } from "#app/utils/locks.server.ts";

export type CatalogMergeEntityType = "album" | "artist";

export type AlbumMergeAuditSnapshot = {
  name: string;
  artistId: string;
  year: number | null;
  coverImageId: string | null;
};

export type ArtistMergeAuditSnapshot = {
  name: string;
  bio: string | null;
  imageUrl: string | null;
  website: string | null;
  genre: string | null;
  country: string | null;
};

export type ExecuteCatalogMergeParams =
  | {
      entityType: "album";
      sourceId: string;
      targetId: string;
      comment: string;
      userId: string;
      sourceLock: LockInfo | null;
      targetLock: LockInfo | null;
      auditSnapshot: AlbumMergeAuditSnapshot;
    }
  | {
      entityType: "artist";
      sourceId: string;
      targetId: string;
      comment: string;
      userId: string;
      sourceLock: LockInfo | null;
      targetLock: LockInfo | null;
      auditSnapshot: ArtistMergeAuditSnapshot;
    };

export type CatalogMergeTransactionResult = {
  tracksUpdated: number;
  albumsUpdated?: number;
};

export async function executeCatalogEntityMerge(
  tx: Prisma.TransactionClient,
  params: ExecuteCatalogMergeParams,
): Promise<CatalogMergeTransactionResult> {
  const { entityType, sourceId, targetId, comment, userId, sourceLock, targetLock } = params;

  await assertEditLockInTransaction(tx, entityType, sourceId, userId, sourceLock);
  await assertEditLockInTransaction(tx, entityType, targetId, userId, targetLock);

  if (entityType === "album") {
    await tx.albumEdit.create({
      data: {
        albumId: sourceId,
        editedBy: userId,
        comment: `MERGE: ${comment}`,
        name: params.auditSnapshot.name,
        artistId: params.auditSnapshot.artistId,
        year: params.auditSnapshot.year,
        coverImageId: params.auditSnapshot.coverImageId,
      },
    });

    const tracksUpdated = await tx.track.updateMany({
      where: { albumId: sourceId },
      data: { albumId: targetId },
    });

    await tx.album.update({
      where: { id: sourceId },
      data: {
        mergedIntoId: targetId,
        mergedAt: new Date(),
        mergedBy: userId,
      },
    });

    await tx.duplicateDetection.updateMany({
      where: {
        entityType: "album",
        OR: [
          { entityId1: sourceId, entityId2: targetId },
          { entityId1: targetId, entityId2: sourceId },
        ],
      },
      data: { status: "merged" },
    });

    return { tracksUpdated: tracksUpdated.count };
  }

  await tx.artistEdit.create({
    data: {
      artistId: sourceId,
      editedBy: userId,
      comment: `MERGE: ${comment}`,
      name: params.auditSnapshot.name,
      bio: params.auditSnapshot.bio,
      imageUrl: params.auditSnapshot.imageUrl,
      website: params.auditSnapshot.website,
      genre: params.auditSnapshot.genre,
      country: params.auditSnapshot.country,
    },
  });

  const tracksUpdated = await tx.track.updateMany({
    where: { artistId: sourceId },
    data: { artistId: targetId },
  });

  const albumsUpdated = await tx.album.updateMany({
    where: { artistId: sourceId },
    data: { artistId: targetId },
  });

  await tx.artist.update({
    where: { id: sourceId },
    data: {
      mergedIntoId: targetId,
      mergedAt: new Date(),
      mergedBy: userId,
    },
  });

  await tx.duplicateDetection.updateMany({
    where: {
      entityType: "artist",
      OR: [
        { entityId1: sourceId, entityId2: targetId },
        { entityId1: targetId, entityId2: sourceId },
      ],
    },
    data: { status: "merged" },
  });

  return {
    tracksUpdated: tracksUpdated.count,
    albumsUpdated: albumsUpdated.count,
  };
}

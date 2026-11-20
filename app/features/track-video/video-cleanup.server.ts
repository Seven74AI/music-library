import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";

/**
 * Delete S3 objects no longer referenced by any TrackVideoFile row.
 * Parallel to `deleteUnreferencedObjectKeys` (audio), but counts video rows.
 * Call after the DB change that drops the reference.
 */
export async function deleteUnreferencedVideoObjectKeys(
  objectKeys: string[],
  deleteObject: (key: string) => Promise<void> = deleteFile,
): Promise<void> {
  const uniqueKeys = [...new Set(objectKeys)];
  if (uniqueKeys.length === 0) return;

  const referenced = await prisma.trackVideoFile.findMany({
    where: { objectKey: { in: uniqueKeys } },
    select: { objectKey: true },
    distinct: ["objectKey"],
  });
  const referencedKeys = new Set(referenced.map((row) => row.objectKey));

  for (const objectKey of uniqueKeys) {
    if (referencedKeys.has(objectKey)) continue;
    try {
      await deleteObject(objectKey);
    } catch (error) {
      console.error(`Failed to delete video object ${objectKey}:`, error);
    }
  }
}

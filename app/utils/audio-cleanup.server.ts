import { type PreparedTrackAudio } from "#app/features/track-audio-ingest/persist-track-audio.server.ts";
import { type PreparedCoverImage } from "#app/utils/cover-management.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";

/**
 * Delete S3 objects that are no longer referenced by any TrackAudioFile rows.
 *
 * The reference check runs as a single batched query over all keys (one round
 * trip instead of one `count` + one `delete` per key). Call this *after*
 * cascade-deleting tracks or TrackAudioFile rows so the refcount reflects the
 * post-delete state.
 *
 * @param objectKeys - S3 object keys to consider for deletion
 */
export type CleanupFailedUploadOptions = {
  /** When true, the DB transaction that references these artifacts committed successfully. */
  transactionCommitted?: boolean;
};

/** Delete Tigris objects uploaded before a failed DB commit (idempotent best-effort). */
export async function cleanupFailedUploadArtifacts(
  preparedAudio: PreparedTrackAudio | null,
  preparedCover: PreparedCoverImage | null,
  options?: CleanupFailedUploadOptions,
): Promise<void> {
  const audioKeys: string[] = [];
  if (preparedAudio && !preparedAudio.isDuplicate && !options?.transactionCommitted) {
    audioKeys.push(preparedAudio.objectKey);
  }
  if (audioKeys.length > 0) {
    await deleteUnreferencedObjectKeys(audioKeys);
  }

  if (preparedCover?.kind === "new" && !options?.transactionCommitted) {
    const coverPersisted = await prisma.coverImage.findFirst({
      where: { objectKey: preparedCover.objectKey },
      select: { id: true },
    });
    if (coverPersisted) return;

    try {
      await deleteFile(preparedCover.objectKey);
    } catch (error) {
      console.error(`Failed to delete cover object ${preparedCover.objectKey}:`, error);
    }
  }
}

export async function deleteUnreferencedObjectKeys(objectKeys: string[]): Promise<void> {
  const uniqueKeys = [...new Set(objectKeys)];
  if (uniqueKeys.length === 0) return;

  // One query resolves which keys are still referenced.
  const referenced = await prisma.trackAudioFile.findMany({
    where: { objectKey: { in: uniqueKeys } },
    select: { objectKey: true },
    distinct: ["objectKey"],
  });
  const referencedKeys = new Set(referenced.map((row) => row.objectKey));

  for (const objectKey of uniqueKeys) {
    if (referencedKeys.has(objectKey)) continue;
    try {
      await deleteFile(objectKey);
    } catch (error) {
      console.error(`Failed to delete file ${objectKey}:`, error);
    }
  }
}

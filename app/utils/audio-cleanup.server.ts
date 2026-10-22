import { prisma } from "#app/utils/db.server.ts";
import { deleteFile } from "#app/utils/storage.server.ts";

/**
 * Delete S3 objects that are no longer referenced by any TrackAudioFile rows.
 *
 * This helper defends against a race with persistTrackAudio: if an upload
 * reuses the same content-hash objectKey after we mark a track for deletion
 * but before we clean up storage, the new track's audio must not be deleted.
 *
 * Call this *after* cascade-deleting tracks or TrackAudioFile rows so the
 * final refcount reflects the post-delete state.
 *
 * @param objectKeys - S3 object keys to consider for deletion
 */
export async function deleteUnreferencedObjectKeys(objectKeys: string[]): Promise<void> {
  for (const objectKey of [...new Set(objectKeys)]) {
    const stillReferenced = await prisma.trackAudioFile.count({
      where: { objectKey },
    });
    if (stillReferenced > 0) {
      continue;
    }
    try {
      await deleteFile(objectKey);
    } catch (error) {
      console.error(`Failed to delete file ${objectKey}:`, error);
    }
  }
}

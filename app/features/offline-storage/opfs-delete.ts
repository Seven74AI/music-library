function isNotFoundError(error: unknown): error is DOMException {
  return error instanceof DOMException && error.name === "NotFoundError";
}

/**
 * Idempotently deletes an offline audio track from the OPFS "audio" directory.
 *
 * Treats a missing directory or file as success so a ghost OPFS entry (already
 * evicted by the browser) does not reject the worker's delete and abort the
 * purge/eviction loop — decision #57 (prune stale metadata). Mirrors `hasTrack`,
 * which already treats a missing file as absent.
 */
export async function deleteOfflineAudioEntry(
  root: FileSystemDirectoryHandle,
  trackId: string,
): Promise<void> {
  let audioDir: FileSystemDirectoryHandle;
  try {
    audioDir = await root.getDirectoryHandle("audio", { create: false });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }

  try {
    await audioDir.removeEntry(`${trackId}.mp3`);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
}

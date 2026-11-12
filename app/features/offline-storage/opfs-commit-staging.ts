import { offlineAudioOpfsPath } from "./offline-audio-path.ts";

/** Leaf file name inside the OPFS `audio/` directory, format-aware. */
export function opfsAudioLeafName(trackId: string, format: string | null | undefined): string {
  const path = offlineAudioOpfsPath(trackId, format);
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Atomically promote a fully-written staging blob to the live track file.
 * Uses OPFS move so the live file is not truncated until the staging blob is committed.
 */
export async function commitStagingOpfsFile(
  stagingTrackId: string,
  trackId: string,
  format: string | null | undefined,
) {
  const root = await navigator.storage.getDirectory();
  const audioDir = await root.getDirectoryHandle("audio", { create: true });
  const stagingName = opfsAudioLeafName(stagingTrackId, format);
  const finalName = opfsAudioLeafName(trackId, format);

  const stagingHandle = await audioDir.getFileHandle(stagingName);
  const movable = stagingHandle as FileSystemFileHandle & {
    move: (destination: string) => Promise<void>;
  };
  await movable.move(finalName);
}

/** A karaoke version can be played (overlay + video) only when it is `ready` and has a video. */
export function hasReadyKaraokeVersion(
  version: { status: string; videoFileId: string | null } | null | undefined,
): boolean {
  return version?.status === "ready" && Boolean(version.videoFileId);
}

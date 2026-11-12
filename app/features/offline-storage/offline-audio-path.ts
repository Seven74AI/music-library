export function offlineAudioOpfsPath(
  trackId: string,
  format: string | null | undefined = "mp3",
): string {
  return `audio/${trackId}.${format ?? "mp3"}`;
}

export function offlineAudioStagingTrackId(trackId: string): string {
  return `${trackId}.__staging__`;
}

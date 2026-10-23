export function offlineAudioOpfsPath(
  trackId: string,
  format: string | null | undefined = "mp3",
): string {
  return `audio/${trackId}.${format ?? "mp3"}`;
}

export function offlineAudioOpfsPath(
  trackId: string,
  format: string | null | undefined = "mp3",
): string {
  return `audio/${trackId}.${format ?? "mp3"}`;
}

export function offlineAudioStagingTrackId(trackId: string): string {
  // Unique per call so concurrent downloads of the same track never share a staging file.
  const nonce = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
  return `${trackId}.__staging__.${nonce}`;
}

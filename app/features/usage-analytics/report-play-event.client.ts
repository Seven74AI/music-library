/**
 * Fire-and-forget usage play events from the audio player.
 * Failures must never interrupt playback.
 */
export type PlayEventType = "play_started" | "play_completed";

export function reportPlayEvent(
  type: PlayEventType,
  trackId: string,
  playId?: string | null,
): void {
  if (typeof window === "undefined" || !trackId) return;

  const body = new FormData();
  body.set("type", type);
  body.set("trackId", trackId);
  if (playId) {
    body.set("playId", playId);
  }

  void fetch("/resources/play-event", {
    method: "POST",
    body,
    credentials: "same-origin",
  }).catch(() => {
    // Ignore network errors — analytics must not break playback
  });
}

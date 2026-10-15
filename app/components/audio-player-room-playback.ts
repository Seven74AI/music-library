export type RoomAutoplayOutcome = "started" | "blocked";

/**
 * The only copy for a blocked room autoplay. The room Play button stays Play
 * until audio actually starts, so this line is the one explanation.
 */
export const ROOM_AUTOPLAY_BLOCKED_EXPLANATION = "Autoplay was blocked. Press Play to start.";

/**
 * Room transport can say "playing" before the browser allows audio.
 * Until play() starts, the room stays paused and playback is not reported.
 */
export function roomStateAfterAutoplay(outcome: RoomAutoplayOutcome): {
  isPlaying: boolean;
  reportPlaying: boolean;
  explanation: string | null;
} {
  if (outcome === "started") {
    return { isPlaying: true, reportPlaying: true, explanation: null };
  }
  return {
    isPlaying: false,
    reportPlaying: false,
    explanation: ROOM_AUTOPLAY_BLOCKED_EXPLANATION,
  };
}

/**
 * Headless and strict browsers reject play(), or return no promise (jsdom).
 * Neither case has started audio.
 */
export function outcomeFromPlayCall(
  playResult: Promise<void> | void | undefined,
): Promise<RoomAutoplayOutcome> {
  if (playResult == null || typeof (playResult as Promise<void>).then !== "function") {
    return Promise.resolve("blocked");
  }
  return playResult.then(
    () => "started" as const,
    () => "blocked" as const,
  );
}

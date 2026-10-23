import { NON_SPEAKER_AWAY_MS, SPEAKER_SILENCE_GRACE_MS } from "./constants.ts";

/** Grace before a seated participant is Away. Speaker gets the longer silence window. */
export function presenceGraceMs(isSpeaker: boolean): number {
  return isSpeaker ? SPEAKER_SILENCE_GRACE_MS : NON_SPEAKER_AWAY_MS;
}

/**
 * Away when lastSeenAt is older than the role grace.
 * Missing timestamps are not Away — the server always stores lastSeenAt, and
 * client fixtures without one should not all render as Away.
 */
export function isParticipantAway(
  lastSeenAt: Date | string | number | null | undefined,
  isSpeaker: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (lastSeenAt == null || lastSeenAt === "") return false;
  const seen = lastSeenAt instanceof Date ? lastSeenAt.getTime() : new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return nowMs - seen > presenceGraceMs(isSpeaker);
}

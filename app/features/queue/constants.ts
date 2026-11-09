/**
 * Maximum number of track IDs to include in a single playback batch request.
 * Used by both client hydration (fetchPlaybackBatch) and server validation (parsePlaybackIds).
 *
 * Set high enough to minimize API round-trips for large queues (2000+ tracks),
 * but low enough to avoid URL length limits (~2000 chars for most browsers).
 * At ~36 chars per UUID, 200 IDs = ~7200 chars — well within limits.
 */
export const PLAYBACK_BATCH_MAX_IDS = 200;

/** Max spine rows to skip client-side when hydration cannot play the next target. */
export const PLAYBACK_SPINE_SKIP_MAX = 32;

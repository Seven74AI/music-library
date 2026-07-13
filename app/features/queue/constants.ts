/**
 * Maximum number of track IDs to include in a single playback batch request.
 * Used by both client hydration (fetchPlaybackBatch) and server validation (parsePlaybackIds).
 */
export const PLAYBACK_BATCH_MAX_IDS = 20

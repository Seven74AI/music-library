import { type LoopMode } from "#app/features/queue/queue-navigation.ts";
import { type PlayContextJson, type PlayerStateData } from "./player-state.ts";

/**
 * localStorage mirror of the server-persisted `PlayerState`. This is NOT a
 * spine snapshot — it holds only the ephemeral state (play context, current
 * track id, Up Next ids, shuffle seed, loop mode) so an offline load can
 * restore the current track + Up Next *if those tracks are downloaded* without
 * hitting the network. The resolved track list (spine) is never cached here.
 */
const PLAYER_STATE_LOCAL_KEY = "music-library:player-state";

const LOOP_MODES: readonly LoopMode[] = ["off", "all", "one"];

function isPlayContextJson(value: unknown): value is PlayContextJson {
  if (value === null || typeof value !== "object") return false;
  const context = value as Record<string, unknown>;

  switch (context.type) {
    case "library":
      return true;
    case "playlist":
      return typeof context.playlistId === "string" && context.playlistId.length > 0;
    case "artist":
      return typeof context.artistId === "string" && context.artistId.length > 0;
    case "album":
      return typeof context.albumId === "string" && context.albumId.length > 0;
    case "track":
      return typeof context.trackId === "string" && context.trackId.length > 0;
    default:
      return false;
  }
}

function isPlayerStateData(value: unknown): value is PlayerStateData {
  if (value === null || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;

  if (state.playContext !== null && !isPlayContextJson(state.playContext)) return false;
  if (state.currentTrackId !== null && typeof state.currentTrackId !== "string") return false;
  if (!Array.isArray(state.upNextIds) || !state.upNextIds.every((id) => typeof id === "string")) {
    return false;
  }
  if (state.shuffleSeed !== null && typeof state.shuffleSeed !== "number") return false;
  if (typeof state.loopMode !== "string" || !LOOP_MODES.includes(state.loopMode as LoopMode)) {
    return false;
  }

  return true;
}

/** Read the locally mirrored player state, or `null` when absent or corrupt. */
export function readCachedPlayerState(): PlayerStateData | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(PLAYER_STATE_LOCAL_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlayerStateData(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Mirror the player state locally for offline restore. Best-effort: a failed
 * write (private mode / quota exceeded) must never break playback.
 */
export function writeCachedPlayerState(data: PlayerStateData): void {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(PLAYER_STATE_LOCAL_KEY, JSON.stringify(data));
  } catch {
    // Offline restore is best-effort — swallow storage failures.
  }
}

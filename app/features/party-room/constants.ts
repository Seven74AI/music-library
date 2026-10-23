/**
 * Party Room tunable limits (ADR-030).
 */

export const ROOM_CODE_LENGTH = 6;

/** Charset aligned with auth OTP — no 0/O/I. */
export const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ123456789";

export const MAX_QUEUE_TRACKS = 500;
export const MAX_PARTICIPANTS = 50;
export const MAX_ACTIVE_ROOMS_PER_CREATOR = 1;
export const GUEST_DISPLAY_NAME_MIN = 1;
export const GUEST_DISPLAY_NAME_MAX = 24;

export const ADD_TRACK_RATE_PER_MIN = 30;
export const ROOM_SEARCH_RATE_PER_MIN = 60;
export const AUDITION_GRANT_RATE_PER_MIN = 20;

/** Auto-close after this long with zero connected participants. */
export const EMPTY_ROOM_TTL_MS = 45 * 60 * 1000;

/** Non-speaker is Away when lastSeenAt is older than this. */
export const NON_SPEAKER_AWAY_MS = 10_000;

/**
 * Speaker is Away when lastSeenAt is older than this.
 * Become host stays hidden until the speaker crosses this silence window,
 * including after playback progress heartbeats stop.
 */
export const SPEAKER_SILENCE_GRACE_MS = 30_000;

export const ROOM_STATUS = {
  open: "open",
  ended: "ended",
} as const;

export type RoomStatus = (typeof ROOM_STATUS)[keyof typeof ROOM_STATUS];

export const ROOM_ROLE = {
  host: "host",
  dj: "dj",
  listener: "listener",
} as const;

export type RoomRole = (typeof ROOM_ROLE)[keyof typeof ROOM_ROLE];

/** Human-readable label for a room role. Unknown roles pass through unchanged. */
export function roomRoleLabel(role: string): string {
  if (role === ROOM_ROLE.host) return "Host";
  if (role === ROOM_ROLE.dj) return "DJ";
  if (role === ROOM_ROLE.listener) return "Listener";
  return role;
}

/** Host-configurable default for new joiners — never host. */
export const DEFAULT_JOIN_ROLE = {
  listener: "listener",
  dj: "dj",
} as const;

export type DefaultJoinRole = (typeof DEFAULT_JOIN_ROLE)[keyof typeof DEFAULT_JOIN_ROLE];

export const ROOM_PLAY_EVENT_TYPES = {
  started: "room_play_started",
  completed: "room_play_completed",
} as const;

export type RoomPlayEventType = (typeof ROOM_PLAY_EVENT_TYPES)[keyof typeof ROOM_PLAY_EVENT_TYPES];

export const RATE_LIMIT_WINDOW_MS = 60_000;

/** Client presence heartbeat interval (target ~2–3s; non-speaker Away is NON_SPEAKER_AWAY_MS). */
export const ROOM_HOST_HEARTBEAT_INTERVAL_MS = 2500;

/** Client-facing aliases (logged-in UX module). */
export const ROOM_QUEUE_MAX_TRACKS = MAX_QUEUE_TRACKS;
export const ROOM_MAX_PARTICIPANTS = MAX_PARTICIPANTS;
export const ROOM_ACTIVE_PER_CREATOR = MAX_ACTIVE_ROOMS_PER_CREATOR;
export const ROOM_GUEST_DISPLAY_NAME_MIN = GUEST_DISPLAY_NAME_MIN;
export const ROOM_GUEST_DISPLAY_NAME_MAX = GUEST_DISPLAY_NAME_MAX;
export const ROOM_ADD_TRACK_RATE_PER_MIN = ADD_TRACK_RATE_PER_MIN;
export const ROOM_AUDITION_RATE_PER_MIN = AUDITION_GRANT_RATE_PER_MIN;
export const ROOM_EMPTY_TTL_MS = EMPTY_ROOM_TTL_MS;
export const ROOM_NON_SPEAKER_AWAY_MS = NON_SPEAKER_AWAY_MS;

export type RoomDefaultJoinRole = DefaultJoinRole;

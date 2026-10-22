export {
  ROOM_CODE_CHARSET,
  ROOM_CODE_LENGTH,
  MAX_QUEUE_TRACKS,
  MAX_PARTICIPANTS,
  MAX_ACTIVE_ROOMS_PER_CREATOR,
  GUEST_DISPLAY_NAME_MIN,
  GUEST_DISPLAY_NAME_MAX,
  ADD_TRACK_RATE_PER_MIN,
  ROOM_SEARCH_RATE_PER_MIN,
  AUDITION_GRANT_RATE_PER_MIN,
  EMPTY_ROOM_TTL_MS,
  HOST_GRACE_MS,
  SPEAKER_SILENCE_GRACE_MS,
  ROOM_STATUS,
  ROOM_ROLE,
  DEFAULT_JOIN_ROLE,
  ROOM_PLAY_EVENT_TYPES,
  RATE_LIMIT_WINDOW_MS,
  ROOM_HOST_HEARTBEAT_INTERVAL_MS,
  ROOM_QUEUE_MAX_TRACKS,
  ROOM_MAX_PARTICIPANTS,
  ROOM_ACTIVE_PER_CREATOR,
  ROOM_GUEST_DISPLAY_NAME_MIN,
  ROOM_GUEST_DISPLAY_NAME_MAX,
  ROOM_ADD_TRACK_RATE_PER_MIN,
  ROOM_AUDITION_RATE_PER_MIN,
  ROOM_EMPTY_TTL_MS,
  ROOM_HOST_GRACE_MS,
} from "./constants.ts";

export type {
  RoomStatus,
  RoomRole,
  DefaultJoinRole,
  RoomDefaultJoinRole,
  RoomPlayEventType,
} from "./constants.ts";

export {
  generateRoomCode,
  isValidRoomCode,
  parseRoomCodeInput,
  buildRoomJoinPath,
  buildRoomJoinUrl,
} from "./codes.ts";

export {
  normalizeRoomCode,
  parseRoomCodeInput as parseRoomCodeInputClient,
  buildRoomJoinPath as buildRoomJoinPathClient,
  buildRoomJoinUrl as buildRoomJoinUrlClient,
} from "./code.ts";

export {
  capabilitiesForRole,
  roleHasCapability,
  canAddTracks,
  canEditOthersUpcoming,
  canRemoveOwn,
  canRemoveQueueItem,
  canTransport,
  canManageRoom,
  canBeSpeaker,
  isRoomRole,
  canRoomRole,
  canAddToRoomQueue,
  canRemoveOwnQueueItem,
  canControlTransport,
  isRoomSpeakerRole,
  rankForHostTakeover,
} from "./capabilities.ts";

export type { RoomCapability } from "./capabilities.ts";
export type * from "./types.ts";

import { type RoomQueueItemDto, type RoomSnapshot } from "./types.ts";

/** Split queue into history (≤ currentIndex) and upcoming (> currentIndex). */
export function splitRoomQueue(room: Pick<RoomSnapshot, "queue" | "playback">): {
  history: RoomQueueItemDto[];
  upcoming: RoomQueueItemDto[];
  nowPlaying: RoomQueueItemDto | null;
} {
  const queue = room.queue ?? [];
  const idx = room.playback?.currentIndex ?? -1;
  if (queue.length === 0 || idx < 0) {
    return { history: [], upcoming: queue, nowPlaying: null };
  }
  const history = queue.filter((item) => item.position < idx);
  const nowPlaying = queue.find((item) => item.position === idx) ?? null;
  const upcoming = queue.filter((item) => item.position > idx);
  return { history, upcoming, nowPlaying };
}

/** True when the local participant is the current host (speaker device). */
export function isCurrentHost(room: RoomSnapshot): boolean {
  return Boolean(room.me && room.me.id === room.currentHostParticipantId);
}

/**
 * The reclaim seat may take the speaker back while they are still in the room.
 * Playback does not hide it. `participants` is the in-room list (`leftAt` null).
 */
export function canReclaimHost(room: RoomSnapshot): boolean {
  if (room.status !== "open" || !room.me || !room.reclaimParticipantId) return false;
  if (room.me.id !== room.reclaimParticipantId) return false;
  if (room.me.id === room.currentHostParticipantId) return false;
  return room.participants.some((participant) => participant.id === room.me!.id);
}

/** Non-host participant may take over after grace when server flags it. */
export function canBecomeHost(room: RoomSnapshot): boolean {
  return Boolean(
    room.hostTakeoverAvailable &&
    room.me &&
    room.me.id !== room.currentHostParticipantId &&
    room.me.role !== "host" &&
    room.status === "open",
  );
}

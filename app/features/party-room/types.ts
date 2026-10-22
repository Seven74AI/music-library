import { type RoomDefaultJoinRole, type RoomRole, type RoomStatus } from "./constants.ts";

/** Lightweight track stub embedded in room queue snapshots. */
export type RoomQueueTrackStub = {
  id: string;
  title: string;
  artistName: string;
  duration: number | null;
  coverObjectKey: string | null;
  hasAudio: boolean;
};

export type RoomParticipantDto = {
  id: string;
  displayName: string;
  role: RoomRole;
  userId: string | null;
  isGuest: boolean;
  /** ISO timestamp of this participant's last presence heartbeat. */
  lastHeartbeatAt: string | null;
  isOriginalHost: boolean;
};

export type RoomQueueItemDto = {
  id: string;
  position: number;
  trackId: string;
  track: RoomQueueTrackStub;
  addedByParticipantId: string;
  addedByDisplayName: string;
  createdAt: string;
};

export type RoomPlaybackDto = {
  /** Whether the speaker should be playing. */
  isPlaying: boolean;
  currentIndex: number;
  /** Track at currentIndex, if any. */
  currentTrackId: string | null;
};

export type RoomSnapshot = {
  id: string;
  code: string;
  status: RoomStatus;
  defaultJoinRole: RoomDefaultJoinRole;
  roomVersion: number;
  createdAt: string;
  endedAt: string | null;
  originalHostParticipantId: string;
  /** Seat allowed to reclaim the speaker. Null only before a holder exists. */
  reclaimParticipantId: string | null;
  currentHostParticipantId: string;
  /** ISO of last successful host heartbeat (server clock). */
  hostLastHeartbeatAt: string | null;
  /** True when grace elapsed and Become host is offered. */
  hostTakeoverAvailable: boolean;
  me: RoomParticipantDto | null;
  participants: RoomParticipantDto[];
  queue: RoomQueueItemDto[];
  playback: RoomPlaybackDto;
  joinUrl: string;
  qrDataUrl: string | null;
};

export type RoomSseEvent =
  | { type: "snapshot"; roomVersion: number; room: RoomSnapshot }
  | { type: "version"; roomVersion: number };

export type CreateRoomInput = {
  defaultJoinRole?: RoomDefaultJoinRole;
};

export type JoinRoomInput = {
  code: string;
  displayName?: string;
};

export type RoomTransportAction =
  | { action: "play" }
  | { action: "pause" }
  | { action: "skip" }
  | { action: "jump"; index: number };

export type RoomPlayEventType = "room_play_started" | "room_play_completed";

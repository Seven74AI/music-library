/**
 * Thin client helpers aligned with backend PR #294 (ADR-030).
 *
 * Routes use the room **code** (not id):
 *   POST   /api/rooms
 *   GET    /api/rooms/current
 *   GET    /api/rooms/:code
 *   POST   /api/rooms/:code/join
 *   POST   /api/rooms/:code/leave
 *   POST   /api/rooms/:code/end
 *   POST   /api/rooms/:code/heartbeat
 *   POST   /api/rooms/:code/become-host
 *   POST   /api/rooms/:code/reclaim-host
 *   POST   /api/rooms/:code/settings
 *   POST   /api/rooms/:code/queue          (intent-based)
 *   GET    /api/rooms/:code/events         (SSE)
 *   POST   /api/rooms/:code/play-events
 *   GET    /api/rooms/:code/qr
 *
 * GET /api/rooms/current is the signed-in seat lookup. sessionStorage
 * (ACTIVE_ROOM_CODE_KEY) caches that code after a successful response.
 * A missing cache is not "no room".
 */

import { SPEAKER_SILENCE_GRACE_MS, type RoomDefaultJoinRole, type RoomRole } from "./constants.ts";
import {
  type CreateRoomInput,
  type JoinRoomInput,
  type RoomPlayEventType,
  type RoomSnapshot,
  type RoomTransportAction,
} from "./types.ts";

export const ACTIVE_ROOM_CODE_KEY = "party-room.active-code";

export const ROOM_API = {
  create: "/api/rooms",
  current: "/api/rooms/current",
  room: (code: string) => `/api/rooms/${code}`,
  join: (code: string) => `/api/rooms/${code}/join`,
  leave: (code: string) => `/api/rooms/${code}/leave`,
  end: (code: string) => `/api/rooms/${code}/end`,
  heartbeat: (code: string) => `/api/rooms/${code}/heartbeat`,
  becomeHost: (code: string) => `/api/rooms/${code}/become-host`,
  reclaimHost: (code: string) => `/api/rooms/${code}/reclaim-host`,
  settings: (code: string) => `/api/rooms/${code}/settings`,
  queue: (code: string) => `/api/rooms/${code}/queue`,
  events: (code: string) => `/api/rooms/${code}/events`,
  playEvents: (code: string) => `/api/rooms/${code}/play-events`,
  qr: (code: string) => `/api/rooms/${code}/qr`,
  speakerAudio: (trackId: string) => `/resources/rooms/audio/${trackId}`,
} as const;

export class RoomApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "RoomApiError";
    this.status = status;
    this.body = body;
  }
}

export function readActiveRoomCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(ACTIVE_ROOM_CODE_KEY);
  } catch {
    return null;
  }
}

export function writeActiveRoomCode(code: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (code) sessionStorage.setItem(ACTIVE_ROOM_CODE_KEY, code);
    else sessionStorage.removeItem(ACTIVE_ROOM_CODE_KEY);
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Resolve the room code for leave/end before the live snapshot lands.
 * Guest join writes sessionStorage first; `roomCodeRef` is only set after GET.
 */
export function resolveRoomActionCode(options: {
  override?: string | null;
  refCode?: string | null;
  storedCode?: string | null;
}): string | null {
  for (const candidate of [options.override, options.refCode, options.storedCode]) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }
  return null;
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function roomFetch<T>(
  url: string,
  init?: RequestInit,
  options?: { allowNoContent?: boolean },
): Promise<T | null> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 204) {
    if (options?.allowNoContent) return null;
    return null;
  }

  const body = await parseJsonSafe(response);
  if (!response.ok) {
    const message =
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Room API error (${response.status})`;
    throw new RoomApiError(message, response.status, body);
  }

  // Auth redirects can return 200 HTML login pages — treat non-objects as failure.
  if (body !== null && typeof body !== "object") {
    throw new RoomApiError("Unexpected non-JSON room API response", response.status, body);
  }

  return body as T;
}

/**
 * Queue mutations sometimes wrap the snapshot (`{ snapshot, addedCount, … }`).
 * Prefer the nested snapshot when present.
 */
export function unwrapRoomSnapshotPayload(raw: Record<string, unknown>): Record<string, unknown> {
  const nested = raw.snapshot;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return raw;
}

/** Normalize backend snapshot variations into the client RoomSnapshot shape. */
export function normalizeRoomSnapshot(
  rawInput: Record<string, unknown>,
  meUserId?: string | null,
): RoomSnapshot {
  const raw = unwrapRoomSnapshotPayload(rawInput);
  const code = String(raw.code ?? "");
  const participants = Array.isArray(raw.participants) ? raw.participants : [];
  const queue = Array.isArray(raw.queue) ? raw.queue : [];
  const currentHostParticipantId = String(raw.currentHostParticipantId ?? "");
  const reclaimParticipantId =
    typeof raw.reclaimParticipantId === "string" ? raw.reclaimParticipantId : null;
  const originalHostUserId =
    typeof raw.originalHostUserId === "string" ? raw.originalHostUserId : null;

  const mappedParticipants = participants.map((p) => {
    const row = p as Record<string, unknown>;
    const id = String(row.id ?? "");
    const userId = typeof row.userId === "string" ? row.userId : null;
    const role = (row.role as RoomRole) ?? "listener";
    return {
      id,
      displayName: String(row.displayName ?? "Guest"),
      role,
      userId,
      isGuest: !userId,
      lastHeartbeatAt:
        typeof row.lastSeenAt === "string"
          ? row.lastSeenAt
          : typeof row.lastHeartbeatAt === "string"
            ? row.lastHeartbeatAt
            : null,
      isOriginalHost: Boolean(
        (row.isOriginalHost as boolean | undefined) ||
        (originalHostUserId && userId === originalHostUserId),
      ),
    };
  });

  const me =
    mappedParticipants.find((p) => (meUserId ? p.userId === meUserId : false)) ??
    (typeof raw.me === "object" && raw.me !== null
      ? (() => {
          const m = raw.me as Record<string, unknown>;
          return {
            id: String(m.id ?? ""),
            displayName: String(m.displayName ?? ""),
            role: (m.role as RoomRole) ?? "listener",
            userId: typeof m.userId === "string" ? m.userId : null,
            isGuest: !m.userId,
            lastHeartbeatAt: typeof m.lastSeenAt === "string" ? m.lastSeenAt : null,
            isOriginalHost: Boolean(m.isOriginalHost),
          };
        })()
      : null);

  const mappedQueue = queue.map((item) => {
    const row = item as Record<string, unknown>;
    const track = (row.track as Record<string, unknown> | undefined) ?? {};
    const artist = (track.artist as Record<string, unknown> | undefined) ?? {};
    const cover = (track.coverImage as Record<string, unknown> | null | undefined) ?? null;
    return {
      id: String(row.id ?? ""),
      position: Number(row.position ?? 0),
      trackId: String(row.trackId ?? track.id ?? ""),
      track: {
        id: String(track.id ?? row.trackId ?? ""),
        title: String(track.title ?? "Unknown"),
        artistName: String(artist.name ?? row.artistName ?? "Unknown"),
        duration: typeof track.duration === "number" ? track.duration : null,
        coverObjectKey: cover && typeof cover.objectKey === "string" ? cover.objectKey : null,
        hasAudio: true,
      },
      addedByParticipantId: String(row.addedByParticipantId ?? ""),
      addedByDisplayName: String(row.addedByDisplayName ?? ""),
      createdAt: String(row.createdAt ?? new Date().toISOString()),
    };
  });

  const currentIndex = Number(
    raw.currentIndex ?? (raw.playback as { currentIndex?: number } | undefined)?.currentIndex ?? 0,
  );
  const isPlaying = Boolean(
    raw.isPlaying ?? (raw.playback as { isPlaying?: boolean } | undefined)?.isPlaying,
  );
  const currentTrackId = mappedQueue.find((q) => q.position === currentIndex)?.trackId ?? null;

  const hostLast =
    mappedParticipants.find((p) => p.id === currentHostParticipantId)?.lastHeartbeatAt ?? null;

  // Empty host seat, or speaker silent for SPEAKER_SILENCE_GRACE_MS → others may Become host.
  const hostSeatEmpty =
    !currentHostParticipantId || !mappedParticipants.some((p) => p.id === currentHostParticipantId);
  const hostGraceElapsed = hostLast
    ? Date.now() - Date.parse(hostLast) > SPEAKER_SILENCE_GRACE_MS
    : hostSeatEmpty;
  const hostTakeoverAvailable = Boolean(
    raw.hostTakeoverAvailable ??
    (me && me.id !== currentHostParticipantId && (hostSeatEmpty || hostGraceElapsed)),
  );

  return {
    id: String(raw.roomId ?? raw.id ?? ""),
    code,
    status: (raw.status as RoomSnapshot["status"]) ?? "open",
    defaultJoinRole: (raw.defaultJoinRole as RoomDefaultJoinRole) ?? "listener",
    roomVersion: Number(raw.roomVersion ?? 0),
    createdAt: String(raw.createdAt ?? new Date().toISOString()),
    endedAt: typeof raw.endedAt === "string" ? raw.endedAt : null,
    originalHostParticipantId: String(
      raw.originalHostParticipantId ?? mappedParticipants.find((p) => p.isOriginalHost)?.id ?? "",
    ),
    reclaimParticipantId,
    currentHostParticipantId,
    hostLastHeartbeatAt: hostLast,
    hostTakeoverAvailable,
    me,
    participants: mappedParticipants,
    queue: mappedQueue,
    playback: {
      isPlaying,
      currentIndex,
      currentTrackId,
    },
    joinUrl:
      typeof raw.joinUrl === "string"
        ? raw.joinUrl
        : typeof window !== "undefined"
          ? `${window.location.origin}/rooms/${code}`
          : `/rooms/${code}`,
    qrDataUrl: typeof raw.qrDataUrl === "string" ? raw.qrDataUrl : null,
  };
}

export async function fetchRoomByCode(
  code: string,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.room(code), { method: "GET" });
  if (!raw) throw new RoomApiError("Empty room response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

/**
 * Restore the signed-in user's open seat.
 * Always asks the server — sessionStorage is only a cache of the last code.
 */
export async function fetchCurrentRoom(meUserId?: string | null): Promise<RoomSnapshot | null> {
  const raw = await roomFetch<Record<string, unknown>>(
    ROOM_API.current,
    { method: "GET" },
    { allowNoContent: true },
  );
  if (!raw) {
    writeActiveRoomCode(null);
    return null;
  }
  const room = normalizeRoomSnapshot(raw, meUserId);
  writeActiveRoomCode(room.code || null);
  return room;
}

export async function createRoom(
  input: CreateRoomInput = {},
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.create, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!raw) throw new RoomApiError("Empty create response", 500);
  const code = String(raw.code ?? "");
  writeActiveRoomCode(code);
  // Create response is partial — fetch full snapshot when possible.
  try {
    return await fetchRoomByCode(code, meUserId);
  } catch {
    return normalizeRoomSnapshot(raw, meUserId);
  }
}

export async function joinRoom(
  input: JoinRoomInput,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const code = input.code;
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.join(code), {
    method: "POST",
    body: JSON.stringify({ code, displayName: input.displayName }),
  });
  if (!raw) throw new RoomApiError("Empty join response", 500);
  const joinedCode = String(raw.code ?? code);
  writeActiveRoomCode(joinedCode);
  return fetchRoomByCode(joinedCode, meUserId);
}

export async function leaveRoom(code: string): Promise<void> {
  await roomFetch(ROOM_API.leave(code), { method: "POST" }, { allowNoContent: true });
  writeActiveRoomCode(null);
}

export async function endRoom(code: string): Promise<void> {
  await roomFetch(ROOM_API.end(code), { method: "POST" }, { allowNoContent: true });
  writeActiveRoomCode(null);
}

export type RoomHeartbeatResult = {
  ok: true;
  lastSeenAt: string;
  hostTakeoverAvailable: boolean;
  emptySince: string | null;
  participants: Array<{ id: string; lastSeenAt: string }>;
};

export async function sendHostHeartbeat(code: string): Promise<RoomHeartbeatResult | null> {
  return roomFetch<RoomHeartbeatResult>(
    ROOM_API.heartbeat(code),
    { method: "POST" },
    { allowNoContent: true },
  );
}

export async function becomeHost(code: string, meUserId?: string | null): Promise<RoomSnapshot> {
  await roomFetch(ROOM_API.becomeHost(code), { method: "POST" }, { allowNoContent: true });
  return fetchRoomByCode(code, meUserId);
}

export async function reclaimHost(code: string, meUserId?: string | null): Promise<RoomSnapshot> {
  await roomFetch(ROOM_API.reclaimHost(code), { method: "POST" }, { allowNoContent: true });
  return fetchRoomByCode(code, meUserId);
}

export async function updateRoomSettings(
  code: string,
  patch: { defaultJoinRole: RoomDefaultJoinRole },
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  await roomFetch(ROOM_API.settings(code), {
    method: "POST",
    body: JSON.stringify(patch),
  });
  return fetchRoomByCode(code, meUserId);
}

export async function addTrackToRoomQueue(
  code: string,
  trackId: string,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.queue(code), {
    method: "POST",
    body: JSON.stringify({ intent: "add_track", trackId }),
  });
  if (!raw) throw new RoomApiError("Empty queue add response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

export async function addPlaylistToRoomQueue(
  code: string,
  playlistId: string,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.queue(code), {
    method: "POST",
    body: JSON.stringify({ intent: "add_playlist", playlistId }),
  });
  if (!raw) throw new RoomApiError("Empty playlist queue response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

export async function removeRoomQueueItem(
  code: string,
  itemId: string,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.queue(code), {
    method: "POST",
    body: JSON.stringify({ intent: "remove", queueItemId: itemId }),
  });
  if (!raw) throw new RoomApiError("Empty queue remove response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

/** Reorder upcoming queue rows (Host/DJ). Ids must be the full upcoming set. */
export async function reorderRoomQueue(
  code: string,
  orderedUpcomingIds: string[],
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.queue(code), {
    method: "POST",
    body: JSON.stringify({ intent: "reorder", orderedUpcomingIds }),
  });
  if (!raw) throw new RoomApiError("Empty queue reorder response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

export async function sendRoomTransport(
  code: string,
  action: RoomTransportAction,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  const body =
    action.action === "jump" ? { intent: "jump", index: action.index } : { intent: action.action };
  const raw = await roomFetch<Record<string, unknown>>(ROOM_API.queue(code), {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!raw) throw new RoomApiError("Empty transport response", 500);
  return normalizeRoomSnapshot(raw, meUserId);
}

export async function setParticipantRole(
  code: string,
  participantId: string,
  role: Exclude<RoomRole, "host">,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  await roomFetch(`${ROOM_API.room(code)}/participants/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
  return fetchRoomByCode(code, meUserId);
}

export async function kickParticipant(
  code: string,
  participantId: string,
  meUserId?: string | null,
): Promise<RoomSnapshot> {
  await roomFetch(`${ROOM_API.room(code)}/participants/${participantId}`, {
    method: "DELETE",
  });
  return fetchRoomByCode(code, meUserId);
}

export async function fetchRoomQrDataUrl(code: string): Promise<string | null> {
  try {
    const raw = await roomFetch<{ dataUrl?: string; qrDataUrl?: string }>(ROOM_API.qr(code), {
      method: "GET",
    });
    return raw?.dataUrl ?? raw?.qrDataUrl ?? null;
  } catch {
    return null;
  }
}

/** Fire-and-forget room play events — never personal UsageEvent. */
export function reportRoomPlayEvent(
  code: string,
  type: RoomPlayEventType,
  trackId: string,
  playId?: string | null,
): void {
  if (typeof window === "undefined" || !trackId || !code) return;

  void fetch(ROOM_API.playEvents(code), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify({ type, trackId, playId: playId ?? undefined }),
  }).catch(() => {
    // Analytics must not break playback
  });
}

import { ROOM_ROLE, type RoomRole } from "./constants.ts";

export type RoomCapability =
  | "seeQueue"
  | "addTracks"
  | "editOthersUpcoming"
  | "removeOwn"
  | "transport"
  | "manageRoom"
  | "speaker";

const CAPABILITIES_BY_ROLE: Record<RoomRole, ReadonlySet<RoomCapability>> = {
  [ROOM_ROLE.host]: new Set<RoomCapability>([
    "seeQueue",
    "addTracks",
    "editOthersUpcoming",
    "removeOwn",
    "transport",
    "manageRoom",
    "speaker",
  ]),
  [ROOM_ROLE.dj]: new Set<RoomCapability>([
    "seeQueue",
    "addTracks",
    "editOthersUpcoming",
    "removeOwn",
  ]),
  [ROOM_ROLE.listener]: new Set<RoomCapability>(["seeQueue", "removeOwn"]),
};

export function capabilitiesForRole(role: RoomRole): ReadonlySet<RoomCapability> {
  return CAPABILITIES_BY_ROLE[role];
}

export function roleHasCapability(role: RoomRole, capability: RoomCapability): boolean {
  return CAPABILITIES_BY_ROLE[role].has(capability);
}

export function canAddTracks(role: RoomRole): boolean {
  return roleHasCapability(role, "addTracks");
}

export function canEditOthersUpcoming(role: RoomRole): boolean {
  return roleHasCapability(role, "editOthersUpcoming");
}

export function canRemoveOwn(role: RoomRole): boolean {
  return roleHasCapability(role, "removeOwn");
}

export function canTransport(role: RoomRole): boolean {
  return roleHasCapability(role, "transport");
}

export function canManageRoom(role: RoomRole): boolean {
  return roleHasCapability(role, "manageRoom");
}

export function canBeSpeaker(role: RoomRole): boolean {
  return roleHasCapability(role, "speaker");
}

/**
 * Whether a participant may remove a queue row.
 * Editors can remove others' upcoming; every role can remove-own.
 */
export function canRemoveQueueItem({
  role,
  addedByParticipantId,
  actorParticipantId,
  isUpcoming,
}: {
  role: RoomRole;
  addedByParticipantId: string;
  actorParticipantId: string;
  isUpcoming: boolean;
}): boolean {
  if (!isUpcoming) return false;
  if (addedByParticipantId === actorParticipantId) {
    return canRemoveOwn(role);
  }
  return canEditOthersUpcoming(role);
}

export function isRoomRole(value: string): value is RoomRole {
  return value === ROOM_ROLE.host || value === ROOM_ROLE.dj || value === ROOM_ROLE.listener;
}

/** Client-facing aliases used by logged-in UX. */
export const canRoomRole = roleHasCapability;
export const canAddToRoomQueue = canAddTracks;
export const canRemoveOwnQueueItem = canRemoveOwn;
export const canControlTransport = canTransport;
export const isRoomSpeakerRole = canBeSpeaker;

/** Prefer DJ over Listener when offering Become host after grace. */
export function rankForHostTakeover(role: RoomRole): number {
  if (role === ROOM_ROLE.dj) return 2;
  if (role === ROOM_ROLE.listener) return 1;
  return 0;
}

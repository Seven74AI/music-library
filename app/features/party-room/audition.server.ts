import { remember } from "@epic-web/remember";
import { randomBytes } from "node:crypto";
import { LRUCache } from "lru-cache";
import { roleHasCapability } from "./capabilities.ts";
import { ROOM_STATUS, type RoomRole, type RoomStatus } from "./constants.ts";
import { auditionGrantRateLimit } from "./rate-limit.server.ts";

/** Short-lived audition audio grant TTL (seconds). */
export const AUDITION_GRANT_TTL_SECONDS = 120;

export type AuditionParticipant = {
  id: string;
  roomId: string;
  role: RoomRole;
  roomStatus: RoomStatus;
};

export type AuditionGrant = {
  id: string;
  participantId: string;
  roomId: string;
  trackId: string;
  expiresAt: number;
};

export type AuditionGrantDenial =
  | { ok: false; reason: "not_seated" }
  | { ok: false; reason: "room_ended" }
  | { ok: false; reason: "role_denied" }
  | { ok: false; reason: "no_audio" }
  | { ok: false; reason: "rate_limited"; retryAfterSeconds: number };

export type AuditionGrantSuccess = {
  ok: true;
  grant: AuditionGrant;
  revokedGrantId: string | null;
};

export type AuditionGrantResult = AuditionGrantSuccess | AuditionGrantDenial;

type GrantStore = {
  byId: LRUCache<string, AuditionGrant>;
  activeByParticipant: Map<string, string>;
};

const grantStore = remember(
  "party-room-audition-grants",
  (): GrantStore => ({
    byId: new LRUCache<string, AuditionGrant>({
      max: 20_000,
      ttl: AUDITION_GRANT_TTL_SECONDS * 1000,
    }),
    activeByParticipant: new Map(),
  }),
);

export function resetAuditionGrants(): void {
  grantStore.byId.clear();
  grantStore.activeByParticipant.clear();
}

export function getAuditionGrant(grantId: string, now = Date.now()): AuditionGrant | null {
  const grant = grantStore.byId.get(grantId);
  if (!grant) return null;
  if (grant.expiresAt <= now) {
    grantStore.byId.delete(grantId);
    if (grantStore.activeByParticipant.get(grant.participantId) === grantId) {
      grantStore.activeByParticipant.delete(grant.participantId);
    }
    return null;
  }
  return grant;
}

/** Every seated role may search + audition (seeQueue). */
export function canSearchAndAudition(role: RoomRole): boolean {
  return roleHasCapability(role, "seeQueue");
}

export function authorizeAuditionGrant(input: {
  participant: AuditionParticipant | null;
  trackHasAudio: boolean;
}): AuditionGrantDenial | { ok: true } {
  const { participant, trackHasAudio } = input;
  if (!participant) return { ok: false, reason: "not_seated" };
  if (participant.roomStatus !== ROOM_STATUS.open) return { ok: false, reason: "room_ended" };
  if (!canSearchAndAudition(participant.role)) return { ok: false, reason: "role_denied" };
  if (!trackHasAudio) return { ok: false, reason: "no_audio" };
  return { ok: true };
}

export function issueAuditionGrant(input: {
  participant: AuditionParticipant | null;
  trackId: string;
  trackHasAudio: boolean;
  now?: number;
}): AuditionGrantResult {
  const now = input.now ?? Date.now();
  const authz = authorizeAuditionGrant({
    participant: input.participant,
    trackHasAudio: input.trackHasAudio,
  });
  if (!authz.ok) return authz;

  const participant = input.participant!;
  const budget = auditionGrantRateLimit.consume(participant.id, now);
  if (!budget.allowed) {
    return {
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: budget.retryAfterSeconds,
    };
  }

  const previousGrantId = grantStore.activeByParticipant.get(participant.id) ?? null;
  if (previousGrantId) grantStore.byId.delete(previousGrantId);

  const grant: AuditionGrant = {
    id: randomBytes(18).toString("base64url"),
    participantId: participant.id,
    roomId: participant.roomId,
    trackId: input.trackId,
    expiresAt: now + AUDITION_GRANT_TTL_SECONDS * 1000,
  };
  grantStore.byId.set(grant.id, grant);
  grantStore.activeByParticipant.set(participant.id, grant.id);
  return { ok: true, grant, revokedGrantId: previousGrantId };
}

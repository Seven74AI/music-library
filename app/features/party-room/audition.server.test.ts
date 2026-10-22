import { beforeEach, describe, expect, test } from "vitest";
import {
  authorizeAuditionGrant,
  canSearchAndAudition,
  getAuditionGrant,
  issueAuditionGrant,
  resetAuditionGrants,
  type AuditionParticipant,
} from "./audition.server.ts";
import { canAddTracks, canBeSpeaker, canManageRoom, canTransport } from "./capabilities.ts";
import { AUDITION_GRANT_RATE_PER_MIN, ROOM_ROLE, ROOM_STATUS } from "./constants.ts";
import { normalizeDisplayName } from "./party-room.server.ts";
import { resetPartyRoomRateLimits } from "./rate-limit.server.ts";

function listener(overrides: Partial<AuditionParticipant> = {}): AuditionParticipant {
  return {
    id: "participant-1",
    roomId: "room-1",
    role: ROOM_ROLE.listener,
    roomStatus: ROOM_STATUS.open,
    ...overrides,
  };
}

describe("role capabilities (ADR-030)", () => {
  test("listener can search/audition but cannot add", () => {
    expect(canSearchAndAudition(ROOM_ROLE.listener)).toBe(true);
    expect(canAddTracks(ROOM_ROLE.listener)).toBe(false);
    expect(canTransport(ROOM_ROLE.listener)).toBe(false);
  });

  test("dj can add but not transport", () => {
    expect(canAddTracks(ROOM_ROLE.dj)).toBe(true);
    expect(canTransport(ROOM_ROLE.dj)).toBe(false);
    expect(canManageRoom(ROOM_ROLE.dj)).toBe(false);
  });

  test("host has transport and manage", () => {
    expect(canTransport(ROOM_ROLE.host)).toBe(true);
    expect(canManageRoom(ROOM_ROLE.host)).toBe(true);
    expect(canBeSpeaker(ROOM_ROLE.host)).toBe(true);
  });
});

describe("guest display name", () => {
  test("trims surrounding whitespace (backend normalizeDisplayName)", () => {
    expect(normalizeDisplayName("  Ada Lovelace  ")).toBe("Ada Lovelace");
  });

  test("rejects empty and overlong names", () => {
    expect(normalizeDisplayName("")).toBeNull();
    expect(normalizeDisplayName("   ")).toBeNull();
    expect(normalizeDisplayName("x".repeat(25))).toBeNull();
  });
});

describe("authorizeAuditionGrant", () => {
  test("denies when no participant seat", () => {
    expect(authorizeAuditionGrant({ participant: null, trackHasAudio: true })).toEqual({
      ok: false,
      reason: "not_seated",
    });
  });

  test("denies when room has ended", () => {
    expect(
      authorizeAuditionGrant({
        participant: listener({ roomStatus: ROOM_STATUS.ended }),
        trackHasAudio: true,
      }),
    ).toEqual({ ok: false, reason: "room_ended" });
  });

  test("denies tracks without audio", () => {
    expect(authorizeAuditionGrant({ participant: listener(), trackHasAudio: false })).toEqual({
      ok: false,
      reason: "no_audio",
    });
  });

  test("allows seated listener with has-audio track", () => {
    expect(authorizeAuditionGrant({ participant: listener(), trackHasAudio: true })).toEqual({
      ok: true,
    });
  });
});

describe("issueAuditionGrant", () => {
  beforeEach(() => {
    resetAuditionGrants();
    resetPartyRoomRateLimits();
  });

  test("issues a grant for a seated participant", () => {
    const result = issueAuditionGrant({
      participant: listener(),
      trackId: "track-1",
      trackHasAudio: true,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.trackId).toBe("track-1");
    expect(getAuditionGrant(result.grant.id)?.trackId).toBe("track-1");
  });

  test("revokes previous grant (one active audition)", () => {
    const first = issueAuditionGrant({
      participant: listener(),
      trackId: "track-1",
      trackHasAudio: true,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = issueAuditionGrant({
      participant: listener(),
      trackId: "track-2",
      trackHasAudio: true,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.revokedGrantId).toBe(first.grant.id);
    expect(getAuditionGrant(first.grant.id)).toBeNull();
    expect(getAuditionGrant(second.grant.id)?.trackId).toBe("track-2");
  });

  test("rate-limits to ~20 grants per participant per minute", () => {
    for (let i = 0; i < AUDITION_GRANT_RATE_PER_MIN; i++) {
      const result = issueAuditionGrant({
        participant: listener(),
        trackId: `track-${i}`,
        trackHasAudio: true,
      });
      expect(result.ok).toBe(true);
    }
    const limited = issueAuditionGrant({
      participant: listener(),
      trackId: "track-over",
      trackHasAudio: true,
    });
    expect(limited.ok).toBe(false);
    if (limited.ok) return;
    expect(limited.reason).toBe("rate_limited");
  });

  test("rejects anonymous callers (no seat)", () => {
    const result = issueAuditionGrant({
      participant: null,
      trackId: "track-1",
      trackHasAudio: true,
    });
    expect(result).toEqual({ ok: false, reason: "not_seated" });
  });
});

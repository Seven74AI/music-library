import { describe, expect, test } from "vitest";
import {
  canAddTracks,
  canBeSpeaker,
  canEditOthersUpcoming,
  canManageRoom,
  canRemoveOwn,
  canRemoveQueueItem,
  canTransport,
  capabilitiesForRole,
  roleHasCapability,
} from "./capabilities.ts";
import { ROOM_ROLE } from "./constants.ts";

describe("role capabilities (ADR-030 matrix)", () => {
  test("Host has full capabilities", () => {
    const caps = capabilitiesForRole(ROOM_ROLE.host);
    expect(caps.has("seeQueue")).toBe(true);
    expect(caps.has("addTracks")).toBe(true);
    expect(caps.has("editOthersUpcoming")).toBe(true);
    expect(caps.has("removeOwn")).toBe(true);
    expect(caps.has("transport")).toBe(true);
    expect(caps.has("manageRoom")).toBe(true);
    expect(caps.has("speaker")).toBe(true);
  });

  test("DJ can edit queue but not transport or manage", () => {
    expect(canAddTracks(ROOM_ROLE.dj)).toBe(true);
    expect(canEditOthersUpcoming(ROOM_ROLE.dj)).toBe(true);
    expect(canRemoveOwn(ROOM_ROLE.dj)).toBe(true);
    expect(canTransport(ROOM_ROLE.dj)).toBe(false);
    expect(canManageRoom(ROOM_ROLE.dj)).toBe(false);
    expect(canBeSpeaker(ROOM_ROLE.dj)).toBe(false);
  });

  test("Listener can only see queue and remove-own", () => {
    expect(roleHasCapability(ROOM_ROLE.listener, "seeQueue")).toBe(true);
    expect(canAddTracks(ROOM_ROLE.listener)).toBe(false);
    expect(canEditOthersUpcoming(ROOM_ROLE.listener)).toBe(false);
    expect(canRemoveOwn(ROOM_ROLE.listener)).toBe(true);
    expect(canTransport(ROOM_ROLE.listener)).toBe(false);
    expect(canManageRoom(ROOM_ROLE.listener)).toBe(false);
  });
});

describe("canRemoveQueueItem", () => {
  test("history rows are never removable", () => {
    expect(
      canRemoveQueueItem({
        role: ROOM_ROLE.host,
        addedByParticipantId: "p1",
        actorParticipantId: "p1",
        isUpcoming: false,
      }),
    ).toBe(false);
  });

  test("any role can remove-own upcoming", () => {
    for (const role of [ROOM_ROLE.host, ROOM_ROLE.dj, ROOM_ROLE.listener]) {
      expect(
        canRemoveQueueItem({
          role,
          addedByParticipantId: "me",
          actorParticipantId: "me",
          isUpcoming: true,
        }),
      ).toBe(true);
    }
  });

  test("Listener cannot remove others' upcoming", () => {
    expect(
      canRemoveQueueItem({
        role: ROOM_ROLE.listener,
        addedByParticipantId: "other",
        actorParticipantId: "me",
        isUpcoming: true,
      }),
    ).toBe(false);
  });

  test("DJ and Host can remove others' upcoming", () => {
    expect(
      canRemoveQueueItem({
        role: ROOM_ROLE.dj,
        addedByParticipantId: "other",
        actorParticipantId: "me",
        isUpcoming: true,
      }),
    ).toBe(true);
    expect(
      canRemoveQueueItem({
        role: ROOM_ROLE.host,
        addedByParticipantId: "other",
        actorParticipantId: "me",
        isUpcoming: true,
      }),
    ).toBe(true);
  });
});

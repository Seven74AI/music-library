import { describe, expect, it, beforeEach } from "vitest";
import {
  __resetSuspendedPersonalPlayerForTests,
  clearSuspendedPersonalPlayer,
  peekSuspendedPersonalPlayer,
  suspendPersonalPlayerSnapshot,
  takeSuspendedPersonalPlayer,
} from "./player-suspend.ts";
import { type PlayerStateData } from "#app/features/player-state/player-state.ts";

const sample: PlayerStateData = {
  playContext: { type: "library" },
  currentTrackId: "track-1",
  upNextIds: ["track-2"],
  shuffleSeed: null,
  loopMode: "off",
};

describe("player-suspend", () => {
  beforeEach(() => {
    __resetSuspendedPersonalPlayerForTests();
  });

  it("snapshots personal state once and restores via take", () => {
    suspendPersonalPlayerSnapshot(sample, true);
    expect(peekSuspendedPersonalPlayer()?.snapshot.currentTrackId).toBe("track-1");
    // Second suspend does not overwrite
    suspendPersonalPlayerSnapshot({ ...sample, currentTrackId: "other" }, false);
    expect(peekSuspendedPersonalPlayer()?.snapshot.currentTrackId).toBe("track-1");

    const taken = takeSuspendedPersonalPlayer();
    expect(taken?.wasVisible).toBe(true);
    expect(taken?.snapshot.upNextIds).toEqual(["track-2"]);
    expect(peekSuspendedPersonalPlayer()).toBeNull();
  });

  it("clears without restore", () => {
    suspendPersonalPlayerSnapshot(sample, false);
    clearSuspendedPersonalPlayer();
    expect(peekSuspendedPersonalPlayer()).toBeNull();
  });
});

import { describe, expect, test } from "vitest";
import { type QueueTrack } from "#app/types/frontend/shared.ts";
import {
  getQueueSpineDisplayTracks,
  getSpinePlayOrder,
  getUpcomingSpinePlayOrder,
  hasNextTrack,
  hasPreviousTrack,
  jumpToTarget,
  removeSpineAtOrderIndex,
  resolveNextTrack,
  resolvePreviousTrack,
  type QueueNavigationState,
} from "./queue-navigation.ts";

function track(id: string): QueueTrack {
  return { id, title: `Track ${id}`, artist: { id: "a1", name: "Artist" } };
}

function baseState(overrides: Partial<QueueNavigationState> = {}): QueueNavigationState {
  return {
    upNext: [],
    spine: [track("s1"), track("s2"), track("s3")],
    spineOrder: [0, 1, 2],
    spinePosition: 0,
    loopMode: "off",
    ...overrides,
  };
}

describe("resolveNextTrack", () => {
  test("drains Up Next front before advancing the spine", () => {
    const state = baseState({
      upNext: [track("u1"), track("u2")],
      spinePosition: 1,
    });

    expect(resolveNextTrack(state)).toEqual({ zone: "upNext", index: 0 });
  });

  test("advances the spine when Up Next is empty", () => {
    const state = baseState({ spinePosition: 0 });

    expect(resolveNextTrack(state)).toEqual({ zone: "spine", index: 1 });
  });

  test("follows shuffled spine order", () => {
    const state = baseState({
      spineOrder: [2, 0, 1],
      spinePosition: 0,
    });

    expect(resolveNextTrack(state)).toEqual({ zone: "spine", index: 1 });
  });

  test("wraps to the first spine track when loop all is enabled", () => {
    const state = baseState({
      spinePosition: 2,
      loopMode: "all",
    });

    expect(resolveNextTrack(state)).toEqual({ zone: "spine", index: 0 });
  });

  test("replays the current spine track when loop one is enabled", () => {
    const state = baseState({
      spinePosition: 1,
      loopMode: "one",
    });

    expect(resolveNextTrack(state)).toEqual({ zone: "spine", index: 1 });
  });

  test("drains Up Next first when loop one is enabled and Up Next has items", () => {
    const state = baseState({
      upNext: [track("u1"), track("u2")],
      spinePosition: 1,
      loopMode: "one",
    });

    expect(resolveNextTrack(state)).toEqual({ zone: "upNext", index: 0 });
  });

  test("returns null at end of spine with loop off", () => {
    const state = baseState({ spinePosition: 2 });

    expect(resolveNextTrack(state)).toBeNull();
  });
});

describe("resolvePreviousTrack", () => {
  test("walks back through the spine play order", () => {
    const state = baseState({ spinePosition: 2 });

    expect(resolvePreviousTrack(state)).toEqual({ zone: "spine", index: 1 });
  });

  test("wraps to the last spine track when loop all is enabled", () => {
    const state = baseState({
      spinePosition: 0,
      loopMode: "all",
    });

    expect(resolvePreviousTrack(state)).toEqual({ zone: "spine", index: 2 });
  });

  test("replays the current spine track when loop one is enabled", () => {
    const state = baseState({
      spinePosition: 1,
      loopMode: "one",
    });

    expect(resolvePreviousTrack(state)).toEqual({ zone: "spine", index: 1 });
  });

  test("returns null at the start of the spine with loop off", () => {
    const state = baseState({ spinePosition: 0 });

    expect(resolvePreviousTrack(state)).toBeNull();
  });
});

describe("hasNextTrack / hasPreviousTrack", () => {
  test("hasNext is true when Up Next has items", () => {
    expect(hasNextTrack(baseState({ upNext: [track("u1")] }))).toBe(true);
  });

  test("hasNext is true when more spine tracks remain", () => {
    expect(hasNextTrack(baseState({ spinePosition: 0 }))).toBe(true);
  });

  test("hasNext is true for loop all at end of spine", () => {
    expect(hasNextTrack(baseState({ spinePosition: 2, loopMode: "all" }))).toBe(true);
  });

  test("hasPrevious reflects spine position and loop mode", () => {
    expect(hasPreviousTrack(baseState({ spinePosition: 0 }))).toBe(false);
    expect(hasPreviousTrack(baseState({ spinePosition: 0, loopMode: "all" }))).toBe(true);
  });
});

describe("getSpinePlayOrder", () => {
  test("returns spine tracks in play order from the current position", () => {
    const state = baseState({
      spineOrder: [2, 0, 1],
      spinePosition: 1,
    });

    expect(getSpinePlayOrder(state).map((item) => item.id)).toEqual(["s1", "s2"]);
  });
});

describe("getUpcomingSpinePlayOrder", () => {
  test("returns spine tracks after the current position only", () => {
    const state = baseState({
      spineOrder: [2, 0, 1],
      spinePosition: 1,
    });

    expect(getUpcomingSpinePlayOrder(state).map((item) => item.id)).toEqual(["s2"]);
  });

  test("returns empty when current track is last in spine order", () => {
    const state = baseState({ spinePosition: 2 });

    expect(getUpcomingSpinePlayOrder(state)).toEqual([]);
  });
});

describe("jumpToTarget", () => {
  test("advances the spine position to the target", () => {
    const state = baseState({
      spineOrder: [2, 0, 1],
      spinePosition: 0,
    });

    const next = jumpToTarget(state, { zone: "spine", index: 2 });

    expect(next.spinePosition).toBe(2);
  });

  test("preserves the spine order permutation on a spine jump", () => {
    const state = baseState({
      spineOrder: [2, 0, 1],
      spinePosition: 0,
    });

    const next = jumpToTarget(state, { zone: "spine", index: 1 });

    expect(next.spineOrder).toEqual([2, 0, 1]);
    expect(next.spinePosition).toBe(1);
  });

  test("trims Up Next through the clicked index", () => {
    const state = baseState({
      upNext: [track("u1"), track("u2"), track("u3")],
    });

    const next = jumpToTarget(state, { zone: "upNext", index: 1 });

    expect(next.upNext.map((item) => item.id)).toEqual(["u3"]);
  });

  test("trims Up Next to empty when the last item is clicked", () => {
    const state = baseState({
      upNext: [track("u1"), track("u2")],
    });

    const next = jumpToTarget(state, { zone: "upNext", index: 1 });

    expect(next.upNext).toEqual([]);
  });

  test("preserves loop mode on a jump", () => {
    const state = baseState({ loopMode: "one", spinePosition: 1 });

    const next = jumpToTarget(state, { zone: "spine", index: 2 });

    expect(next.loopMode).toBe("one");
  });
});

describe("removeSpineAtOrderIndex", () => {
  test("removing the current first spine track plays the next remaining track", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 0 }), 0);

    expect(result).not.toBeNull();
    expect(result!.removedCurrent).toBe(true);
    expect(result!.playTrack?.id).toBe("s2");
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s2", "s3"]);
    expect(result!.state.spineOrder).toEqual([0, 1]);
    expect(result!.state.spinePosition).toBe(0);
  });

  test("removing the current middle spine track plays the following track, not the removed one", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 1 }), 1);

    expect(result!.playTrack?.id).toBe("s3");
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s1", "s3"]);
    expect(result!.state.spineOrder).toEqual([0, 1]);
    expect(result!.state.spinePosition).toBe(1);
  });

  test("removing the current last spine track with loop off stops playback", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 2 }), 2);

    expect(result!.removedCurrent).toBe(true);
    expect(result!.playTrack).toBeNull();
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s1", "s2"]);
  });

  test("removing the current last spine track with loop all wraps to the first remaining track", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 2, loopMode: "all" }), 2);

    expect(result!.playTrack?.id).toBe("s1");
    expect(result!.state.spinePosition).toBe(0);
  });

  test("removing the current spine track drains Up Next first", () => {
    const result = removeSpineAtOrderIndex(
      baseState({
        upNext: [track("u1"), track("u2")],
        spinePosition: 0,
      }),
      0,
    );

    expect(result!.playTrack?.id).toBe("u1");
    expect(result!.consumedUpNextIndex).toBe(0);
    expect(result!.state.upNext.map((item) => item.id)).toEqual(["u2"]);
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s2", "s3"]);
    expect(result!.state.spinePosition).toBe(0);
  });

  test("removing an upcoming spine track does not change what should play", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 0 }), 1);

    expect(result!.removedCurrent).toBe(false);
    expect(result!.playTrack).toBeNull();
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s1", "s3"]);
    expect(result!.state.spinePosition).toBe(0);
  });

  test("removing a spine track before the play head shifts the pointer back", () => {
    const result = removeSpineAtOrderIndex(baseState({ spinePosition: 2 }), 0);

    expect(result!.removedCurrent).toBe(false);
    expect(result!.playTrack).toBeNull();
    expect(result!.state.spinePosition).toBe(1);
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s2", "s3"]);
  });

  test("removing the current shuffled spine track follows the remaining play order", () => {
    const result = removeSpineAtOrderIndex(
      baseState({
        spineOrder: [2, 0, 1],
        spinePosition: 0,
      }),
      0,
    );

    expect(result!.playTrack?.id).toBe("s1");
    expect(result!.state.spine.map((item) => item.id)).toEqual(["s1", "s2"]);
    expect(result!.state.spineOrder).toEqual([0, 1]);
    expect(result!.state.spinePosition).toBe(0);
  });
});

describe("getQueueSpineDisplayTracks", () => {
  test("shows upcoming spine when something is playing", () => {
    const state = baseState({ spinePosition: 0 });

    expect(getQueueSpineDisplayTracks(state, true).map((item) => item.id)).toEqual(["s2", "s3"]);
  });

  test("shows full spine play order when nothing is playing", () => {
    const state = baseState({ spinePosition: 0 });

    expect(getQueueSpineDisplayTracks(state, false).map((item) => item.id)).toEqual([
      "s1",
      "s2",
      "s3",
    ]);
  });

  test("keeps spine tracks visible even when the same track is also in Up Next", () => {
    const state = baseState({
      upNext: [track("s2")],
      spinePosition: 0,
    });

    expect(getQueueSpineDisplayTracks(state, true).map((t) => t.id)).toEqual(["s2", "s3"]);
  });
});

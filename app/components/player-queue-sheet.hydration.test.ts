import { describe, expect, test } from "vitest";
import {
  PLAYBACK_LOOKAHEAD,
  collectHydrationIds,
  collectQueueDisplayHydrationIds,
} from "#app/features/queue/queue-hydration.ts";

function largeSpineState() {
  const spine = Array.from({ length: 50 }, (_, index) => ({
    id: `s${index}`,
    title: `S${index}`,
    artist: { id: "a", name: "A" },
  }));
  return {
    upNext: [{ id: "u1", title: "U1", artist: { id: "a", name: "A" } }],
    spine,
    spineOrder: spine.map((_, index) => index),
    spinePosition: 0,
    loopMode: "off" as const,
  };
}

describe("player queue sheet hydration scope", () => {
  test("playback lookahead hydration stays bounded; display ids are not used on sheet open", () => {
    const state = largeSpineState();
    const currentTrackId = "s0";

    const displayIds = collectQueueDisplayHydrationIds(state, currentTrackId, {
      audibleIsSpineHead: true,
    });
    const playbackIds = collectHydrationIds(state, currentTrackId);

    expect(displayIds.length).toBeGreaterThan(PLAYBACK_LOOKAHEAD + 1);
    expect(playbackIds.length).toBeLessThanOrEqual(PLAYBACK_LOOKAHEAD + 1);
    expect(playbackIds).toEqual(["s0", "u1", "s1", "s2", "s3"]);
  });
});

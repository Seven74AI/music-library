import { describe, expect, test } from "vitest";
import { collectQueueDisplayHydrationIds } from "#app/features/queue/queue-hydration.ts";
import type { QueueZone } from "#app/features/queue/queue-navigation.ts";

function sheetHydrationIds(
  state: Parameters<typeof collectQueueDisplayHydrationIds>[0],
  currentTrackId: string | null,
  audibleSourceZone: QueueZone | null,
  hasCurrentTrack: boolean,
): string[] {
  return collectQueueDisplayHydrationIds(state, currentTrackId, {
    audibleIsSpineHead: hasCurrentTrack && audibleSourceZone === "spine",
  });
}

describe("player queue sheet hydration ids", () => {
  test("match collectQueueDisplayHydrationIds for spine-head playback", () => {
    const state = {
      upNext: [{ id: "u1", title: "U1", artist: { id: "a", name: "A" } }],
      spine: [
        { id: "s1", title: "S1", artist: { id: "a", name: "A" } },
        { id: "s2", title: "S2", artist: { id: "a", name: "A" } },
      ],
      spineOrder: [0, 1],
      spinePosition: 0,
      loopMode: "off" as const,
    };

    const expected = collectQueueDisplayHydrationIds(state, "s1", {
      audibleIsSpineHead: true,
    });
    expect(sheetHydrationIds(state, "s1", "spine", true)).toEqual(expected);
  });

  test("match collectQueueDisplayHydrationIds when now playing from Up Next", () => {
    const state = {
      upNext: [{ id: "u1", title: "U1", artist: { id: "a", name: "A" } }],
      spine: [
        { id: "s1", title: "S1", artist: { id: "a", name: "A" } },
        { id: "s2", title: "S2", artist: { id: "a", name: "A" } },
      ],
      spineOrder: [0, 1],
      spinePosition: 0,
      loopMode: "off" as const,
    };

    const expected = collectQueueDisplayHydrationIds(state, "u1", {
      audibleIsSpineHead: false,
    });
    expect(sheetHydrationIds(state, "u1", "upNext", true)).toEqual(expected);
  });
});

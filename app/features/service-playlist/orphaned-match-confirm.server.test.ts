import { describe, expect, test } from "vitest";
import { getDuplicateMatchedTrackIds } from "./orphaned-match-confirm.server";

describe("getDuplicateMatchedTrackIds", () => {
  test("returns empty when each matched track is unique", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "new", selectedTrackId: null },
        { action: "skip", selectedTrackId: null },
      ]),
    ).toEqual([]);
  });

  test("returns track ids selected more than once", () => {
    expect(
      getDuplicateMatchedTrackIds([
        { action: "match", selectedTrackId: "t1" },
        { action: "match", selectedTrackId: "t2" },
        { action: "match", selectedTrackId: "t1" },
      ]),
    ).toEqual(["t1"]);
  });
});

import { describe, expect, test } from "vitest";
import {
  formatQueueSheetTitle,
  getSpineSectionHeading,
  getSpineSectionLabel,
} from "./queue-sheet-ui.ts";

describe("formatQueueSheetTitle", () => {
  test("formats up next and spine counts", () => {
    expect(formatQueueSheetTitle(3, 14832, "from library")).toBe(
      "Queue (3 up next · 14,832 from library)",
    );
  });

  test("shows only up next when spine total is zero", () => {
    expect(formatQueueSheetTitle(2, 0, "from library")).toBe("Queue (2 up next)");
  });

  test("shows only spine when up next is empty", () => {
    expect(formatQueueSheetTitle(0, 500, "from playlist")).toBe("Queue (500 from playlist)");
  });

  test("returns plain Queue when both counts are zero", () => {
    expect(formatQueueSheetTitle(0, 0, "from library")).toBe("Queue");
  });
});

describe("getSpineSectionLabel", () => {
  test("uses library label for library context", () => {
    expect(getSpineSectionLabel({ type: "library" })).toBe("from library");
  });

  test("uses playlist label for playlist context", () => {
    expect(getSpineSectionLabel({ type: "playlist", playlistId: "p1" })).toBe("from playlist");
  });

  test("uses artist label for artist context", () => {
    expect(getSpineSectionLabel({ type: "artist" })).toBe("from artist");
  });

  test("uses album label for album context", () => {
    expect(getSpineSectionLabel({ type: "album" })).toBe("from album");
  });

  test("uses track label for track context", () => {
    expect(getSpineSectionLabel({ type: "track" })).toBe("from track");
  });

  test("falls back when context is unknown", () => {
    expect(getSpineSectionLabel(null)).toBe("from queue");
  });
});

describe("getSpineSectionHeading", () => {
  test("uses library heading for library context", () => {
    expect(getSpineSectionHeading({ type: "library" })).toBe("From Library");
  });

  test("uses playlist heading for playlist context", () => {
    expect(getSpineSectionHeading({ type: "playlist", playlistId: "p1" })).toBe("From Playlist");
  });

  test("uses artist heading for artist context", () => {
    expect(getSpineSectionHeading({ type: "artist" })).toBe("From Artist");
  });

  test("uses album heading for album context", () => {
    expect(getSpineSectionHeading({ type: "album" })).toBe("From Album");
  });

  test("uses track heading for track context", () => {
    expect(getSpineSectionHeading({ type: "track" })).toBe("From Track");
  });
});

import { expect, test } from "vitest";
import { collapsePlayHistoryByTrack } from "./collapse-history.ts";

test("returns items unchanged when all track ids are unique", () => {
  const items = [
    { id: "play-1", track: { id: "a" } },
    { id: "play-2", track: { id: "b" } },
  ];

  expect(collapsePlayHistoryByTrack(items)).toEqual(items);
});

test("keeps the first (most recent) row for each track id", () => {
  const items = [
    { id: "play-3", track: { id: "a" }, label: "newest-a" },
    { id: "play-2", track: { id: "b" }, label: "b" },
    { id: "play-1", track: { id: "a" }, label: "older-a" },
  ];

  expect(collapsePlayHistoryByTrack(items)).toEqual([
    { id: "play-3", track: { id: "a" }, label: "newest-a" },
    { id: "play-2", track: { id: "b" }, label: "b" },
  ]);
});

test("returns an empty array for empty input", () => {
  expect(collapsePlayHistoryByTrack([])).toEqual([]);
});

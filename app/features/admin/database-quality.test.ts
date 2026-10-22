import { expect, test } from "vitest";
import { percentOfTracksAffected } from "./database-quality.ts";

test("percent of tracks affected stays within 0 and 100 when buckets overlap or include an artist count", () => {
  // Observed buckets: 0 + 10 + 14 + 0 + 2 artists = 26. 26/14 tracks = 185.7%.
  const overlappingBuckets = {
    placeholderTitles: 0,
    suspiciousDurations: 10,
    missingEssentials: 14,
    invalidYears: 0,
    artistsWithoutGenre: 2,
  };
  const totalTracks = 14;
  const summedPercent =
    (Object.values(overlappingBuckets).reduce((sum, count) => sum + count, 0) / totalTracks) * 100;
  expect(summedPercent).toBeGreaterThan(100);

  // Missing essentials already covers every track. Artist rows are not tracks.
  const percent = percentOfTracksAffected(totalTracks, totalTracks);

  expect(percent).toBeGreaterThanOrEqual(0);
  expect(percent).toBeLessThanOrEqual(100);
  expect(percent).toBe(100);
});

test("artists without genre do not count as affected tracks", () => {
  const percent = percentOfTracksAffected(0, 10);

  expect(percent).toBeGreaterThanOrEqual(0);
  expect(percent).toBeLessThanOrEqual(100);
  expect(percent).toBe(0);
});

test("partial overlap uses the distinct track count", () => {
  const percent = percentOfTracksAffected(8, 14);

  expect(percent).toBeGreaterThanOrEqual(0);
  expect(percent).toBeLessThanOrEqual(100);
  expect(percent).toBeCloseTo((8 / 14) * 100);
});

test("returns 0 when there are no tracks", () => {
  expect(percentOfTracksAffected(0, 0)).toBe(0);
  expect(percentOfTracksAffected(3, 0)).toBe(0);
});

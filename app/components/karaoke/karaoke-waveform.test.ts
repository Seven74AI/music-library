import { expect, test } from "vitest";
import {
  validateKaraokeLines,
  type KaraokeLines,
} from "#app/features/track-video/karaoke-lines.ts";
import {
  clampWordMove,
  clampWordTime,
  hitTestWord,
  timeToX,
  xToTime,
  type FlatWord,
} from "./karaoke-waveform.tsx";

const words: FlatWord[] = [
  { l: 0, w: 0, word: "a", start: 10, end: 20 },
  { l: 0, w: 1, word: "b", start: 30, end: 40 },
];

test("timeToX / xToTime round-trip and handle zero duration", () => {
  expect(timeToX(25, 1000, 100)).toBe(250);
  expect(xToTime(250, 1000, 100)).toBe(25);
  expect(xToTime(timeToX(12.34, 800, 60), 800, 60)).toBeCloseTo(12.34);
  expect(timeToX(5, 1000, 0)).toBe(0);
  expect(xToTime(5, 1000, 0)).toBe(0);
  expect(xToTime(5, 0, 10)).toBe(0);
});

test("hitTestWord finds start edge, end edge, middle, and nothing", () => {
  // width 1000, duration 100 → 10px per second; word a spans x 100..200
  expect(hitTestWord(102, 1000, 100, words)).toMatchObject({
    word: words[0],
    edge: "start",
  });
  expect(hitTestWord(198, 1000, 100, words)).toMatchObject({
    word: words[0],
    edge: "end",
  });
  expect(hitTestWord(150, 1000, 100, words)).toMatchObject({
    word: words[0],
    edge: "move",
  });
  expect(hitTestWord(250, 1000, 100, words)).toEqual({
    word: null,
    edge: null,
  });
  expect(hitTestWord(5, 1000, 100, [])).toEqual({ word: null, edge: null });
});

test("clampWordTime keeps start non-decreasing and end ≥ start", () => {
  const word = { start: 10, end: 20 };
  const prev = { start: 5 };
  const next = { start: 30 };
  expect(clampWordTime("start", -3, word, null, next)).toBe(0);
  expect(clampWordTime("start", 2, word, prev, next)).toBe(5);
  expect(clampWordTime("start", 25, word, prev, next)).toBe(20);
  expect(clampWordTime("end", 5, word, prev, next)).toBe(10);
  expect(clampWordTime("end", 35, word, prev, next)).toBe(30);
  expect(clampWordTime("end", 25.12345, word, prev, null)).toBe(25.123);
});

test("clampWordMove: lower bound (prev start) wins over upper bound", () => {
  // prev=0.9, dragged 1.0-2.0 (len 1), next.start=1.5 → hi=0.5 < lo=0.9
  const r = clampWordMove(0.5, 1, { start: 0.9 }, { start: 1.5 });
  expect(r.start).toBe(0.9);
  expect(r.end).toBe(1.9);
  expect(clampWordMove(-5, 1, null, { start: 10 })).toEqual({
    start: 0,
    end: 1,
  });
  expect(clampWordMove(50, 1, { start: 2 }, { start: 10 })).toEqual({
    start: 9,
    end: 10,
  });
  expect(clampWordMove(50, 1, null, null)).toEqual({ start: 50, end: 51 });
});

test("move drag always yields lines that satisfy validateKaraokeLines", () => {
  const base: KaraokeLines = [
    [
      { word: "a", start: 0.9, end: 1.0 },
      { word: "b", start: 1.0, end: 2.0 },
    ],
    [{ word: "c", start: 1.5, end: 2.5 }],
  ];
  expect(validateKaraokeLines(base).success).toBe(true);
  const flat = base.flatMap((line, l) => line.map((x, w) => ({ ...x, l, w })));
  flat.forEach((cur, i) => {
    for (let delta = -5; delta <= 5; delta += 0.07) {
      const moved = clampWordMove(
        cur.start + delta,
        cur.end - cur.start,
        flat[i - 1] ?? null,
        flat[i + 1] ?? null,
      );
      const lines = base.map((line, l) =>
        line.map((x, w) => (l === cur.l && w === cur.w ? { ...x, ...moved } : x)),
      );
      expect(validateKaraokeLines(lines).success, `i=${i} delta=${delta}`).toBe(true);
    }
  });
});

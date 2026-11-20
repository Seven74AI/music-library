import { expect, test } from "vitest";
import {
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

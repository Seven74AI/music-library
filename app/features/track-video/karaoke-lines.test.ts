import { describe, expect, test } from "vitest";
import {
  KARAOKE_MAX_LINES,
  KARAOKE_MAX_WORDS_PER_LINE,
  parseKaraokeLines,
  serializeKaraokeLines,
  validateKaraokeLines,
} from "./karaoke-lines.ts";

const valid = [
  [
    { word: "Hello", start: 0, end: 0.5 },
    { word: "world", start: 0.5, end: 1 },
  ],
  [{ word: "Again", start: 1.2, end: 1.8 }],
];

describe("validateKaraokeLines", () => {
  test("accepts line-grouped words with monotonic times", () => {
    expect(validateKaraokeLines(valid).success).toBe(true);
  });

  test("accepts an empty list of lines", () => {
    expect(validateKaraokeLines([]).success).toBe(true);
  });

  test("rejects a flat word list (lines must be arrays of words)", () => {
    expect(validateKaraokeLines([{ word: "a", start: 0, end: 1 }]).success).toBe(false);
  });

  test("rejects negative times", () => {
    expect(validateKaraokeLines([[{ word: "a", start: -1, end: 1 }]]).success).toBe(false);
  });

  test("rejects end before start", () => {
    expect(validateKaraokeLines([[{ word: "a", start: 2, end: 1 }]]).success).toBe(false);
  });

  test("rejects words that go backwards within a line", () => {
    const lines = [
      [
        { word: "a", start: 1, end: 2 },
        { word: "b", start: 0.5, end: 0.9 },
      ],
    ];
    expect(validateKaraokeLines(lines).success).toBe(false);
  });

  test("rejects a line that starts before the previous line ended", () => {
    const lines = [[{ word: "a", start: 0, end: 2 }], [{ word: "b", start: 1, end: 3 }]];
    expect(validateKaraokeLines(lines).success).toBe(false);
  });

  test("rejects non-finite times", () => {
    expect(validateKaraokeLines([[{ word: "a", start: 0, end: Infinity }]]).success).toBe(false);
    expect(validateKaraokeLines([[{ word: "a", start: NaN, end: 1 }]]).success).toBe(false);
  });

  test("rejects empty words", () => {
    expect(validateKaraokeLines([[{ word: "", start: 0, end: 1 }]]).success).toBe(false);
  });

  test("rejects payloads above the size caps", () => {
    const tooManyLines = Array.from({ length: KARAOKE_MAX_LINES + 1 }, () => []);
    expect(validateKaraokeLines(tooManyLines).success).toBe(false);

    const tooManyWords = [
      Array.from({ length: KARAOKE_MAX_WORDS_PER_LINE + 1 }, () => ({
        word: "a",
        start: 0,
        end: 0,
      })),
    ];
    expect(validateKaraokeLines(tooManyWords).success).toBe(false);
  });
});

describe("parseKaraokeLines / serializeKaraokeLines", () => {
  test("round-trips through JSON string", () => {
    expect(parseKaraokeLines(serializeKaraokeLines(valid))).toEqual(valid);
  });

  test("returns null for invalid JSON or invalid shape", () => {
    expect(parseKaraokeLines("not json")).toBeNull();
    expect(parseKaraokeLines(JSON.stringify([{ word: "a" }]))).toBeNull();
  });

  test("serialize refuses invalid lines", () => {
    expect(() => serializeKaraokeLines([[{ word: "a", start: 3, end: 1 }]])).toThrow();
  });
});

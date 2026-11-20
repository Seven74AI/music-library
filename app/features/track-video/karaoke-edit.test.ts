import { describe, expect, test } from "vitest";
import {
  addLine,
  addWord,
  deleteWord,
  editWordText,
  linesToText,
  mergeWithNext,
  moveWordToLine,
  nudgeWord,
  removeLine,
  setWordTime,
  splitLine,
} from "./karaoke-edit.ts";
import { validateKaraokeLines, type KaraokeLines } from "./karaoke-lines.ts";

const base = (): KaraokeLines => [
  [
    { word: "hello", start: 1, end: 1.5 },
    { word: "big", start: 1.6, end: 2 },
    { word: "world", start: 2, end: 2.5 },
  ],
  [{ word: "bye", start: 3, end: 3.5 }],
];

describe("karaoke-edit", () => {
  test("editWordText changes only the text", () => {
    const out = editWordText(base(), 0, 1, "small");
    expect(out[0]![1]).toEqual({ word: "small", start: 1.6, end: 2 });
  });

  test("nudgeWord moves start/end, rounds to ms, never below 0", () => {
    expect(nudgeWord(base(), 0, 0, "start", 0.05)[0]![0]!.start).toBe(1.05);
    expect(nudgeWord(base(), 0, 0, "end", -0.05)[0]![0]!.end).toBe(1.45);
    expect(nudgeWord(base(), 0, 0, "start", -5)[0]![0]!.start).toBe(0);
  });

  test("setWordTime sets an exact value", () => {
    expect(setWordTime(base(), 1, 0, "end", 4.25)[1]![0]!.end).toBe(4.25);
  });

  test("addWord after inserts a zero-length word that keeps starts monotonic", () => {
    const out = addWord(base(), 0, 0, "after");
    expect(out[0]).toHaveLength(4);
    expect(out[0]![1]).toEqual({ word: "word", start: 1.5, end: 1.5 });
    expect(validateKaraokeLines(out).success).toBe(true);
  });

  test("addWord before inserts at the word's start", () => {
    const out = addWord(base(), 0, 0, "before");
    expect(out[0]![0]).toEqual({ word: "word", start: 1, end: 1 });
    expect(out[0]![1]!.word).toBe("hello");
  });

  test("deleteWord removes the word", () => {
    const out = deleteWord(base(), 0, 1);
    expect(out[0]!.map((w) => w.word)).toEqual(["hello", "world"]);
  });

  test("mergeWithNext concatenates text, spans start..end", () => {
    const out = mergeWithNext(base(), 0, 0);
    expect(out[0]).toEqual([
      { word: "hellobig", start: 1, end: 2 },
      { word: "world", start: 2, end: 2.5 },
    ]);
  });

  test("mergeWithNext on the last word of a line is a no-op", () => {
    expect(mergeWithNext(base(), 0, 2)).toEqual(base());
  });

  test("moveWordToLine: last word to next line goes to its start", () => {
    const out = moveWordToLine(base(), 0, 2, "next");
    expect(out[0]).toHaveLength(2);
    expect(out[1]!.map((w) => w.word)).toEqual(["world", "bye"]);
  });

  test("moveWordToLine: first word to previous line goes to its end", () => {
    const out = moveWordToLine(base(), 1, 0, "prev");
    expect(out[0]!.map((w) => w.word)).toEqual(["hello", "big", "world", "bye"]);
    expect(out[1]).toEqual([]);
  });

  test("moveWordToLine refuses non-edge words and missing lines", () => {
    expect(moveWordToLine(base(), 0, 1, "next")).toEqual(base());
    expect(moveWordToLine(base(), 0, 0, "prev")).toEqual(base());
    expect(moveWordToLine(base(), 1, 0, "next")).toEqual(base());
  });

  test("addLine inserts an empty line after; removeLine only removes empty ones", () => {
    const added = addLine(base(), 0);
    expect(added).toHaveLength(3);
    expect(added[1]).toEqual([]);
    expect(removeLine(added, 1)).toEqual(base());
    expect(removeLine(base(), 0)).toEqual(base());
  });

  test("splitLine breaks a line before the word", () => {
    const out = splitLine(base(), 0, 1);
    expect(out[0]!.map((w) => w.word)).toEqual(["hello"]);
    expect(out[1]!.map((w) => w.word)).toEqual(["big", "world"]);
    expect(out).toHaveLength(3);
  });

  test("operations do not mutate their input", () => {
    const input = base();
    nudgeWord(input, 0, 0, "start", 1);
    deleteWord(input, 0, 0);
    expect(input).toEqual(base());
  });

  test("linesToText joins words with spaces and lines with newlines", () => {
    expect(linesToText(base())).toBe("hello big world\nbye");
    expect(linesToText([[], [{ word: "a", start: 0, end: 1 }]])).toBe("\na");
  });
});

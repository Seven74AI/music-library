import { describe, expect, it } from "vitest";
import { selectKaraokeView } from "./karaoke-active.ts";

const w = (word: string, start: number, end: number) => ({ word, start, end });

const lines = [
  [w("one", 1, 2), w("two", 2, 3)],
  [w("three", 4, 5), w("four", 5, 6)],
  [],
  [w("five", 10, 11)],
  [w("six", 12, 13)],
];

describe("selectKaraokeView", () => {
  it("shows the upcoming lines before the first line starts", () => {
    const v = selectKaraokeView(lines, 0);
    expect(v.currentLineIndex).toBeNull();
    expect(v.activeWordIndex).toBeNull();
    expect(v.visible.map((l) => l.index)).toEqual([0, 1, 2]);
    expect(v.visible.every((l) => l.state === "upcoming")).toBe(true);
  });

  it("selects the current line + next two, and the active word", () => {
    const v = selectKaraokeView(lines, 2.5);
    expect(v.currentLineIndex).toBe(0);
    expect(v.activeWordIndex).toBe(1);
    expect(v.visible).toEqual([
      { index: 0, state: "current" },
      { index: 1, state: "upcoming" },
      { index: 2, state: "upcoming" },
    ]);
  });

  it("counts finished words on the current line", () => {
    expect(selectKaraokeView(lines, 2.5).sungWordCount).toBe(1);
    expect(selectKaraokeView(lines, 1.5).sungWordCount).toBe(0);
  });

  it("treats word/line spans as [start, end)", () => {
    expect(selectKaraokeView(lines, 2).activeWordIndex).toBe(1);
    expect(selectKaraokeView(lines, 3).currentLineIndex).toBeNull();
  });

  it("instrumental gap between lines shows upcoming lines", () => {
    const v = selectKaraokeView(lines, 7);
    expect(v.currentLineIndex).toBeNull();
    expect(v.activeWordIndex).toBeNull();
    // empty line 2 is skipped; next sung line is 3
    expect(v.visible).toEqual([
      { index: 3, state: "upcoming" },
      { index: 4, state: "upcoming" },
    ]);
  });

  it("never selects an empty line as current", () => {
    expect(selectKaraokeView(lines, 9).currentLineIndex).toBeNull();
  });

  it("renders empty lines after the current line as spacers", () => {
    const v = selectKaraokeView(lines, 4.5);
    expect(v.currentLineIndex).toBe(1);
    expect(v.visible.map((l) => l.index)).toEqual([1, 2, 3]);
  });

  it("returns nothing visible after the last line", () => {
    const v = selectKaraokeView(lines, 20);
    expect(v.currentLineIndex).toBeNull();
    expect(v.visible).toEqual([]);
  });

  it("handles empty input", () => {
    expect(selectKaraokeView([], 5).visible).toEqual([]);
  });

  it("picks the first line when spans overlap", () => {
    const overlap = [[w("a", 1, 3)], [w("b", 2, 4)]];
    expect(selectKaraokeView(overlap, 2.5).currentLineIndex).toBe(0);
  });
});

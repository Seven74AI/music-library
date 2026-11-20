import { type KaraokeLines } from "./karaoke-lines.ts";

export const KARAOKE_VISIBLE_LINES = 3;

export type KaraokeVisibleLine = { index: number; state: "current" | "upcoming" };

export type KaraokeView = {
  /** Index of the line whose [first.start, last.end) contains t, else null. */
  currentLineIndex: number | null;
  /** Index (within the current line) of the word whose [start, end) contains t. */
  activeWordIndex: number | null;
  /** Words of the current line already finished (end <= t). */
  sungWordCount: number;
  /** Up to 3 lines to render, in order. Completed lines are never included. */
  visible: KaraokeVisibleLine[];
};

/**
 * Pure selection of what the karaoke overlay shows at audio time `t` (seconds).
 * Empty lines (instrumental gaps) never become current; they render as spacers
 * only when they fall inside the visible window.
 */
export function selectKaraokeView(lines: KaraokeLines, t: number): KaraokeView {
  let currentLineIndex: number | null = null;
  let firstUpcoming: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.length === 0) continue;
    const start = line[0]!.start;
    const end = line[line.length - 1]!.end;
    if (t >= start && t < end) {
      currentLineIndex = i;
      break;
    }
    if (firstUpcoming === null && start > t) firstUpcoming = i;
  }

  const from = currentLineIndex ?? firstUpcoming;
  const visible: KaraokeVisibleLine[] = [];
  if (from !== null) {
    for (let i = from; i < lines.length && visible.length < KARAOKE_VISIBLE_LINES; i++) {
      visible.push({ index: i, state: i === currentLineIndex ? "current" : "upcoming" });
    }
  }

  let activeWordIndex: number | null = null;
  let sungWordCount = 0;
  if (currentLineIndex !== null) {
    const current = lines[currentLineIndex]!;
    const idx = current.findIndex((word) => t >= word.start && t < word.end);
    activeWordIndex = idx === -1 ? null : idx;
    sungWordCount = current.filter((word) => word.end <= t).length;
  }

  return { currentLineIndex, activeWordIndex, sungWordCount, visible };
}

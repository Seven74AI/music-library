import { type KaraokeLines, type KaraokeWord } from "./karaoke-lines.ts";

/** Pure, immutable edit operations over the karaoke `lines` structure. */

type TimeField = "start" | "end";

const round = (n: number) => Math.round(n * 1000) / 1000;

function cloneLines(lines: KaraokeLines): KaraokeLines {
  return lines.map((line) => line.map((w) => ({ ...w })));
}

function wordAt(lines: KaraokeLines, l: number, w: number) {
  return lines[l]?.[w];
}

function updateWord(
  lines: KaraokeLines,
  l: number,
  w: number,
  patch: Partial<KaraokeWord>,
): KaraokeLines {
  if (!wordAt(lines, l, w)) return lines;
  const out = cloneLines(lines);
  out[l]![w] = { ...out[l]![w]!, ...patch };
  return out;
}

export function editWordText(lines: KaraokeLines, l: number, w: number, text: string) {
  return updateWord(lines, l, w, { word: text });
}

export function setWordTime(
  lines: KaraokeLines,
  l: number,
  w: number,
  field: TimeField,
  value: number,
) {
  return updateWord(lines, l, w, { [field]: Math.max(0, round(value)) });
}

export function nudgeWord(
  lines: KaraokeLines,
  l: number,
  w: number,
  field: TimeField,
  delta: number,
) {
  const word = wordAt(lines, l, w);
  if (!word) return lines;
  return setWordTime(lines, l, w, field, word[field] + delta);
}

/** First word of the whole structure that comes after (l, w), if any. */
function nextWordStart(lines: KaraokeLines, l: number, w: number): number | null {
  for (let i = l; i < lines.length; i++) {
    const from = i === l ? w + 1 : 0;
    const next = lines[i]!.slice(from)[0];
    if (next) return next.start;
  }
  return null;
}

/**
 * Insert a placeholder word before/after (l, w). It is zero-length and sits at
 * a boundary so global start-monotonicity is preserved; the user then sets times.
 */
export function addWord(
  lines: KaraokeLines,
  l: number,
  w: number,
  where: "before" | "after",
): KaraokeLines {
  const ref = wordAt(lines, l, w);
  if (!ref) return lines;
  const out = cloneLines(lines);
  if (where === "before") {
    out[l]!.splice(w, 0, { word: "word", start: ref.start, end: ref.start });
  } else {
    const next = nextWordStart(lines, l, w);
    const at = next === null ? ref.end : Math.min(ref.end, next);
    out[l]!.splice(w + 1, 0, { word: "word", start: Math.max(at, ref.start), end: Math.max(at, ref.start) });
  }
  return out;
}

export function deleteWord(lines: KaraokeLines, l: number, w: number): KaraokeLines {
  if (!wordAt(lines, l, w)) return lines;
  const out = cloneLines(lines);
  out[l]!.splice(w, 1);
  return out;
}

/** Merge word w with the next word of the same line (no-op on the last word). */
export function mergeWithNext(lines: KaraokeLines, l: number, w: number): KaraokeLines {
  const a = wordAt(lines, l, w);
  const b = wordAt(lines, l, w + 1);
  if (!a || !b) return lines;
  const out = cloneLines(lines);
  out[l]!.splice(w, 2, { word: a.word + b.word, start: a.start, end: b.end });
  return out;
}

/**
 * Move the first word of a line to the end of the previous line, or the last
 * word to the start of the next line (the only moves that keep global order).
 */
export function moveWordToLine(
  lines: KaraokeLines,
  l: number,
  w: number,
  dir: "prev" | "next",
): KaraokeLines {
  const word = wordAt(lines, l, w);
  const target = dir === "prev" ? l - 1 : l + 1;
  if (!word || !lines[target]) return lines;
  const isEdge = dir === "prev" ? w === 0 : w === lines[l]!.length - 1;
  if (!isEdge) return lines;
  const out = cloneLines(lines);
  out[l]!.splice(w, 1);
  if (dir === "prev") out[target]!.push(word);
  else out[target]!.unshift(word);
  return out;
}

export function addLine(lines: KaraokeLines, afterLine: number): KaraokeLines {
  const out = cloneLines(lines);
  out.splice(afterLine + 1, 0, []);
  return out;
}

/** Only empty lines can be removed (never drops words). */
export function removeLine(lines: KaraokeLines, l: number): KaraokeLines {
  if (!lines[l] || lines[l]!.length > 0) return lines;
  const out = cloneLines(lines);
  out.splice(l, 1);
  return out;
}

/** Line break before word w: words w.. move to a new following line. */
export function splitLine(lines: KaraokeLines, l: number, w: number): KaraokeLines {
  if (!lines[l] || w <= 0 || w >= lines[l]!.length) return lines;
  const out = cloneLines(lines);
  const tail = out[l]!.splice(w);
  out.splice(l + 1, 0, tail);
  return out;
}

export function linesToText(lines: KaraokeLines): string {
  return lines.map((line) => line.map((w) => w.word).join(" ")).join("\n");
}

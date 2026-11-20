import { z } from "zod";

/** Sane caps so a malicious/buggy client can't store an unbounded blob. */
export const KARAOKE_MAX_LINES = 500;
export const KARAOKE_MAX_WORDS_PER_LINE = 200;
export const KARAOKE_MAX_WORD_LENGTH = 100;

const WordSchema = z
  .object({
    word: z.string().min(1).max(KARAOKE_MAX_WORD_LENGTH),
    start: z.number().finite().min(0),
    end: z.number().finite().min(0),
  })
  .refine((w) => w.end >= w.start, { message: "word end must be >= start" });

const LinesBaseSchema = z
  .array(z.array(WordSchema).max(KARAOKE_MAX_WORDS_PER_LINE))
  .max(KARAOKE_MAX_LINES);

/**
 * `lines` = array of lines, each an array of `{ word, start, end }` (seconds).
 * Times are monotonic across the whole structure: each word starts at or after
 * the previous word's start, and no word starts before the previous one ended.
 * Line start/end are derived (first/last word), never stored.
 */
export const karaokeLinesSchema = LinesBaseSchema.superRefine((lines, ctx) => {
  let prevEnd = 0;
  let prevStart = 0;
  for (let l = 0; l < lines.length; l++) {
    const line = lines[l]!;
    for (let w = 0; w < line.length; w++) {
      const word = line[w]!;
      if (word.start < prevStart || word.start < prevEnd) {
        ctx.addIssue({
          code: "custom",
          path: [l, w, "start"],
          message: "word times must be monotonic",
        });
        return;
      }
      prevStart = word.start;
      prevEnd = word.end;
    }
  }
});

export type KaraokeWord = { word: string; start: number; end: number };
export type KaraokeLines = KaraokeWord[][];

export function validateKaraokeLines(input: unknown) {
  return karaokeLinesSchema.safeParse(input);
}

/** Parse the JSON-string `lines` column. Returns null when invalid. */
export function parseKaraokeLines(json: string): KaraokeLines | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const result = validateKaraokeLines(raw);
  return result.success ? result.data : null;
}

/** Validate then stringify for the `lines` column. Throws on invalid input. */
export function serializeKaraokeLines(lines: unknown): string {
  const result = validateKaraokeLines(lines);
  if (!result.success) {
    throw new Error(`Invalid karaoke lines: ${result.error.message}`);
  }
  return JSON.stringify(result.data);
}

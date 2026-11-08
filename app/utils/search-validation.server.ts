/**
 * Security validation for search queries
 * Prevents SQL injection, XSS, and DoS attacks
 */

import { z } from "zod";

/**
 * Maximum query length to prevent DoS attacks
 * FTS5 queries can be expensive, so we limit query length
 */
const MAX_QUERY_LENGTH = 200;

/**
 * Maximum number of words in a query to prevent complex queries
 */
const MAX_QUERY_WORDS = 20;

/**
 * Search query validation schema
 * Validates DoS limits (length, word count). Punctuation-only queries are allowed
 * through; the FTS literalizer returns empty MATCH and the API returns empty results.
 */
export const SearchQuerySchema = z
  .string()
  .min(1, "Query cannot be empty")
  .max(MAX_QUERY_LENGTH, `Query cannot exceed ${MAX_QUERY_LENGTH} characters`)
  .trim()
  .refine(
    (query) => {
      // Count words (split by whitespace)
      const words = query.split(/\s+/).filter((w) => w.length > 0);
      return words.length <= MAX_QUERY_WORDS;
    },
    {
      message: `Query cannot exceed ${MAX_QUERY_WORDS} words`,
    },
  );

/**
 * Search limit validation schema
 */
export const SearchLimitSchema = z
  .number()
  .int()
  .min(1, "Limit must be at least 1")
  .max(100, "Limit cannot exceed 100");

/**
 * Search type validation schema
 */
export const SearchTypeSchema = z.enum(["all", "tracks", "albums", "artists", "playlists"]);

/**
 * Search scope validation schema
 */
export const SearchScopeSchema = z.enum(["all", "library"]);

export type CursorSortTuple = {
  rk: number;
  fr: number;
  n: string;
  id: string;
};

export const INVALID_CURSOR_FORMAT_MESSAGE = "Invalid cursor format";

export function isInvalidCursorFormatError(error: unknown): boolean {
  return error instanceof Error && error.message === INVALID_CURSOR_FORMAT_MESSAGE;
}

/** Validates a single keyset pagination tuple inside a composite cursor. */
export function isCursorSortTuple(value: unknown): value is CursorSortTuple {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.rk === "number" &&
    typeof v.fr === "number" &&
    typeof v.n === "string" &&
    typeof v.id === "string"
  );
}

/** Decodes one composite-cursor arm; absent or null arms are allowed, invalid shapes are not. */
export function decodeCursorArm(
  parsed: Record<string, unknown>,
  key: string,
): CursorSortTuple | null {
  if (!(key in parsed) || parsed[key] == null) return null;
  const arm = parsed[key];
  if (!isCursorSortTuple(arm)) {
    throw new Error(INVALID_CURSOR_FORMAT_MESSAGE);
  }
  return arm;
}

const COMPOSITE_CURSOR_ARM_KEYS = ["t", "a", "ar", "p"] as const;

/**
 * Each cursor arm that is present (not undefined) must be null or a valid sort tuple.
 */
export function compositeCursorArmsValid(
  parsed: Record<string, unknown>,
  armKeys: readonly string[] = COMPOSITE_CURSOR_ARM_KEYS,
): boolean {
  for (const key of armKeys) {
    if (!(key in parsed)) continue;
    const arm = parsed[key];
    if (arm === null || arm === undefined) continue;
    if (!isCursorSortTuple(arm)) return false;
  }
  return true;
}

/**
 * Cursor validation schema
 * Validates composite cursor: base64-encoded JSON with optional per-type sort tuples
 */
const CURSOR_REGEX = /^[A-Za-z0-9+/=]+$/;

export const CursorSchema = z
  .string()
  .optional()
  .refine(
    (cursor) => {
      if (!cursor) return true;
      if (!CURSOR_REGEX.test(cursor)) return false;
      try {
        const decoded = Buffer.from(cursor, "base64").toString("utf-8");
        const parsed = JSON.parse(decoded) as unknown;
        if (typeof parsed !== "object" || parsed === null) return false;
        return compositeCursorArmsValid(parsed as Record<string, unknown>);
      } catch {
        return false;
      }
    },
    { message: "Invalid cursor format" },
  );

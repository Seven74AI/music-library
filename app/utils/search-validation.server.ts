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
 * Validates and sanitizes user input for search queries
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
  )
  .refine(
    (query) => {
      // Reject queries with only special characters (potential injection attempts)
      const hasAlphanumeric = /[a-zA-Z0-9]/.test(query);
      return hasAlphanumeric;
    },
    {
      message: "Query must contain at least one alphanumeric character",
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
        return typeof parsed === "object" && parsed !== null;
      } catch {
        return false;
      }
    },
    { message: "Invalid cursor format" },
  );

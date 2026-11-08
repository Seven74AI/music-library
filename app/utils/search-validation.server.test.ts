import { describe, expect, test } from "vitest";
import {
  CursorSchema,
  SearchLimitSchema,
  SearchQuerySchema,
  SearchTypeSchema,
} from "./search-validation.server.ts";

describe("search-validation.server", () => {
  test("rejects empty search query", () => {
    const result = SearchQuerySchema.safeParse("");
    expect(result.success).toBe(false);
  });

  test("rejects missing query parameter value", () => {
    const result = SearchQuerySchema.safeParse("");
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/empty/i);
    }
  });

  test("accepts valid search query", () => {
    const result = SearchQuerySchema.safeParse("test track");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("test track");
    }
  });

  test("accepts punctuation-only query (literalizer returns empty MATCH)", () => {
    const result = SearchQuerySchema.safeParse("-");
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe("-");
    }
  });

  test("accepts hyphenated artist-style query", () => {
    const result = SearchQuerySchema.safeParse("AC-DC");
    expect(result.success).toBe(true);
  });

  test("rejects invalid search limit", () => {
    const result = SearchLimitSchema.safeParse(Number.NaN);
    expect(result.success).toBe(false);
  });

  test("accepts valid search type", () => {
    const result = SearchTypeSchema.safeParse("tracks");
    expect(result.success).toBe(true);
  });

  test("accepts undefined cursor", () => {
    const result = CursorSchema.safeParse(undefined);
    expect(result.success).toBe(true);
  });

  test("accepts valid composite cursor with sort tuples", () => {
    const payload = {
      t: { rk: 1, fr: 0.5, n: "track", id: "t1" },
      a: null,
    };
    const cursor = Buffer.from(JSON.stringify(payload)).toString("base64");
    const result = CursorSchema.safeParse(cursor);
    expect(result.success).toBe(true);
  });

  test("rejects cursor with malformed sort tuple arm", () => {
    const payload = { t: { rk: 1, fr: "bad", n: "x", id: "y" } };
    const cursor = Buffer.from(JSON.stringify(payload)).toString("base64");
    const result = CursorSchema.safeParse(cursor);
    expect(result.success).toBe(false);
  });

  test("accepts playlists search type", () => {
    const result = SearchTypeSchema.safeParse("playlists");
    expect(result.success).toBe(true);
  });
});

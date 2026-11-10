import { describe, expect, test } from "vitest";
import {
  cursorClause,
  decodeSearchCursor,
  encodeSearchCursor,
  lastCursorTuple,
} from "./search-fts.server.ts";

describe("search-fts cursor helpers", () => {
  test("cursorClause builds keyset predicate with stable param order", () => {
    const tuple = { rk: 2, fr: 0.5, n: "beta", id: "id-2" };
    const { sql, params } = cursorClause(tuple, "relevance_rank", "fts_rank", "t.title", "t.id");
    expect(sql).toContain("relevance_rank > ?");
    expect(params).toEqual([2, 2, 0.5, 2, 0.5, "beta", 2, 0.5, "beta", "id-2"]);
  });

  test("encode and decode round-trip cursor arms", () => {
    const encoded = encodeSearchCursor({
      t: { rk: 1, fr: 0, n: "a", id: "1" },
      a: null,
    });
    const decoded = decodeSearchCursor(encoded, ["t", "a", "ar"]);
    expect(decoded.t).toEqual({ rk: 1, fr: 0, n: "a", id: "1" });
    expect(decoded.a).toBeNull();
    expect(decoded.ar).toBeNull();
  });

  test("lastCursorTuple maps row fields", () => {
    expect(
      lastCursorTuple({ relevance_rank: 3, fts_rank: 1n, title: "Song", id: "x" }, "title"),
    ).toEqual({ rk: 3, fr: 1, n: "Song", id: "x" });
  });
});

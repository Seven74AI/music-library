import { describe, expect, it } from "vitest";
import { parseByteRangeHeader } from "./http-byte-range.server.ts";

describe("parseByteRangeHeader", () => {
  it("parses a partial range for storage streaming", () => {
    const parsed = parseByteRangeHeader("bytes=1-3", 5);
    expect(parsed).toEqual({ kind: "partial", start: 1, end: 3 });
  });

  it("marks ranges past EOF as unsatisfiable", () => {
    expect(parseByteRangeHeader("bytes=10-", 5).kind).toBe("unsatisfiable");
  });
});

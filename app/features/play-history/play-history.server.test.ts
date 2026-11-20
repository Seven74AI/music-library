import { describe, expect, test } from "vitest";
import { parseHistoryCursor, serializeHistoryCursor } from "./play-history.server.ts";

describe("parseHistoryCursor", () => {
  test("returns null when the cursor param is absent", () => {
    expect(parseHistoryCursor(null)).toBeNull();
  });

  test("round-trips a valid cursor", () => {
    const createdAt = new Date("2026-01-15T12:00:00.000Z");
    const raw = serializeHistoryCursor({ createdAt, id: "evt-1" });
    expect(parseHistoryCursor(raw)).toEqual({ createdAt, id: "evt-1" });
  });

  test("throws on malformed cursor instead of returning null", () => {
    expect(() => parseHistoryCursor("not-valid")).toThrow();
    expect(() => parseHistoryCursor("abc_")).toThrow();
  });
});

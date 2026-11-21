import { describe, expect, test } from "vitest";
import { isRoomKind } from "./constants.ts";

describe("isRoomKind", () => {
  test("accepts valid kinds", () => {
    expect(isRoomKind("party")).toBe(true);
    expect(isRoomKind("karaoke")).toBe(true);
  });

  test("rejects invalid values", () => {
    expect(isRoomKind("Party")).toBe(false);
    expect(isRoomKind("")).toBe(false);
    expect(isRoomKind(null)).toBe(false);
    expect(isRoomKind(undefined)).toBe(false);
    expect(isRoomKind(1)).toBe(false);
  });
});

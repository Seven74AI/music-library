import { describe, expect, test } from "vitest";
import { coerceOptionalInt, pickIntField } from "./track-metadata-int.server.ts";

describe("track-metadata-int", () => {
  test("coerceOptionalInt rounds finite numbers and drops non-finite", () => {
    expect(coerceOptionalInt(2020.9)).toBe(2021);
    expect(coerceOptionalInt(128.4)).toBe(128);
    expect(coerceOptionalInt(Number.NaN)).toBeUndefined();
    expect(coerceOptionalInt(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(coerceOptionalInt(null)).toBeUndefined();
    expect(coerceOptionalInt(undefined)).toBeUndefined();
  });

  test("pickIntField returns the first coercible candidate", () => {
    expect(pickIntField(undefined, Number.NaN, 12.8)).toBe(13);
    expect(pickIntField(null, "2020.2")).toBe(2020);
    expect(pickIntField(Number.NaN)).toBeNull();
  });
});

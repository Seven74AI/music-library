import { describe, expect, test } from "vitest";
import { applySortDirection, oppositeSortDirection, parseSortDirection } from "./sort-direction.ts";

describe("parseSortDirection", () => {
  test("defaults to fallback for unknown or missing values", () => {
    expect(parseSortDirection(null)).toBe("desc");
    expect(parseSortDirection(undefined, "asc")).toBe("asc");
    expect(parseSortDirection("nope", "asc")).toBe("asc");
  });

  test("accepts asc and desc", () => {
    expect(parseSortDirection("asc")).toBe("asc");
    expect(parseSortDirection("desc")).toBe("desc");
  });
});

describe("oppositeSortDirection", () => {
  test("toggles between asc and desc", () => {
    expect(oppositeSortDirection("asc")).toBe("desc");
    expect(oppositeSortDirection("desc")).toBe("asc");
  });
});

describe("applySortDirection", () => {
  test("keeps ascending comparisons and flips for descending", () => {
    expect(applySortDirection(-1, "asc")).toBe(-1);
    expect(applySortDirection(-1, "desc")).toBe(1);
    expect(applySortDirection(2, "desc")).toBe(-2);
  });
});

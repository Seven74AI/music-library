import { describe, expect, test } from "vitest";
import { getUtcMonthEndExclusive, getUtcMonthStart } from "./utc-month.ts";

describe("getUtcMonthStart", () => {
  test("returns the first instant of the UTC calendar month", () => {
    expect(getUtcMonthStart(new Date("2026-09-23T15:30:00.000Z")).toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
  });

  test("keeps January on year boundary", () => {
    expect(getUtcMonthStart(new Date("2026-01-01T00:00:00.000Z")).toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
  });
});

describe("getUtcMonthEndExclusive", () => {
  test("returns the first instant of the next UTC month", () => {
    expect(getUtcMonthEndExclusive(new Date("2026-09-23T15:30:00.000Z")).toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
  });

  test("rolls year for December", () => {
    expect(getUtcMonthEndExclusive(new Date("2026-12-15T12:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
  });
});

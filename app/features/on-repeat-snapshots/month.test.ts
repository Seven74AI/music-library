import { describe, expect, test } from "vitest";
import {
  formatYearMonth,
  formatYearMonthLabel,
  getPreviousCalendarMonthUtc,
  yearMonthToUtcWindow,
} from "./month.ts";

describe("formatYearMonth", () => {
  test("formats UTC year-month with zero-padded month", () => {
    expect(formatYearMonth(new Date(Date.UTC(2026, 8, 1)))).toBe("2026-09");
    expect(formatYearMonth(new Date(Date.UTC(2026, 0, 15)))).toBe("2026-01");
  });
});

describe("yearMonthToUtcWindow", () => {
  test("returns exclusive UTC window for a month", () => {
    const { windowStart, windowEndExclusive } = yearMonthToUtcWindow("2026-09");
    expect(windowStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(windowEndExclusive.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test("rejects invalid yearMonth", () => {
    expect(() => yearMonthToUtcWindow("2026-13")).toThrow(/Invalid yearMonth/);
    expect(() => yearMonthToUtcWindow("sep-2026")).toThrow(/Invalid yearMonth/);
  });
});

describe("getPreviousCalendarMonthUtc", () => {
  test("on 1 Oct ranks September", () => {
    const result = getPreviousCalendarMonthUtc(new Date(Date.UTC(2026, 9, 1)));
    expect(result.yearMonth).toBe("2026-09");
    expect(result.windowStart.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(result.windowEndExclusive.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });

  test("in January returns previous year's December", () => {
    const result = getPreviousCalendarMonthUtc(new Date(Date.UTC(2026, 0, 15)));
    expect(result.yearMonth).toBe("2025-12");
    expect(result.windowStart.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(result.windowEndExclusive.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("formatYearMonthLabel", () => {
  test("returns long month name and year", () => {
    expect(formatYearMonthLabel("2026-09")).toBe("September 2026");
  });
});

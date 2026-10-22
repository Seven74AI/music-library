import { describe, expect, test } from "vitest";
import { formatServiceDateAdded, getServiceDateAdded } from "./service-date.ts";

describe("getServiceDateAdded", () => {
  test("prefers releaseDate (YouTube publication / metadata)", () => {
    const date = getServiceDateAdded({
      releaseDate: "2009-10-25T06:57:33.000Z",
      originalDate: "2008-01-01T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
    });
    expect(date?.toISOString()).toBe("2009-10-25T06:57:33.000Z");
  });

  test("falls back to originalDate then createdAt", () => {
    expect(
      getServiceDateAdded({
        releaseDate: null,
        originalDate: "2010-05-01T00:00:00.000Z",
        createdAt: "2024-01-01T00:00:00.000Z",
      })?.toISOString(),
    ).toBe("2010-05-01T00:00:00.000Z");

    expect(
      getServiceDateAdded({
        releaseDate: null,
        originalDate: null,
        createdAt: "2024-06-15T12:00:00.000Z",
      })?.toISOString(),
    ).toBe("2024-06-15T12:00:00.000Z");
  });

  test("returns null when no dates are available", () => {
    expect(getServiceDateAdded({})).toBeNull();
  });
});

describe("formatServiceDateAdded", () => {
  test("formats a valid date for display", () => {
    expect(formatServiceDateAdded({ releaseDate: "2009-10-25T06:57:33.000Z" })).toBe(
      new Date("2009-10-25T06:57:33.000Z").toLocaleDateString(),
    );
  });
});

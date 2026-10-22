import { describe, expect, test } from "vitest";
import { formatRelativeTime } from "./format-relative-time.ts";

const NOW = new Date("2026-08-30T12:00:00.000Z");

function ago(seconds: number) {
  return new Date(NOW.getTime() - seconds * 1000);
}

describe("formatRelativeTime", () => {
  test("shows 'just now' under a minute (and for future timestamps)", () => {
    expect(formatRelativeTime(ago(0), NOW)).toBe("just now");
    expect(formatRelativeTime(ago(59), NOW)).toBe("just now");
    expect(formatRelativeTime(new Date(NOW.getTime() + 5_000), NOW)).toBe("just now");
  });

  test("shows minutes under an hour", () => {
    expect(formatRelativeTime(ago(60), NOW)).toBe("1min ago");
    expect(formatRelativeTime(ago(5 * 60), NOW)).toBe("5min ago");
    expect(formatRelativeTime(ago(59 * 60 + 59), NOW)).toBe("59min ago");
  });

  test("shows hours under a day", () => {
    expect(formatRelativeTime(ago(60 * 60), NOW)).toBe("1h ago");
    expect(formatRelativeTime(ago(23 * 60 * 60 + 59 * 60), NOW)).toBe("23h ago");
  });

  test("shows days under a week", () => {
    expect(formatRelativeTime(ago(24 * 60 * 60), NOW)).toBe("1 day ago");
    expect(formatRelativeTime(ago(3 * 24 * 60 * 60), NOW)).toBe("3 days ago");
  });

  test("falls back to a short absolute date after a week", () => {
    const result = formatRelativeTime(ago(8 * 24 * 60 * 60), NOW);
    expect(result).toMatch(/\d{4}/);
    expect(result).not.toContain("ago");
  });
});

import { describe, expect, test } from "vitest";
import { formatFileSize } from "./format-file-size.ts";

describe("formatFileSize", () => {
  test("returns N/A for missing or zero bytes", () => {
    expect(formatFileSize(null)).toBe("N/A");
    expect(formatFileSize(undefined)).toBe("N/A");
    expect(formatFileSize(0)).toBe("N/A");
  });

  test("uses MB at or above 1 MiB with one decimal (track detail display)", () => {
    expect(formatFileSize(2 * 1024 * 1024)).toBe("2.0 MB");
    expect(formatFileSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
  });

  test("uses KB below 1 MiB and bytes below 1 KiB", () => {
    expect(formatFileSize(500_000)).toBe("488 KB");
    expect(formatFileSize(500)).toBe("500 B");
    expect(formatFileSize(1024)).toBe("1 KB");
  });
});

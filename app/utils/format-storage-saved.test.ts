import { expect, test } from "vitest";
import { formatStorageSaved } from "./format-storage-saved.ts";

test("formats exact megabyte and kilobyte sizes without a fake estimate", () => {
  expect(formatStorageSaved(5 * 1024 * 1024)).toBe("5 MB");
  expect(formatStorageSaved(1.5 * 1024 * 1024)).toBe("1.5 MB");
  expect(formatStorageSaved(1536)).toBe("1.5 KB");
  expect(formatStorageSaved(1024)).toBe("1 KB");
});

test("formats sub-kilobyte and zero sizes in bytes", () => {
  expect(formatStorageSaved(512)).toBe("512 B");
  expect(formatStorageSaved(0)).toBe("0 B");
});

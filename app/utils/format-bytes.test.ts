import { expect, test } from "vitest";
import { FILE_SIZE_DETAIL_FORMAT, formatBytes, STORAGE_SAVED_FORMAT } from "./format-bytes.ts";

// Reference copies of the pre-unification implementations. They pin that the
// canonical formatter renders identical output for every call-site preset.
function legacyLog(bytes: number, sizes: string[]): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function legacyFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "N/A";
  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  const kilobytes = bytes / 1024;
  if (kilobytes >= 1) return `${Math.round(kilobytes)} KB`;
  return `${bytes} B`;
}

function legacyStorageSaved(bytes: number): string {
  const trim = (v: number) => {
    const r = Math.round(v * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes >= 1024 * 1024) return `${trim(bytes / (1024 * 1024))} MB`;
  if (bytes >= 1024) return `${trim(bytes / 1024)} KB`;
  return `${Math.round(bytes)} B`;
}

function legacyOrphaned(bytes: number | null): string {
  if (!bytes) return "0 B";
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

const SAMPLES = [
  0,
  1,
  7,
  512,
  1023,
  1024,
  1025,
  1536,
  2047,
  2048,
  10_000,
  1024 * 1023,
  1024 * 1024 - 1,
  1024 * 1024,
  1024 * 1024 + 1,
  1.5 * 1024 * 1024,
  5 * 1024 * 1024,
  123_456_789,
  1024 ** 3 - 1,
  1024 ** 3,
  3.7 * 1024 ** 3,
  1024 ** 4 - 1,
  1024 ** 4,
  2.5 * 1024 ** 4,
];

test("default format matches the log-based admin formatters", () => {
  for (const n of SAMPLES) {
    expect(formatBytes(n)).toBe(legacyLog(n, ["B", "KB", "MB", "GB", "TB"]));
  }
});

test("null renders the nullLabel, zero stays 0 B", () => {
  expect(formatBytes(null, { nullLabel: "—" })).toBe("—");
  expect(formatBytes(0, { nullLabel: "—" })).toBe("0 B");
  expect(formatBytes(null)).toBe("0 B");
});

test("FILE_SIZE_DETAIL_FORMAT matches the former formatFileSize", () => {
  for (const n of [...SAMPLES, null, undefined]) {
    expect(formatBytes(n, FILE_SIZE_DETAIL_FORMAT)).toBe(legacyFileSize(n));
  }
});

test("STORAGE_SAVED_FORMAT matches the former formatStorageSaved", () => {
  for (const n of [...SAMPLES, -5, NaN, Infinity]) {
    expect(formatBytes(n, STORAGE_SAVED_FORMAT)).toBe(legacyStorageSaved(n));
  }
  expect(formatBytes(5 * 1024 * 1024, STORAGE_SAVED_FORMAT)).toBe("5 MB");
  expect(formatBytes(1536, STORAGE_SAVED_FORMAT)).toBe("1.5 KB");
  expect(formatBytes(512, STORAGE_SAVED_FORMAT)).toBe("512 B");
  expect(formatBytes(0, STORAGE_SAVED_FORMAT)).toBe("0 B");
});

test("KB-floor MB-ceiling one-decimal preset matches the former orphaned-tracks formatter", () => {
  const opts = { minUnit: "KB", maxUnit: "MB", decimals: 1 } as const;
  for (const n of [...SAMPLES, null]) {
    expect(formatBytes(n, opts)).toBe(legacyOrphaned(n));
  }
});

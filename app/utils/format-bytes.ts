/**
 * The ONE canonical byte-size formatter. Do not write local copies; an
 * inventory test (`format-bytes.inventory.test.ts`) fails if one appears.
 * Per-surface differences are expressed through options, not new functions.
 */
export type ByteUnit = "B" | "KB" | "MB" | "GB" | "TB";

const UNITS: readonly ByteUnit[] = ["B", "KB", "MB", "GB", "TB"];

export type FormatBytesOptions = {
  /** Smallest unit to display (default "B"). With "KB", 500 bytes → "0.5 KB". */
  minUnit?: ByteUnit;
  /** Largest unit to display (default "TB"). */
  maxUnit?: ByteUnit;
  /** Fraction digits, overall or per unit (default 2). */
  decimals?: number | Partial<Record<ByteUnit, number>>;
  /** Round to one decimal and drop a trailing ".0" (e.g. "5 MB", "1.5 KB"). */
  trimTrailingZero?: boolean;
  /** Returned for null/undefined (default: same as `zeroLabel`). */
  nullLabel?: string;
  /** Returned for 0, negative or non-finite input (default "0 B"). */
  zeroLabel?: string;
};

/** Track audio detail row: "1.2 MB", "512 KB", "N/A" when unknown/zero. */
export const FILE_SIZE_DETAIL_FORMAT = {
  maxUnit: "MB",
  decimals: { B: 0, KB: 0, MB: 1 },
  zeroLabel: "N/A",
} as const satisfies FormatBytesOptions;

/** Upload duplicate details: "5 MB", "1.5 KB", "512 B". */
export const STORAGE_SAVED_FORMAT = {
  maxUnit: "MB",
  trimTrailingZero: true,
} as const satisfies FormatBytesOptions;

export function formatBytes(
  bytes: number | null | undefined,
  options: FormatBytesOptions = {},
): string {
  const { minUnit = "B", maxUnit = "TB", decimals = 2, trimTrailingZero = false } = options;
  const zeroLabel = options.zeroLabel ?? "0 B";
  if (bytes == null) return options.nullLabel ?? zeroLabel;
  if (!Number.isFinite(bytes) || bytes <= 0) return zeroLabel;

  const min = UNITS.indexOf(minUnit);
  const max = UNITS.indexOf(maxUnit);
  let index = min;
  while (index < max && bytes >= 1024 ** (index + 1)) index++;

  const unit = UNITS[index]!;
  const digits = typeof decimals === "number" ? decimals : (decimals[unit] ?? 2);
  const value = bytes / 1024 ** index;

  if (trimTrailingZero) {
    if (unit === "B") return `${Math.round(value)} B`;
    const rounded = Math.round(value * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} ${unit}`;
  }
  return `${value.toFixed(digits)} ${unit}`;
}

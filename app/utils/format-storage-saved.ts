/**
 * Format a known byte count for the upload duplicate details row.
 * Uses KB and MB for anything at least 1 KB so the figure matches the
 * storage the duplicate did not upload.
 */
export function formatStorageSaved(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const kb = 1024;
  const mb = kb * 1024;
  if (bytes >= mb) return `${trimNumber(bytes / mb)} MB`;
  if (bytes >= kb) return `${trimNumber(bytes / kb)} KB`;
  return `${Math.round(bytes)} B`;
}

function trimNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

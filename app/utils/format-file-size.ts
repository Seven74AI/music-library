/**
 * Format bytes to human-readable file size (track audio detail display).
 * @param bytes - File size in bytes
 * @returns Formatted file size string (e.g., "1.2 MB", "512 KB", "N/A")
 */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || bytes === 0) return "N/A";

  const megabytes = bytes / (1024 * 1024);
  if (megabytes >= 1) return `${megabytes.toFixed(1)} MB`;
  const kilobytes = bytes / 1024;
  if (kilobytes >= 1) return `${Math.round(kilobytes)} KB`;
  return `${bytes} B`;
}

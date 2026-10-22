/**
 * Resolve the "date added to service" for track detail panels.
 * YouTube: releaseDate (video publication).
 * Uploads: metadata releaseDate / originalDate, else track createdAt.
 */
export function getServiceDateAdded({
  releaseDate,
  originalDate,
  createdAt,
}: {
  releaseDate?: string | Date | null;
  originalDate?: string | Date | null;
  createdAt?: string | Date | null;
}): Date | null {
  for (const value of [releaseDate, originalDate, createdAt]) {
    if (value == null) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return null;
}

export function formatServiceDateAdded(
  input: Parameters<typeof getServiceDateAdded>[0],
): string | null {
  const date = getServiceDateAdded(input);
  return date ? date.toLocaleDateString() : null;
}

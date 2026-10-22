/**
 * Collapses play-history rows to distinct tracks, keeping the first occurrence
 * of each `track.id`. History is newest-first, so the kept row is the most
 * recent play of that track.
 */
export function collapsePlayHistoryByTrack<T extends { track: { id: string } }>(items: T[]): T[] {
  const seen = new Set<string>();
  const collapsed: T[] = [];
  for (const item of items) {
    if (seen.has(item.track.id)) continue;
    seen.add(item.track.id);
    collapsed.push(item);
  }
  return collapsed;
}

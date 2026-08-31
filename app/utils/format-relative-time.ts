/**
 * Format a past timestamp as a compact relative label: "just now",
 * "5min ago", "3h ago", "2 days ago". Falls back to a short absolute date
 * once the timestamp is more than a week old.
 *
 * Client-safe (no server imports) and timezone-independent for the
 * relative buckets; only the absolute-date fallback uses the local locale.
 */
export function formatRelativeTime(date: string | Date, now: Date = new Date()): string {
  const then = new Date(date).getTime();
  const diffSeconds = Math.floor((now.getTime() - then) / 1000);

  if (diffSeconds < 60) return "just now";

  const minutes = Math.floor(diffSeconds / 60);
  if (minutes < 60) return `${minutes}min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ${days === 1 ? "day" : "days"} ago`;

  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

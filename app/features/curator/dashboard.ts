import { type CuratorBadgeSummary } from "./badges.ts";

export const DASHBOARD_METRICS_TTL_MS = 5 * 60 * 1000;
export const DASHBOARD_METRICS_CACHE_KEY = "curator-dashboard-metrics:v1";
export const METADATA_FIELD_COUNT = 5;
export const ACTIVITY_PAGE_SIZE = 20;
export const ACTIVITY_EXPORT_LIMIT = 5000;

export const LEADERBOARD_PERIODS = ["today", "week", "month", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

export const ISSUE_TYPE_LABELS: Record<string, string> = {
  wrong_metadata: "Wrong metadata",
  missing_info: "Missing info",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  other: "Other",
};

export type CuratorRef = {
  id: string;
  username: string;
  name: string | null;
};

export type DashboardMetrics = {
  totalTracks: number;
  tracksMissingMetadata: number;
  completenessPercent: number;
  pendingQueueItems: number;
  openDuplicates: number;
  openDuplicatesExact: number;
  openDuplicatesFuzzy: number;
  fieldBreakdown: { field: string; percent: number }[];
  problemTracks: {
    id: string;
    title: string;
    artistName: string;
    issueCount: number;
    issues: string[];
  }[];
  generatedAt: string;
};

export type LeaderboardEntry = {
  rank: number;
  editCount: number;
  curator: CuratorRef;
  badges?: CuratorBadgeSummary[];
};

export type LeaderboardResult = {
  period: LeaderboardPeriod;
  entries: LeaderboardEntry[];
};

export type ActivityAction = "edited" | "merged" | "split";
export type ActivityEntityType = "track" | "artist" | "album";

export type ActivityItem = {
  id: string;
  action: ActivityAction;
  entityType: ActivityEntityType;
  entityId: string;
  entityName: string;
  summary: string;
  message: string;
  matter: string | null;
  createdAt: string;
  curator: CuratorRef;
  badges?: CuratorBadgeSummary[];
};

export type ActivityResult = {
  items: ActivityItem[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  curators: CuratorRef[];
};

export type DashboardCharts = {
  completenessOverTime: { date: string; percent: number }[];
  editsPerDay: { date: string; count: number }[];
  issueTypes: { type: string; label: string; count: number }[];
};

export function isLeaderboardPeriod(value: string | null): value is LeaderboardPeriod {
  return LEADERBOARD_PERIODS.includes(value as LeaderboardPeriod);
}

export function curatorLabel(curator: Pick<CuratorRef, "name" | "username">): string {
  const name = curator.name?.trim();
  return name ? name : curator.username;
}

export function periodStart(period: LeaderboardPeriod, now = new Date()): Date | null {
  if (period === "all") return null;
  if (period === "month") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "today") return start;
  const day = start.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  return start;
}

export function completenessPercent(totalTracks: number, filledFields: number): number {
  if (totalTracks <= 0) return 0;
  return Math.round((filledFields / (totalTracks * METADATA_FIELD_COUNT)) * 100);
}

export function fieldPercent(count: number, totalTracks: number): number {
  if (totalTracks <= 0) return 0;
  return Math.round((count / totalTracks) * 100);
}

export function assignRanks<T extends { editCount: number }>(
  rows: T[],
): Array<T & { rank: number }> {
  let lastCount = Number.NaN;
  let rank = 0;
  return rows.map((row, index) => {
    if (row.editCount !== lastCount) {
      rank = index + 1;
      lastCount = row.editCount;
    }
    return { ...row, rank };
  });
}

export function activityAction(comment: string | null | undefined): ActivityAction {
  const text = comment ?? "";
  if (text.startsWith("SPLIT:") || text.startsWith("CREATED via split")) return "split";
  if (text.startsWith("Merged into")) return "merged";
  return "edited";
}

export function activityVerb(action: ActivityAction): string {
  if (action === "merged") return "merged";
  if (action === "split") return "split";
  return "edited";
}

export function activityMatter(comment: string | null | undefined): string | null {
  const text = comment?.trim() ?? "";
  if (!text) return null;
  if (text.startsWith("SPLIT:")) {
    const detail = text.slice("SPLIT:".length).trim();
    return detail ? `Split: ${detail}` : "Split the artist.";
  }
  return text;
}

export function activitySummary(
  curator: Pick<CuratorRef, "name" | "username">,
  action: ActivityAction,
  entityName: string,
): string {
  return `${curatorLabel(curator)} ${activityVerb(action)} '${entityName}'`;
}

export function formatRelativeTime(from: Date, now: Date): string {
  const seconds = Math.max(0, Math.round((now.getTime() - from.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  }
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export function formatActivityLine(
  summary: string,
  createdAt: string | Date,
  now = new Date(),
): string {
  const at = typeof createdAt === "string" ? new Date(createdAt) : createdAt;
  return `${summary} (${formatRelativeTime(at, now)})`;
}

export function describeTrackIssues(input: {
  albumId: string | null;
  genre: string | null;
  year: number | null;
  bpm: number | null;
  queueIssues: number;
}): string[] {
  const issues: string[] = [];
  if (!input.albumId) issues.push("Missing album");
  if (!input.genre?.trim()) issues.push("Missing genre");
  if (input.year == null) issues.push("Missing year");
  if (input.bpm == null) issues.push("Missing BPM");
  if (input.queueIssues === 1) issues.push("1 open queue item");
  else if (input.queueIssues > 1) issues.push(`${input.queueIssues} open queue items`);
  return issues;
}

export function lastNDays(count: number, now = new Date()): string[] {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const days: string[] = [];
  for (let offset = count - 1; offset >= 0; offset--) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() - offset);
    days.push(day.toISOString().slice(0, 10));
  }
  return days;
}

export function cumulativeCompleteness(
  daily: { day: string; created: number; filled: number }[],
  days: string[],
): { date: string; percent: number }[] {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  const allDays = [...new Set([...daily.map((row) => row.day), ...days])].sort();
  let created = 0;
  let filled = 0;
  const running = new Map<string, number>();
  for (const day of allDays) {
    const row = byDay.get(day);
    if (row) {
      created += row.created;
      filled += row.filled;
    }
    running.set(day, completenessPercent(created, filled));
  }
  return days.map((date) => ({ date, percent: running.get(date) ?? 0 }));
}

export function paginateNewest<T>(
  sources: T[][],
  page: number,
  pageSize: number,
  time: (item: T) => number,
  tieBreak: (item: T) => string,
): T[] {
  const merged = sources.flat().sort((a, b) => {
    const delta = time(b) - time(a);
    if (delta !== 0) return delta;
    return tieBreak(a).localeCompare(tieBreak(b));
  });
  const start = (page - 1) * pageSize;
  return merged.slice(start, start + pageSize);
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function activityToCsv(items: ActivityItem[]): string {
  const header = ["timestamp", "curator", "action", "entityType", "entityName", "summary"];
  const lines = [header.join(",")];
  for (const item of items) {
    lines.push(
      [
        item.createdAt,
        curatorLabel(item.curator),
        item.action,
        item.entityType,
        item.entityName,
        item.summary,
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

export function issueTypeLabel(type: string): string {
  return ISSUE_TYPE_LABELS[type] ?? type;
}

export const BADGE_DEFINITIONS = [
  { type: "first_edit", label: "First Edit", metric: "edits", threshold: 1 },
  { type: "getting_started", label: "Getting Started", metric: "edits", threshold: 10 },
  { type: "regular_contributor", label: "Regular Contributor", metric: "edits", threshold: 50 },
  { type: "power_curator", label: "Power Curator", metric: "edits", threshold: 200 },
  { type: "master_curator", label: "Master Curator", metric: "edits", threshold: 500 },
  { type: "elite_curator", label: "Elite Curator", metric: "edits", threshold: 1000 },
  { type: "duplicate_hunter", label: "Duplicate Hunter", metric: "merges", threshold: 10 },
  {
    type: "quality_guardian",
    label: "Quality Guardian",
    metric: "queueResolutions",
    threshold: 50,
  },
  { type: "genre_specialist", label: "Genre Specialist", metric: "genreEdits", threshold: 100 },
  {
    type: "community_helper",
    label: "Community Helper",
    metric: "resolvedUserReports",
    threshold: 10,
  },
] as const;

export type BadgeType = (typeof BADGE_DEFINITIONS)[number]["type"];
export type BadgeMetric = (typeof BADGE_DEFINITIONS)[number]["metric"];

export type CuratorCounts = Record<BadgeMetric, number>;

export type CuratorBadgeSummary = {
  type: BadgeType;
  label: string;
};

export const EMPTY_CURATOR_COUNTS: CuratorCounts = {
  edits: 0,
  merges: 0,
  queueResolutions: 0,
  genreEdits: 0,
  resolvedUserReports: 0,
};

export function badgeLabel(type: string): string {
  return BADGE_DEFINITIONS.find((badge) => badge.type === type)?.label ?? type;
}

export function isBadgeType(type: string): type is BadgeType {
  return BADGE_DEFINITIONS.some((badge) => badge.type === type);
}

/** Pure threshold check. A count must reach the threshold; one below does not qualify. */
export function earnedBadgeTypes(counts: CuratorCounts): BadgeType[] {
  return BADGE_DEFINITIONS.filter((badge) => counts[badge.metric] >= badge.threshold).map(
    (badge) => badge.type,
  );
}

export function summarizeBadges(types: readonly string[]): CuratorBadgeSummary[] {
  const earned = new Set(types);
  return BADGE_DEFINITIONS.filter((badge) => earned.has(badge.type)).map((badge) => ({
    type: badge.type,
    label: badge.label,
  }));
}

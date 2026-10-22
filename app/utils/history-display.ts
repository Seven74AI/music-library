export type HistoryValue = string | number | null;

export type HistoryChange = {
  from: HistoryValue;
  to: HistoryValue;
};

export type HistoryLabel = {
  from: string;
  to: string;
};

const RELATION_FIELDS = ["artistId", "albumId", "coverImageId"] as const;
type RelationField = (typeof RELATION_FIELDS)[number];

function isRelationField(field: string): field is RelationField {
  return (RELATION_FIELDS as readonly string[]).includes(field);
}

function idValue(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

export function collectRelationIds(changeSets: Array<Record<string, HistoryChange>>) {
  const artistIds = new Set<string>();
  const albumIds = new Set<string>();
  const coverIds = new Set<string>();

  for (const changes of changeSets) {
    for (const [field, change] of Object.entries(changes)) {
      const from = idValue(change.from);
      const to = idValue(change.to);
      if (field === "artistId") {
        if (from) artistIds.add(from);
        if (to) artistIds.add(to);
      }
      if (field === "albumId") {
        if (from) albumIds.add(from);
        if (to) albumIds.add(to);
      }
      if (field === "coverImageId") {
        if (from) coverIds.add(from);
        if (to) coverIds.add(to);
      }
    }
  }

  return {
    artistIds: [...artistIds],
    albumIds: [...albumIds],
    coverIds: [...coverIds],
  };
}

export function coverLabel(cover: { width: number | null; height: number | null }): string {
  if (cover.width && cover.height) return `Cover image (${cover.width}×${cover.height})`;
  return "Cover image";
}

function fallbackLabel(field: RelationField): string {
  if (field === "artistId") return "Unknown artist";
  if (field === "albumId") return "Unknown album";
  return "Unknown cover";
}

function labelSide(field: RelationField, value: unknown, names: Map<string, string>): string {
  const id = idValue(value);
  if (!id) return "(empty)";
  return names.get(id) ?? fallbackLabel(field);
}

export function displayLabels(
  changes: Record<string, HistoryChange>,
  names: {
    artist: Map<string, string>;
    album: Map<string, string>;
    cover: Map<string, string>;
  },
): Record<string, HistoryLabel> | undefined {
  const labels: Record<string, HistoryLabel> = {};
  for (const [field, change] of Object.entries(changes)) {
    if (!isRelationField(field)) continue;
    const map =
      field === "artistId" ? names.artist : field === "albumId" ? names.album : names.cover;
    labels[field] = {
      from: labelSide(field, change.from, map),
      to: labelSide(field, change.to, map),
    };
  }
  return Object.keys(labels).length > 0 ? labels : undefined;
}

export function displayedChange(
  change: HistoryChange,
  label: HistoryLabel | undefined,
  formatFallback: (value: HistoryValue) => string,
): HistoryLabel {
  return {
    from: label?.from ?? formatFallback(change.from),
    to: label?.to ?? formatFallback(change.to),
  };
}

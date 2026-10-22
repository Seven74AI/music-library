export const SORT_DIRECTIONS = ["asc", "desc"] as const;

export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export function parseSortDirection(
  raw: string | null | undefined,
  fallback: SortDirection = "desc",
): SortDirection {
  return SORT_DIRECTIONS.includes(raw as SortDirection) ? (raw as SortDirection) : fallback;
}

export function oppositeSortDirection(direction: SortDirection): SortDirection {
  return direction === "asc" ? "desc" : "asc";
}

/** Apply a signed comparison so `asc` keeps the natural order and `desc` flips it. */
export function applySortDirection(compareResult: number, direction: SortDirection): number {
  return direction === "asc" ? compareResult : -compareResult;
}

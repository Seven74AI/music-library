/** Coerce a value for Prisma `Int` columns: round finite numbers, drop non-finite. */
export function coerceOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.round(n);
}

/** First finite int among candidates, or null when none apply. */
export function pickIntField(...candidates: unknown[]): number | null {
  for (const value of candidates) {
    const coerced = coerceOptionalInt(value);
    if (coerced !== undefined) return coerced;
  }
  return null;
}

/** Falls back to page 1 for missing, non-numeric, fractional or out-of-range input. */
export function parsePageParam(raw: string | null): number {
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return 1;
  return parsed;
}

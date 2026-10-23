/**
 * Prisma error helpers shared across server modules.
 */

/**
 * True when `error` is a Prisma unique-constraint violation (P2002) or the
 * driver surfaces the same condition as a plain message (SQLite "UNIQUE
 * constraint failed" / "Unique constraint failed on the fields").
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;

  const code = "code" in error ? (error as { code?: unknown }).code : undefined;
  if (code === "P2002") return true;

  const message = "message" in error ? (error as { message?: unknown }).message : undefined;
  return typeof message === "string" && /unique constraint/i.test(message);
}

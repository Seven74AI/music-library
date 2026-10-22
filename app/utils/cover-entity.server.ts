import { prisma } from "./db.server.ts";

/**
 * Reject entity ids that could smuggle path segments into a Tigris object key.
 * Real entity ids are cuids (alphanumeric); any id containing a slash, backslash
 * or `..` is never a valid record and must not reach the storage key builder.
 */
export function isValidCoverEntityId(entityId: string): boolean {
  return entityId.length > 0 && entityId.length <= 128 && !/[/\\]|\.\./.test(entityId);
}

/**
 * Verify a cover target (artist or album) exists and return its canonical id.
 *
 * The object key must be server-derived from a verified record, never from the
 * client-supplied string: a nonexistent id (or a path-injection attempt) returns
 * null and the caller responds 404 instead of uploading an orphaned object.
 */
export async function verifyCoverEntity(
  entityType: "artist" | "album",
  entityId: string,
): Promise<string | null> {
  const record =
    entityType === "artist"
      ? await prisma.artist.findUnique({ where: { id: entityId }, select: { id: true } })
      : await prisma.album.findUnique({ where: { id: entityId }, select: { id: true } });
  return record?.id ?? null;
}

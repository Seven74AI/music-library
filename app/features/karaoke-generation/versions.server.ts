import { data } from "react-router";
import { prisma } from "#app/utils/db.server.ts";
import { acquireLock, findWriteBlockedLock } from "#app/utils/locks.server.ts";

/**
 * Lock key: ONE `karaoke_version` lock per TRACK (entityId = trackId). Each save
 * creates a new version id, so a version-keyed lock would never collide.
 */
export const KARAOKE_LOCK_TYPE = "karaoke_version" as const;

export function jsonError(error: string, status: number) {
  return data({ success: false, error }, { status });
}

/** Take (or extend) the track's karaoke edit lock; error response if someone else holds it. */
export async function requireKaraokeEditLock(trackId: string, userId: string) {
  const lock = await acquireLock(KARAOKE_LOCK_TYPE, trackId, userId);
  if (!lock) return jsonError("Karaoke is being edited by someone else", 409);
  return null;
}

/** Non-acquiring check used by publish/restore. */
export async function karaokeLockBlocker(trackId: string, userId: string) {
  const blocked = await findWriteBlockedLock(userId, [
    { entityType: KARAOKE_LOCK_TYPE, entityId: trackId },
  ]);
  return blocked
    ? jsonError("Karaoke is being edited by someone else", 409)
    : null;
}

class CasLostError extends Error {}

function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2034";
}

/**
 * Compare-and-swap the track's `currentVersionId` to `versionId` and mark that
 * version ready, atomically. Creates the TrackKaraoke row when absent. Returns
 * `{ ok: false }` when the pointer changed under us (lost the race).
 */
export async function casRepointCurrentVersion(
  trackId: string,
  versionId: string,
): Promise<{ ok: true; previousVersionId: string | null } | { ok: false }> {
  const existing = await prisma.trackKaraoke.findUnique({ where: { trackId } });
  const expected = existing?.currentVersionId ?? null;
  try {
    return await prisma.$transaction(async (tx) => {
      if (!existing) await tx.trackKaraoke.create({ data: { trackId } });
      const swapped = await tx.trackKaraoke.updateMany({
        where: { trackId, currentVersionId: expected },
        data: { currentVersionId: versionId },
      });
      if (swapped.count !== 1) throw new CasLostError();
      await tx.trackKaraokeVersion.update({
        where: { id: versionId },
        data: { status: "ready" },
      });
      return { ok: true as const, previousVersionId: expected };
    });
  } catch (error) {
    if (error instanceof CasLostError || isConflict(error)) return { ok: false };
    throw error;
  }
}

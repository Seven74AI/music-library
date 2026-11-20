import { data } from "react-router";
import { z } from "zod";
import {
  parseKaraokeLines,
  type KaraokeLines,
} from "#app/features/track-video/karaoke-lines.ts";
import { requireUserId } from "#app/utils/auth.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import {
  acquireLock,
  assertEditLockInTransaction,
  EditLockTransactionError,
  findWriteBlockedLock,
} from "#app/utils/locks.server.ts";

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
class JobIncompleteError extends Error {}

function isConflict(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "P2002" || code === "P2034";
}

export type RepointResult =
  | { ok: true; previousVersionId: string | null }
  | { ok: false; reason: "conflict" | "job_incomplete" | "locked" };

/**
 * Compare-and-swap the track's `currentVersionId` to `versionId` and mark that
 * version ready, atomically. Creates the TrackKaraoke row when absent.
 * Rejects (`job_incomplete`) a version whose generation job has not completed
 * (a version with no job, e.g. a manual edit, is publishable). When `userId`
 * is given, the edit lock is re-checked inside the transaction.
 */
export async function casRepointCurrentVersion(
  trackId: string,
  versionId: string,
  userId?: string,
): Promise<RepointResult> {
  const existing = await prisma.trackKaraoke.findUnique({ where: { trackId } });
  const expected = existing?.currentVersionId ?? null;
  try {
    return await prisma.$transaction(async (tx) => {
      if (userId) {
        await assertEditLockInTransaction(
          tx,
          KARAOKE_LOCK_TYPE,
          trackId,
          userId,
          null,
        );
      }
      const job = await tx.karaokeGenerationJob.findUnique({
        where: { versionId },
        select: { status: true },
      });
      if (job && job.status !== "completed") throw new JobIncompleteError();
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
    if (error instanceof JobIncompleteError)
      return { ok: false, reason: "job_incomplete" };
    if (error instanceof EditLockTransactionError)
      return { ok: false, reason: "locked" };
    if (error instanceof CasLostError || isConflict(error))
      return { ok: false, reason: "conflict" };
    throw error;
  }
}

export type EditorVersion = {
  id: string;
  trackId: string;
  status: string;
  language: string;
  source: string;
  lyricsText: string;
  lines: KaraokeLines;
  /** Generation job status, or null for versions without a job (manual edits). */
  jobStatus: string | null;
};

/**
 * Load ONE version's full content for the editor. Returns null when the
 * version does not exist OR does not belong to `trackId`.
 */
export async function loadEditorVersion(
  trackId: string,
  versionId: string,
): Promise<EditorVersion | null> {
  const row = await prisma.trackKaraokeVersion.findUnique({
    where: { id: versionId },
    include: { generationJob: { select: { status: true } } },
  });
  if (!row || row.trackId !== trackId) return null;
  return {
    id: row.id,
    trackId: row.trackId,
    status: row.status,
    language: row.language,
    source: row.source,
    lyricsText: row.lyricsText,
    lines: parseKaraokeLines(row.lines) ?? [],
    jobStatus: row.generationJob?.status ?? null,
  };
}

export const PublishVersionSchema =z.object({ versionId: z.string().min(1) });

/** Shared body of the `mark-ready` and `restore` actions (identical semantics). */
export async function publishVersionAction(request: Request) {
  const userId = await requireUserId(request);
  const parsed = PublishVersionSchema.safeParse(
    Object.fromEntries((await request.formData()).entries()),
  );
  if (!parsed.success) {
    return data(
      { success: false, errors: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const version = await prisma.trackKaraokeVersion.findUnique({
    where: { id: parsed.data.versionId },
    select: { id: true, trackId: true },
  });
  if (!version) return jsonError("Version not found", 404);
  // Early, friendly check; re-asserted inside the CAS transaction.
  const blocked = await karaokeLockBlocker(version.trackId, userId);
  if (blocked) return blocked;

  const result = await casRepointCurrentVersion(
    version.trackId,
    version.id,
    userId,
  );
  if (!result.ok) {
    if (result.reason === "job_incomplete")
      return jsonError("Version generation has not completed", 409);
    if (result.reason === "locked")
      return jsonError("Karaoke is being edited by someone else", 409);
    return jsonError("Karaoke changed concurrently; retry", 409);
  }
  return data({
    success: true,
    trackId: version.trackId,
    currentVersionId: version.id,
    previousVersionId: result.previousVersionId,
  });
}

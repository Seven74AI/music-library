import { prisma } from "./db.server.ts";
import { type Prisma } from "#prisma/client.js";
import {
  recordSecurityEvent,
  SECURITY_EVENT_TYPES,
} from "#app/features/security/track-event.server.ts";

export type EntityType = "track" | "artist" | "album";

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const lockInclude = { user: { select: { id: true, name: true, username: true } } } as const;

/** Duck-typed so we don't depend on Prisma runtime internals for one error code. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export interface LockInfo {
  id: string;
  entityType: EntityType;
  entityId: string;
  lockedBy: string;
  lockedByName: string;
  acquiredAt: Date;
  expiresAt: Date;
}

/**
 * Acquire a lock on an entity for editing
 * Returns the lock if successful, or null if already locked
 */
export async function acquireLock(
  entityType: EntityType,
  entityId: string,
  userId: string,
): Promise<LockInfo | null> {
  // Clean up expired locks first
  await cleanupExpiredLocks();

  // Check if already locked
  const existing = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    include: { user: { select: { id: true, name: true, username: true } } },
  });

  if (existing) {
    // If locked by same user, extend the lock
    if (existing.lockedBy === userId) {
      const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MS);
      const updated = await prisma.editLock.update({
        where: { id: existing.id },
        data: { expiresAt },
        include: { user: { select: { id: true, name: true, username: true } } },
      });
      return toLockInfo(updated);
    }

    // Otherwise, it's locked by someone else
    return null;
  }

  // Create new lock. The EditLock entityType_entityId unique constraint (ADR-032)
  // is the atomic guard: two curators acquiring concurrently both pass the
  // findUnique above, but only one create succeeds — the loser hits P2002.
  const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MS);
  try {
    const lock = await prisma.editLock.create({
      data: {
        entityType,
        entityId,
        lockedBy: userId,
        expiresAt,
      },
      include: lockInclude,
    });

    return toLockInfo(lock);
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;

    // Lost the race to another curator. Re-read the winning lock so a same-user
    // double-acquire still extends it instead of reporting "already locked".
    const winner = await prisma.editLock.findUnique({
      where: { entityType_entityId: { entityType, entityId } },
      include: lockInclude,
    });

    if (winner?.lockedBy === userId) {
      const extended = await prisma.editLock.update({
        where: { id: winner.id },
        data: { expiresAt: new Date(Date.now() + LOCK_TIMEOUT_MS) },
        include: lockInclude,
      });
      return toLockInfo(extended);
    }

    return null;
  }
}

export type ReleaseLockResult = "released" | "not_found" | "not_owner";

/**
 * Release a lock on an entity.
 * Distinguishes "no lock exists" (`not_found`) from "locked by someone else"
 * (`not_owner`) so callers can return the correct HTTP status.
 */
export async function releaseLock(
  entityType: EntityType,
  entityId: string,
  userId: string,
): Promise<ReleaseLockResult> {
  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });

  if (!lock) {
    return "not_found";
  }
  if (lock.lockedBy !== userId) {
    return "not_owner";
  }

  await prisma.editLock.delete({
    where: { id: lock.id },
  });

  return "released";
}

/**
 * Force unlock an entity (admin/curator override with reason)
 */
export async function forceUnlock(
  entityType: EntityType,
  entityId: string,
  reason: string,
  actorUserId: string,
): Promise<boolean> {
  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });

  if (!lock) {
    return false;
  }

  await prisma.editLock.delete({
    where: { id: lock.id },
  });

  // Log the force unlock with reason in the audit trail (ADR-032).
  await recordSecurityEvent({
    eventType: SECURITY_EVENT_TYPES.forceUnlock,
    userId: actorUserId,
    targetUserId: lock.lockedBy,
    metadata: {
      entityType,
      entityId,
      reason,
    },
  });

  return true;
}

/**
 * Get lock status for an entity
 */
export async function getLockStatus(
  entityType: EntityType,
  entityId: string,
): Promise<LockInfo | null> {
  // Clean up expired locks first
  await cleanupExpiredLocks();

  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
    include: { user: { select: { id: true, name: true, username: true } } },
  });

  if (!lock) {
    return null;
  }

  return toLockInfo(lock);
}

/**
 * Clean up all expired locks
 */
export async function cleanupExpiredLocks(): Promise<number> {
  const result = await prisma.editLock.deleteMany({
    where: {
      expiresAt: {
        lt: new Date(),
      },
    },
  });

  return result.count;
}

/**
 * Convert database lock to LockInfo
 */
type EditLockWithUser = Prisma.EditLockGetPayload<{
  include: { user: { select: { id: true; name: true; username: true } } };
}>;

function toLockInfo(lock: EditLockWithUser): LockInfo {
  return {
    id: lock.id,
    entityType: lock.entityType as EntityType,
    entityId: lock.entityId,
    lockedBy: lock.user.id,
    lockedByName: lock.user.name || lock.user.username,
    acquiredAt: lock.acquiredAt,
    expiresAt: lock.expiresAt,
  };
}

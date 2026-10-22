import { prisma } from "./db.server.ts";
import {
  recordSecurityEvent,
  SECURITY_EVENT_TYPES,
} from "#app/features/security/track-event.server.ts";

export type EntityType = "track" | "artist" | "album";

const LOCK_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

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

  // Create new lock
  const expiresAt = new Date(Date.now() + LOCK_TIMEOUT_MS);
  const lock = await prisma.editLock.create({
    data: {
      entityType,
      entityId,
      lockedBy: userId,
      expiresAt,
    },
    include: { user: { select: { id: true, name: true, username: true } } },
  });

  return toLockInfo(lock);
}

/**
 * Release a lock on an entity
 */
export async function releaseLock(
  entityType: EntityType,
  entityId: string,
  userId: string,
): Promise<boolean> {
  const lock = await prisma.editLock.findUnique({
    where: { entityType_entityId: { entityType, entityId } },
  });

  // Only release if locked by this user
  if (!lock || lock.lockedBy !== userId) {
    return false;
  }

  await prisma.editLock.delete({
    where: { id: lock.id },
  });

  return true;
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
function toLockInfo(
  lock: any & { user: { id: string; name: string | null; username: string } },
): LockInfo {
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

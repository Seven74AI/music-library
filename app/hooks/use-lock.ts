import { useCallback, useEffect, useRef, useState } from "react";

export type EntityType = "track" | "artist" | "album";

export interface LockInfo {
  id: string;
  entityType: EntityType;
  entityId: string;
  lockedBy: string;
  lockedByName: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface UseLockResult {
  lock: LockInfo | null;
  isLocked: boolean;
  isLockedByOther: boolean;
  isLoading: boolean;
  error: string | null;
  acquire: () => void;
  release: () => void;
  refresh: () => void;
}

const OTHER_LOCK_POLL_MS = 4000;
const releaseInFlight = new Set<string>();

/**
 * Hook to manage entity locks.
 * Acquires on mount when autoAcquire is set, and releases an owned lock on unmount.
 * A 409 from acquire means another curator holds the lock: the banner reads their name
 * from the status endpoint, and editing stays disabled until that lock is gone.
 */
export function useLock(
  entityType: EntityType,
  entityId: string,
  options: {
    autoAcquire?: boolean;
    autoRelease?: boolean;
  } = {},
): UseLockResult {
  const { autoAcquire = true, autoRelease = true } = options;

  const autoAcquireRef = useRef(autoAcquire);
  const autoReleaseRef = useRef(autoRelease);
  autoAcquireRef.current = autoAcquire;
  autoReleaseRef.current = autoRelease;

  const entityTypeRef = useRef(entityType);
  const entityIdRef = useRef(entityId);
  entityTypeRef.current = entityType;
  entityIdRef.current = entityId;

  const mountedRef = useRef(true);
  const ownedRef = useRef(false);
  const ownedEntityRef = useRef<{ type: EntityType; id: string } | null>(null);
  const myUserIdRef = useRef<string | null>(null);
  const acquireGen = useRef(0);

  const [lock, setLock] = useState<LockInfo | null>(null);
  const [isLockedByOther, setIsLockedByOther] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = `${entityType}\0${entityId}`;
  const [appliedIdentity, setAppliedIdentity] = useState(identity);
  // The player keeps this hook mounted while the track changes. Drop the previous
  // holder's name before paint so track A is not still locked on track B.
  if (appliedIdentity !== identity) {
    setAppliedIdentity(identity);
    setLock(null);
    setIsLockedByOther(false);
    setError(null);
  }

  const releaseRequest = useCallback((type: EntityType, id: string) => {
    // A late release for the entity we just left must not drop the lock we now hold.
    if (ownedEntityRef.current?.type === type && ownedEntityRef.current.id === id) {
      ownedRef.current = false;
      ownedEntityRef.current = null;
    }
    const key = `${type}:${id}`;
    if (releaseInFlight.has(key)) return;
    releaseInFlight.add(key);
    void fetch("/api/locks/release", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: type, entityId: id }),
    })
      .catch((err) => {
        console.error("Failed to release lock:", err);
      })
      .finally(() => {
        releaseInFlight.delete(key);
      });
  }, []);

  const readStatus = useCallback(async (): Promise<LockInfo | null> => {
    const type = entityTypeRef.current;
    const id = entityIdRef.current;
    const res = await fetch(
      `/api/locks/status?entityType=${encodeURIComponent(type)}&entityId=${encodeURIComponent(id)}`,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { lock: LockInfo | null };
    return data.lock ?? null;
  }, []);

  const showMine = useCallback((next: LockInfo) => {
    myUserIdRef.current = next.lockedBy;
    ownedRef.current = true;
    ownedEntityRef.current = { type: next.entityType, id: next.entityId };
    setLock(next);
    setIsLockedByOther(false);
    setError(null);
  }, []);

  const showOther = useCallback((next: LockInfo) => {
    ownedRef.current = false;
    ownedEntityRef.current = null;
    setLock(next);
    setIsLockedByOther(true);
  }, []);

  const acquire = useCallback(() => {
    const generation = ++acquireGen.current;
    const type = entityTypeRef.current;
    const id = entityIdRef.current;
    setIsLoading(true);
    setError(null);

    void fetch("/api/locks/acquire", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType: type, entityId: id }),
    })
      .then(async (res) => {
        const stillCurrent = type === entityTypeRef.current && id === entityIdRef.current;
        if (!stillCurrent) {
          // The editor moved on. Release a lock this request won for the old id.
          if (res.ok && autoReleaseRef.current) releaseRequest(type, id);
          return;
        }
        if (!mountedRef.current) {
          // Only the latest acquire may release. An older response must not
          // delete a lock the current editor still holds, or send a second release.
          if (res.ok && autoReleaseRef.current && generation === acquireGen.current) {
            releaseRequest(type, id);
          }
          return;
        }
        if (generation !== acquireGen.current) return;

        if (res.status === 409) {
          let message = "This entity is currently locked by another curator";
          try {
            const body = (await res.json()) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            // The status lookup still identifies the holder.
          }
          const statusLock = await readStatus().catch(() => null);
          if (!mountedRef.current || generation !== acquireGen.current) return;
          if (type !== entityTypeRef.current || id !== entityIdRef.current) return;
          if (statusLock && myUserIdRef.current && statusLock.lockedBy === myUserIdRef.current) {
            showMine(statusLock);
            return;
          }
          if (statusLock) {
            showOther(statusLock);
            setError(message);
            return;
          }
          setError(message);
          return;
        }

        if (!res.ok) {
          let message = "Failed to acquire lock";
          try {
            const body = (await res.json()) as { message?: string };
            if (body.message) message = body.message;
          } catch {
            // Fall back to the generic message.
          }
          throw new Error(message);
        }

        const data = (await res.json()) as { lock: LockInfo };
        if (type !== entityTypeRef.current || id !== entityIdRef.current) {
          if (autoReleaseRef.current) releaseRequest(type, id);
          return;
        }
        if (!mountedRef.current) {
          if (autoReleaseRef.current && generation === acquireGen.current) releaseRequest(type, id);
          return;
        }
        if (generation !== acquireGen.current) return;
        showMine(data.lock);
      })
      .catch((err: unknown) => {
        if (!mountedRef.current || generation !== acquireGen.current) return;
        setError(err instanceof Error ? err.message : "Unknown error");
      })
      .finally(() => {
        if (mountedRef.current && generation === acquireGen.current) setIsLoading(false);
      });
  }, [readStatus, releaseRequest, showMine, showOther]);

  const release = useCallback(() => {
    const owned = ownedEntityRef.current;
    const type = owned?.type ?? entityTypeRef.current;
    const id = owned?.id ?? entityIdRef.current;
    myUserIdRef.current = null;
    ownedEntityRef.current = null;
    setLock(null);
    setIsLockedByOther(false);
    if (ownedRef.current) releaseRequest(type, id);
    ownedRef.current = false;
  }, [releaseRequest]);

  const refresh = useCallback(() => {
    void readStatus()
      .then((next) => {
        if (!mountedRef.current) return;
        if (!next) {
          const shouldAcquire = autoAcquireRef.current;
          ownedRef.current = false;
          ownedEntityRef.current = null;
          myUserIdRef.current = null;
          setLock(null);
          setIsLockedByOther(false);
          setError(null);
          if (shouldAcquire) acquire();
          return;
        }
        if (myUserIdRef.current && next.lockedBy === myUserIdRef.current) {
          showMine(next);
          return;
        }
        showOther(next);
      })
      .catch((err: unknown) => {
        console.error("Failed to fetch lock status:", err);
      });
  }, [acquire, readStatus, showMine, showOther]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const owned = ownedEntityRef.current;
      if (!autoReleaseRef.current || !owned) return;
      ownedEntityRef.current = null;
      ownedRef.current = false;
      releaseRequest(owned.type, owned.id);
    };
  }, [releaseRequest]);

  useEffect(() => {
    const owned = ownedEntityRef.current;
    if (owned && (owned.type !== entityType || owned.id !== entityId)) {
      ownedEntityRef.current = null;
      ownedRef.current = false;
      myUserIdRef.current = null;
      if (autoReleaseRef.current) releaseRequest(owned.type, owned.id);
    }
    if (autoAcquire) acquire();
  }, [entityType, entityId, autoAcquire, acquire, releaseRequest]);

  useEffect(() => {
    if (!isLockedByOther) return;
    const timer = window.setInterval(() => {
      refresh();
    }, OTHER_LOCK_POLL_MS);
    return () => window.clearInterval(timer);
  }, [isLockedByOther, refresh]);

  return {
    lock,
    isLocked: !!lock,
    isLockedByOther,
    isLoading,
    error,
    acquire,
    release,
    refresh,
  };
}

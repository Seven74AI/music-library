# ADR-032: Concurrent Edit Locking Mechanism

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Multiple curators working simultaneously can create editing conflicts:

- Curator A opens track X, edits genre to "Jazz"
- Curator B opens same track X, edits genre to "Rock"
- Both save - last write wins, A's edit is silently overwritten

This leads to lost work, confusion, and potential data corruption. Traditional last-write-wins with no warnings creates poor user experience for curators who may spend minutes carefully editing metadata only to have their changes overwritten.

## Decision

### Optimistic Locking with Explicit Lock Acquisition

Implement an optimistic locking system where locks are acquired when a curator opens an edit dialog and released on save or close. Other curators attempting to edit the same entity see a read-only view until the lock is released.

### Lock Scope

Locks apply to:

- **Tracks** (per track edit dialog)
- **Artists** (per artist edit dialog)
- **Albums** (per album edit dialog)

Locks do **not** apply to:

- Bulk operations (selection state is local, edits processed server-side with conflict detection)
- Review queue claims (separate claiming mechanism)
- Curator notes (append-only, no conflicts)

### Lock Lifecycle

**1. Lock Acquisition**

Lock is created when curator opens edit dialog:

- Curator A clicks "Edit Metadata" on Track X
- Dialog opens, server creates lock: `{ entityType: 'track', entityId: 'track-123', lockedBy: 'user-A', lockedAt: timestamp }`
- Lock stored in database (not in-memory) for persistence across server restarts

**2. Lock Display to Others**

When curator B attempts to edit the same track:

- Dialog opens but fields are read-only
- Banner displays: "Locked by Alice (editing for 5 minutes)"
- Manual "Refresh" button available
- Auto-unlock + auto-refresh when curator A finishes (via BroadcastChannel API)

**3. Lock Release**

Lock released when:

- Curator saves changes
- Curator closes dialog without saving
- 30-minute timeout (automatic)
- Force-unlock by another curator (with reason)

### Lock Timeout & Stealing

**Automatic Timeout**: 30 minutes of inactivity

- Lock automatically released after 30 minutes
- Any curator can then acquire the lock
- Prevents indefinite locks from browser crashes, network issues, or forgotten dialogs

**Manual Force-Unlock**:

- Any curator can force-unlock after providing a reason
- Confirmation dialog: "Alice is currently editing this track. Force unlock and take over?"
- Reason required for audit trail: "Why are you force-unlocking?"
- Force-unlock action logged in audit trail

### Real-time Lock Updates

Using BroadcastChannel API (see ADR-033):

- Curator A saves → lock released → BroadcastChannel message sent
- Curator B's read-only dialog receives message → fields unlock → data refreshes automatically
- If BroadcastChannel fails (e.g., different browser session), manual "Refresh" button available

### Lock Storage

Database table:

```prisma
model EditLock {
  id          String   @id @default(cuid())
  entityType  String   // "track" | "artist" | "album"
  entityId    String   // ID of locked entity
  lockedBy    String   // User ID
  lockedAt    DateTime @default(now())
  expiresAt   DateTime // lockedAt + 30 minutes

  user        User     @relation(fields: [lockedBy], references: [id], onDelete: Cascade)

  @@unique([entityType, entityId])
  @@index([expiresAt]) // for cleanup job
}
```

Unique constraint on `[entityType, entityId]` ensures only one lock per entity.

### Conflict Resolution Fallback

If somehow both tabs bypass lock (race condition, BroadcastChannel failure):

- Server detects concurrent edit via version check
- Shows conflict dialog: "This track was modified by Bob while you were editing. Your changes: Genre: Jazz | Bob's changes: Genre: Rock"
- Curator chooses: Keep your changes, Keep Bob's changes, or Cancel and review

## Consequences

### Positive

- **No silent overwrites**: Curators always know when someone else is editing
- **Clear ownership**: Lock banner shows who has edit access
- **Auto-recovery**: Real-time unlock when original curator finishes
- **Timeout protection**: Abandoned locks don't block work indefinitely
- **Force-unlock safety valve**: Curators can override locks when necessary (with audit trail)

### Negative

- **Additional database writes**: Lock create/release on every edit dialog open/close
- **Lock contention**: Popular tracks may be frequently locked (acceptable - coordinated editing is better than conflicts)
- **Timeout trade-off**: 30 minutes is long enough for thorough editing but may delay others (force-unlock available)

### Trade-offs

**Why not pessimistic locking (lock on page load)?**

- Too aggressive - users browse without editing
- Locks would be held unnecessarily

**Why not version-based optimistic concurrency (no explicit locks)?**

- Worse UX - curator doesn't know someone else is editing until save fails
- Lost work if curator spends 10 minutes editing before discovering conflict

**Why 30 minutes?**

- Long enough for careful metadata research and editing
- Short enough that force-unlock rarely needed
- Curator can extend by saving and reopening (refreshes lock)

## Implementation Notes

### Lock Cleanup Job

Background job runs every 5 minutes:

```typescript
// Remove expired locks
await prisma.editLock.deleteMany({
  where: { expiresAt: { lt: new Date() } },
});
```

### API Endpoints

```typescript
// POST /api/locks/acquire
{ entityType: "track", entityId: "track-123" }
→ { lock: { id, lockedBy, lockedAt, expiresAt } } | { error: "locked", lockedBy: { name, username }, lockedAt }

// POST /api/locks/release
{ lockId: "lock-456" }
→ { success: true }

// POST /api/locks/force-unlock
{ entityType: "track", entityId: "track-123", reason: "Curator inactive, need urgent fix" }
→ { success: true }

// GET /api/locks/status
{ entityType: "track", entityId: "track-123" }
→ { locked: true, lockedBy: { name, username }, lockedAt } | { locked: false }
```

### BroadcastChannel Integration

```typescript
// When lock released
broadcastChannel.postMessage({
  type: "LOCK_RELEASED",
  entityType: "track",
  entityId: "track-123",
});

// Listener in read-only dialog
broadcastChannel.onmessage = (event) => {
  if (event.data.type === "LOCK_RELEASED" && event.data.entityId === currentEntityId) {
    refetchLockStatus();
    if (!locked) {
      acquireLock();
      refreshEntityData();
      enableFields();
    }
  }
};
```

## Alternatives Considered

### Version-based optimistic concurrency (no explicit locks)

Track a `version` field, increment on each save. If version mismatch on save, show conflict dialog.

**Rejected because:**

- Curator doesn't know about conflict until after editing (poor UX)
- Lost work if conflict detected after 10 minutes of editing
- Explicit locks provide better coordination

### WebSocket-based real-time presence

Use WebSockets to show "Alice is viewing this track" before lock acquisition.

**Rejected because:**

- Adds infrastructure complexity (WebSocket server, connection management)
- "Viewing" doesn't mean "editing" - false positive locks
- BroadcastChannel sufficient for lock release notifications

### No locking, just conflict warnings

Trust curators to coordinate manually via chat/notes.

**Rejected because:**

- High risk of conflicts in active curation periods
- Frustrating UX when conflicts occur
- Explicit locks prevent problems rather than warn after

## References

- Related: ADR-031 (Curator Role), ADR-033 (Real-time Sync)
- BroadcastChannel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API

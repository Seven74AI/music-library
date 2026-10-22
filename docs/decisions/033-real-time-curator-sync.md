# ADR-033: Real-time Curator Sync Across Browser Tabs

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Curators often work across multiple browser tabs:

- Library view in tab 1, track edit dialog in tab 2
- Duplicate detection in tab 1, merge preview in tab 2
- Review queue in tab 1, track details in tab 2

Without real-time synchronization, changes made in one tab don't reflect in other tabs until manual refresh. This creates confusing UX:

- Curator merges duplicate artists in tab 1
- Tab 2 still shows old duplicate list
- Curator may attempt to merge same artists again

Additionally, the lock system (ADR-032) relies on real-time notifications when locks are released, so curators in read-only dialogs can automatically unlock and refresh when the original editor finishes.

## Decision

### BroadcastChannel API for Same-Browser Sync

Use the BroadcastChannel API to synchronize curator state across tabs in the **same browser**. Cross-device sync is explicitly **not** in scope for v1.

**Rationale:**

- BroadcastChannel is purpose-built for tab-to-tab messaging
- No server infrastructure required (no WebSockets, SSE, polling)
- Works across tabs from same origin
- Simple API: `postMessage()` and `onmessage`

### Sync Scope

**What syncs:**

1. **Track/Artist/Album Edits**
   - Track edited in tab 1 → track display updates in tab 2
   - Artist merged → artist selectors refresh in all tabs
   - Cover image uploaded → new cover appears in all tabs

2. **Lock State** (critical for ADR-032)
   - Lock released in tab 1 → read-only dialog in tab 2 auto-unlocks
   - Lock acquired in tab 1 → edit button disabled in tab 2

3. **Selection State**
   - Tracks selected in library tab 1 → selection persists when switching to tab 2
   - Cleared in one tab → cleared in all tabs

4. **Merge Operations**
   - Duplicate merged → duplicate list refreshes in all tabs
   - Merge preview open in tab 1 → affected tracks update if modified in tab 2

5. **Review Queue**
   - Item claimed in tab 1 → disappears from queue in tab 2
   - Item resolved → updates across all tabs
   - User report added → appears in queue across tabs

**What does NOT sync:**

- Scroll position (local to each tab)
- Dialog open/close state (except locks)
- Form field values mid-edit (only on save)
- Cursor position in text fields

### Message Protocol

**Event Types:**

```typescript
type CuratorSyncMessage =
  | { type: "TRACK_UPDATED"; trackId: string; updatedFields: Partial<Track> }
  | { type: "ARTIST_UPDATED"; artistId: string; updatedFields: Partial<Artist> }
  | { type: "ALBUM_UPDATED"; albumId: string; updatedFields: Partial<Album> }
  | { type: "ARTIST_MERGED"; sourceIds: string[]; targetId: string }
  | { type: "ALBUM_MERGED"; sourceIds: string[]; targetId: string }
  | { type: "ARTIST_SPLIT"; originalId: string; newIds: string[] }
  | { type: "LOCK_ACQUIRED"; entityType: string; entityId: string; lockedBy: string }
  | { type: "LOCK_RELEASED"; entityType: string; entityId: string }
  | { type: "SELECTION_UPDATED"; trackIds: string[] }
  | { type: "SELECTION_CLEARED" }
  | { type: "QUEUE_ITEM_CLAIMED"; itemId: string; claimedBy: string }
  | { type: "QUEUE_ITEM_RESOLVED"; itemId: string }
  | { type: "COVER_IMAGE_UPDATED"; entityType: string; entityId: string; imageUrl: string }
  | { type: "BULK_EDIT_COMPLETED"; trackIds: string[]; updatedFields: Partial<Track> };
```

### Implementation

**Initialization:**

```typescript
// app/features/curator/sync.client.ts
const curatorChannel = new BroadcastChannel("curator-sync");

curatorChannel.onmessage = (event: MessageEvent<CuratorSyncMessage>) => {
  const message = event.data;

  switch (message.type) {
    case "TRACK_UPDATED":
      // Invalidate queries, refresh components showing this track
      queryClient.invalidateQueries(["track", message.trackId]);
      break;

    case "LOCK_RELEASED":
      // If we're in a read-only dialog for this entity, try to acquire lock
      handleLockRelease(message.entityType, message.entityId);
      break;

    case "SELECTION_UPDATED":
      // Update selection state in local storage + UI
      updateSelectionState(message.trackIds);
      break;

    // ... handle other message types
  }
};
```

**Broadcasting Changes:**

```typescript
// After successful edit
await updateTrack(trackId, changes);
curatorChannel.postMessage({
  type: "TRACK_UPDATED",
  trackId,
  updatedFields: changes,
});
```

**Cleanup:**

```typescript
// Component unmount / page unload
useEffect(() => {
  return () => curatorChannel.close();
}, []);
```

### Conflict Detection Fallback

BroadcastChannel is not guaranteed delivery. If messages are lost or delayed:

- Lock system falls back to manual "Refresh" button
- Edit dialogs include version check on save (conflict dialog if mismatch)
- Review queue items re-checked on claim (error if already claimed)

### Session Storage Integration

Selection state persists in `sessionStorage` (ADR-036) and syncs via BroadcastChannel:

- Selection updated in tab 1 → BroadcastChannel message sent
- Tab 2 receives message → reads from sessionStorage → updates UI
- If BroadcastChannel fails, tabs fall back to sessionStorage on navigation

## Consequences

### Positive

- **Seamless multi-tab workflow**: Changes appear instantly across tabs
- **Better lock UX**: Auto-unlock eliminates manual refresh
- **No server infrastructure**: Pure client-side, no WebSocket server or polling
- **Low latency**: Instant propagation within same browser
- **Simple API**: BroadcastChannel is straightforward to use

### Negative

- **Same-browser only**: Doesn't sync across devices or browsers (acceptable for v1)
- **No guaranteed delivery**: Messages can be lost (mitigated by fallback mechanisms)
- **Broadcast storm risk**: Many rapid edits could flood channel (mitigated by debouncing)

### Trade-offs

**Why not WebSockets?**

- Requires server infrastructure (WebSocket handler, connection management, scaling)
- More complex than needed for same-browser sync
- Cross-device sync not required for v1

**Why not localStorage events?**

- `storage` event only fires in _other_ tabs, not the originating tab (confusing semantics)
- Requires writing to localStorage on every change (performance concern)
- BroadcastChannel designed specifically for messaging, not storage side-effects

**Why not Service Worker?**

- Service Worker not guaranteed to be running
- Message routing more complex
- BroadcastChannel simpler and more direct

**Why not polling?**

- Inefficient (constant HTTP requests even when idle)
- Higher latency (poll interval vs instant messages)
- Server load for no benefit when BroadcastChannel available

## Browser Support

**BroadcastChannel API support:**

- Chrome 54+ (2016)
- Firefox 38+ (2015)
- Safari 15.4+ (2022)
- Edge 79+ (2020)

**Fallback for unsupported browsers:**

- Graceful degradation: no sync, manual refresh required
- Feature detection: `if ('BroadcastChannel' in window)`
- Same UX as pre-sync state (works, just less convenient)

**iOS Safari support:**

- Safari 15.4+ (iOS 15.4, March 2022)
- Most users on iOS 16+ (95%+ by 2026)
- Acceptable to require iOS 15.4+ for curator features

## Implementation Notes

### Debouncing Rapid Updates

Bulk operations that update many entities debounce messages:

```typescript
// Instead of 100 individual TRACK_UPDATED messages
// Send one BULK_EDIT_COMPLETED message
curatorChannel.postMessage({
  type: "BULK_EDIT_COMPLETED",
  trackIds: [/* 100 IDs */],
  updatedFields: { genre: "Jazz" },
});
```

### Query Invalidation Strategy

Use React Query's `invalidateQueries` with specific keys to minimize re-fetches:

```typescript
// Specific track
queryClient.invalidateQueries(["track", trackId]);

// All tracks by artist (for artist merge)
queryClient.invalidateQueries(["tracks", { artistId }]);

// Duplicate detection cache
queryClient.invalidateQueries(["duplicates"]);
```

### Message Size Limits

BroadcastChannel has no official size limit, but keep messages small:

- Send IDs + minimal changed fields, not full entities
- Components refetch full data if needed
- Avoid embedding large objects (lyrics, images) in messages

## Alternatives Considered

### Server-sent Events (SSE)

Unidirectional server → client push.

**Rejected because:**

- Requires server infrastructure
- Overkill for same-browser sync
- Doesn't solve the actual problem (curator's own tabs syncing)

### Shared Web Worker

Shared Worker as message hub between tabs.

**Rejected because:**

- More complex than BroadcastChannel
- No significant advantage for simple messaging
- Safari support weaker than BroadcastChannel

### No sync, refresh manually

Rely on curators to refresh pages manually.

**Rejected because:**

- Poor UX, especially for lock system
- Confusing when changes don't appear in other tabs
- Increases curator cognitive load

## References

- Related: ADR-032 (Concurrent Edit Locking), ADR-036 (Session Recovery)
- BroadcastChannel API: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
- Browser support: https://caniuse.com/broadcastchannel

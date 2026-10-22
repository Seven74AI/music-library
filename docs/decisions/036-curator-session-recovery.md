# ADR-036: Curator Session Recovery

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Curators work on complex, multi-step workflows:

- Selecting 50 tracks across multiple pages for bulk edit
- Opening track details dialogs with in-progress edits
- Filtering duplicate detection results
- Scrolling deep into the review queue

Browser refresh, accidental tab close, or browser crash loses all this state. Curators must:

- Re-apply filters
- Re-find their scroll position
- Re-select tracks
- Re-enter partially-edited metadata

This creates frustration and wasted time. Session recovery reduces friction by restoring curator state after interruption.

## Decision

### localStorage-Based Session Recovery

Use `localStorage` to persist curator workflow state and restore it on next session. Prompt curator to restore when saved state exists.

**Scope: Same-browser only**

- State saved to browser's localStorage
- Available after refresh, tab close, browser restart
- Not synced across devices or browsers
- Cleared explicitly by curator or after expiration

### What Gets Saved

**1. Selection State**

```typescript
{
  type: "selection",
  trackIds: string[],           // Selected track IDs
  context: "library" | "playlist",
  contextId?: string,           // Playlist ID if applicable
  timestamp: number
}
```

**2. Open Dialogs**

```typescript
{
  type: "dialogs",
  openDialogs: [
    {
      dialogType: "track-edit",
      entityId: "track-123",
      tab: "basic",             // Active tab in dialog
      unsavedChanges: {         // Form state if not saved
        title: "Updated Title",
        genre: "Jazz"
      }
    },
    {
      dialogType: "merge-preview",
      entityType: "artist",
      sourceId: "artist-1",
      targetId: "artist-2"
    }
  ],
  timestamp: number
}
```

**3. Filters & Sorts**

```typescript
{
  type: "filters",
  page: "/library",
  filters: {
    sort: "most-played-ever",
    direction: "desc",
    hasAudio: true,
    search: "rock"
  },
  scrollPosition: 2400,        // Pixels from top
  timestamp: number
}
```

**4. Active Tab State**

```typescript
{
  type: "activeTab",
  dashboardTab: "review-queue",
  queueTab: "user-reports",
  timestamp: number
}
```

### Recovery Trigger

**Always Prompt:**

On page load, check for saved session state:

```typescript
const savedSession = localStorage.getItem("curator-session");

if (savedSession) {
  // Show modal dialog
  showRecoveryPrompt({
    title: "Restore previous session?",
    description: "You have unsaved curator work from 15 minutes ago",
    details: [
      "25 tracks selected",
      "Track edit dialog open with unsaved changes",
      "Review queue filtered to user reports",
    ],
    actions: [
      { label: "Restore", onClick: restoreSession },
      { label: "Discard", onClick: clearSession },
    ],
  });
}
```

**Prompt Contents:**

- Summary of saved state (X tracks selected, Y dialogs open, etc.)
- Timestamp of save ("15 minutes ago")
- "Restore" and "Discard" buttons

**User Choice:**

- **Restore**: Apply all saved state, close prompt
- **Discard**: Clear localStorage, close prompt, start fresh

### Storage Strategy

**Incremental Updates:**

Don't save entire state on every change. Save on specific actions:

```typescript
// Save selection when changed
function updateSelection(trackIds: string[]) {
  setSelection(trackIds);
  saveToLocalStorage("curator-session-selection", {
    type: "selection",
    trackIds,
    context: currentContext,
    timestamp: Date.now(),
  });
}

// Save dialog state on field change (debounced)
const saveDialogState = debounce((state) => {
  saveToLocalStorage("curator-session-dialogs", {
    type: "dialogs",
    openDialogs: state,
    timestamp: Date.now(),
  });
}, 1000);
```

**Separate Keys:**

Use separate localStorage keys per state type:

- `curator-session-selection`
- `curator-session-dialogs`
- `curator-session-filters`
- `curator-session-tabs`

Allows partial restoration (e.g., restore selection but not dialogs).

**Composite Prompt:**

On load, aggregate all keys and present unified recovery prompt.

### Expiration

**Automatic Expiration:**

Saved state expires after:

- **24 hours** for selection/filters
- **2 hours** for unsaved dialog changes
- **Never** for submitted-but-not-pushed changes (until explicitly cleared)

```typescript
function isExpired(timestamp: number, maxAge: number): boolean {
  return Date.now() - timestamp > maxAge;
}

function loadSession() {
  const selection = getFromLocalStorage("curator-session-selection");
  if (selection && isExpired(selection.timestamp, 24 * 60 * 60 * 1000)) {
    // Expired, don't offer restoration
    localStorage.removeItem("curator-session-selection");
    return null;
  }
  return selection;
}
```

**Manual Clear:**

"Clear Session" button in curator menu:

- Clears all `curator-session-*` keys
- Confirmation dialog: "This will discard your saved session state. Continue?"

### Integration with Real-time Sync

Session recovery works alongside BroadcastChannel sync (ADR-033):

**Scenario:**

1. Curator selects tracks in tab 1
2. Selection saved to localStorage
3. Curator closes tab 1
4. Curator opens new tab 2
5. Recovery prompt offers to restore selection
6. Curator clicks "Restore"
7. Selection loaded from localStorage
8. If tab 1 still open, BroadcastChannel syncs any further changes

**Key Point:** localStorage is the source of truth for cross-session recovery. BroadcastChannel handles same-session sync.

### Security & Privacy

**Sensitive Data:**

Curator session state does NOT contain:

- Password or session tokens
- Personal user data
- Full track metadata (just IDs)

**localStorage Scope:**

- localStorage is origin-scoped (same domain only)
- Not shared across different browsers
- Persists until explicitly cleared or browser storage reset

**Incognito/Private Mode:**

- localStorage cleared when private session ends
- No restoration in next private session
- Acceptable limitation (curators use normal mode for work)

## Consequences

### Positive

- **Reduced friction**: Curators don't lose work on refresh/crash
- **Multi-step workflows**: Complex selections/filters preserved
- **Unsaved changes**: Partially-edited forms recoverable
- **User control**: Curator chooses to restore or discard
- **Simple implementation**: Pure client-side, no server state

### Negative

- **Same-browser only**: Doesn't sync across devices (acceptable for v1)
- **localStorage limits**: 5-10MB cap (sufficient for IDs and small state)
- **No conflict resolution**: If curator works on multiple devices, states don't merge (out of scope)

### Trade-offs

**Why localStorage over sessionStorage?**

- sessionStorage clears when tab closes
- localStorage persists across tab closes and browser restarts
- Recovery needed for browser restart, not just refresh

**Why prompt instead of auto-restore?**

- Curator may intentionally want fresh start
- Unsaved changes may be experiments they don't want
- Prompt gives control

**Why 24-hour expiration?**

- Long enough for multi-day projects with breaks
- Short enough that stale state doesn't accumulate
- Prevents localStorage from growing indefinitely

**Why separate keys instead of single object?**

- Partial restoration possible
- Easier to expire individual pieces
- Avoids writing large object on every small change

## Implementation Notes

### Storage Utilities

```typescript
// app/features/curator/session-recovery.client.ts

type SessionState = SelectionState | DialogState | FilterState | TabState;

function saveToLocalStorage(key: string, state: SessionState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch (e) {
    // localStorage full or disabled
    console.error("Failed to save session state:", e);
  }
}

function getFromLocalStorage(key: string): SessionState | null {
  try {
    const item = localStorage.getItem(key);
    if (!item) return null;

    const parsed = JSON.parse(item);

    // Check expiration
    if (isExpired(parsed)) {
      localStorage.removeItem(key);
      return null;
    }

    return parsed;
  } catch (e) {
    console.error("Failed to load session state:", e);
    return null;
  }
}

function getAllSessionState(): SessionState[] {
  const keys = [
    "curator-session-selection",
    "curator-session-dialogs",
    "curator-session-filters",
    "curator-session-tabs",
  ];

  return keys.map(getFromLocalStorage).filter(Boolean);
}
```

### Recovery Prompt Component

```typescript
function SessionRecoveryPrompt() {
  const sessionStates = getAllSessionState()

  if (sessionStates.length === 0) return null

  const summary = generateSummary(sessionStates)

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restore previous session?</DialogTitle>
          <DialogDescription>
            You have unsaved curator work from {formatTimestamp(oldestTimestamp)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {summary.map(item => (
            <div key={item.key} className="text-sm">
              • {item.description}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={discardSession}>
            Discard
          </Button>
          <Button onClick={restoreSession}>
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

### Restoration Logic

```typescript
function restoreSession() {
  const states = getAllSessionState();

  for (const state of states) {
    switch (state.type) {
      case "selection":
        // Restore selection
        setSelectedTracks(state.trackIds);
        break;

      case "dialogs":
        // Re-open dialogs
        for (const dialog of state.openDialogs) {
          openDialog(dialog.dialogType, dialog.entityId, dialog.unsavedChanges);
        }
        break;

      case "filters":
        // Apply filters
        if (window.location.pathname === state.page) {
          applyFilters(state.filters);
          scrollTo(0, state.scrollPosition);
        }
        break;

      case "activeTab":
        // Set active tabs
        setDashboardTab(state.dashboardTab);
        setQueueTab(state.queueTab);
        break;
    }
  }

  closeRecoveryPrompt();
}
```

## Alternatives Considered

### Server-side session state

Store curator session state in database.

**Rejected because:**

- Requires server writes on every state change (performance impact)
- More complex than localStorage
- Cross-device sync not required for v1
- localStorage sufficient

### sessionStorage instead of localStorage

Use sessionStorage (clears on tab close).

**Rejected because:**

- Doesn't survive tab close or browser restart
- Recovery needed for those scenarios specifically

### IndexedDB instead of localStorage

Use IndexedDB for larger storage and structured data.

**Rejected because:**

- More complex API
- localStorage size limits (5-10MB) sufficient for curator state
- Curator state is small (IDs, not full entities)

### Auto-restore without prompt

Automatically restore session without asking curator.

**Rejected because:**

- Removes curator control
- Curator may want fresh start
- Unsaved changes may be experiments to discard

### Cookie-based storage

Store session state in cookies.

**Rejected because:**

- 4KB size limit too small for selection arrays
- Sent with every HTTP request (performance overhead)
- localStorage more appropriate for client-side state

## References

- Related: ADR-033 (Real-time Sync), ADR-032 (Edit Locking)
- localStorage API: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage

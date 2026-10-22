# ADR-035: Curator Review Queue and User Reports

**Status:** Accepted  
**Date:** 2026-10-02

## Context

Data quality issues arise from multiple sources:

- **Users** report incorrect metadata, missing covers, broken audio
- **System** detects missing fields, low-resolution covers, potential duplicates
- **Curators** manually flag tracks needing attention
- **Import errors** create incomplete or suspicious data

Without a centralized queue, curators don't know what needs attention. Issues get lost, user reports go unanswered, and data quality stagnates. A structured review queue provides visibility, prioritization, and accountability for curator work.

## Decision

### Centralized Review Queue

Implement a single review queue that aggregates issues from all sources:

- User-reported problems
- System-detected quality issues
- Manual curator flags
- Import/sync errors

Queue accessible to all curators. Any curator can claim and resolve items.

### Issue Sources

**1. User Reports**

Users can report issues via track overflow menu ("..."):

- Wrong metadata (wrong artist, title, album, genre, etc.)
- Missing/broken audio
- Wrong cover art
- Duplicate track

**Report Flow:**

1. User clicks "Report Issue" in track overflow menu
2. Select issue type from dropdown
3. Optional description field (500 chars)
4. Submit → creates `ReviewQueueItem` with `source: "user_report"`

**User Feedback:**

- Confirmation toast: "Thank you for reporting this issue"
- Notification when curator resolves it: "Your report about [Track Name] has been resolved by [Curator]"

**2. System-Detected Issues**

Automated detection flags tracks with:

- Missing key metadata (no genre, no year, no album)
- Low-resolution cover art (< 300px width or height)
- Potential duplicate (similar name/artist per ADR-034)
- Import errors (incomplete data from YouTube sync)

**Detection Job:**

```typescript
// Runs daily at 3 AM UTC (after duplicate detection)
async function detectQualityIssues() {
  // Find tracks missing critical metadata
  const missingMetadata = await prisma.track.findMany({
    where: {
      OR: [{ genre: null }, { year: null }, { albumId: null }],
    },
  });

  // Find low-res covers
  const lowResCovers = await prisma.coverImage.findMany({
    where: {
      OR: [{ width: { lt: 300 } }, { height: { lt: 300 } }],
    },
    include: { tracks: true },
  });

  // Create queue items (idempotent - check existing first)
  for (const track of missingMetadata) {
    await createOrUpdateQueueItem({
      source: "system_detected",
      issueType: "missing_metadata",
      entityType: "track",
      entityId: track.id,
    });
  }
}
```

**3. Manual Curator Flags**

Curators can flag tracks directly:

- "Mark as Needs Review" button in track details dialog
- Optional comment explaining issue
- Creates `ReviewQueueItem` with `source: "curator_flagged"`

**4. Import Errors**

YouTube sync or audio archive worker errors create queue items automatically:

- Track import failed to fetch metadata
- Audio download failed after retries
- Playlist sync encountered deleted video

### Database Schema

```prisma
model ReviewQueueItem {
  id            String   @id @default(cuid())
  source        String   // "user_report" | "system_detected" | "curator_flagged" | "import_error"
  issueType     String   // "wrong_metadata" | "missing_audio" | "wrong_cover" | "duplicate" | "missing_metadata" | "low_res_cover" | "import_error"

  // Entity being reviewed
  entityType    String   // "track" | "artist" | "album"
  entityId      String

  // Issue details
  description   String?  // User/curator provided description
  autodetected  Json?    // System-detected issue details (which fields missing, etc.)

  // Lifecycle
  status        String   @default("open") // "open" | "claimed" | "resolved" | "dismissed"
  priority      Int      @default(0)      // Higher = more urgent (user reports = 1, system = 0)

  // Assignment
  claimedBy     String?
  claimedAt     DateTime?

  // Resolution
  resolvedBy    String?
  resolvedAt    DateTime?
  resolution    String?  // Curator's resolution notes

  // Reporter (for user reports)
  reportedBy    String?

  // Timestamps
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  // Relations
  track         Track?   @relation(fields: [entityId], references: [id], onDelete: Cascade)
  claimer       User?    @relation("ClaimedItems", fields: [claimedBy], references: [id], onDelete: SetNull)
  resolver      User?    @relation("ResolvedItems", fields: [resolvedBy], references: [id], onDelete: SetNull)
  reporter      User?    @relation("ReportedItems", fields: [reportedBy], references: [id], onDelete: SetNull)

  @@index([status, priority, createdAt])
  @@index([entityType, entityId])
  @@index([claimedBy])
}
```

### Queue Organization

**Tabbed Interface:**

1. **User Reports** — issues reported by users (highest priority)
2. **Duplicates** — potential duplicate artists/albums from detection
3. **Data Quality** — system-detected issues (missing metadata, low-res covers)
4. **Import Errors** — failed imports/syncs

**Per-Tab Sorting:**

- Default: Oldest first (FIFO)
- Filterable by issue type
- Sortable by date, priority, track/artist name

**Claimed Items:**

- Show "claimed by" badge
- Curator can see their claimed items across all tabs
- Unclaim option (returns to pool)

### Queue Workflow

**1. Claim Item**

Curator clicks "Claim" on queue item:

- Item status → `claimed`
- `claimedBy` set to curator ID
- `claimedAt` set to current time
- Item disappears from others' queues (filtered out)
- Appears in curator's "My Claimed Items" view

**Automatic Unclaim:**

- After 2 hours of inactivity (no edit/resolve action)
- Item returns to open pool
- Prevents abandoned claims from blocking work

**Manual Unclaim:**

- "Unclaim" button visible to original claimer
- Immediately returns to open pool

**2. Resolve Item**

Curator can resolve via multiple paths:

**Path A: Fix Directly**

- Click "Fix" from queue → opens edit dialog
- Curator makes changes → saves
- Return to queue → mark as resolved with auto-generated note

**Path B: Already Fixed**

- If issue already resolved elsewhere, click "Mark Resolved"
- Optional resolution note
- Status → `resolved`

**Path C: Dismiss as Invalid**

- Click "Dismiss" (for false positives or invalid reports)
- Required reason field
- Status → `dismissed`

**Path D: Escalate to Admin**

- Click "Escalate" (for complex issues beyond curator scope)
- Adds `escalated` flag
- Appears in admin-only escalation queue

**Path E: Request More Info (User Reports Only)**

- Click "Request Info"
- Sends notification to reporter asking for clarification
- Item remains `open` or `claimed`

**3. Reporter Notification**

When user report is resolved:

```typescript
await sendNotification({
  userId: item.reportedBy,
  type: "REPORT_RESOLVED",
  title: "Your report has been resolved",
  body: `${resolver.name} resolved your report about "${track.title}". ${item.resolution || ""}`,
});
```

Notification channels (user-configurable):

- In-app (bell icon)
- Email
- Browser push (if PWA installed)

### Configuration

**Issue Type Configuration:**

Curators can configure which system-detected rules apply:

```typescript
// Curator settings page
{
  enabledRules: {
    missingGenre: true,
    missingYear: true,
    missingAlbum: false,     // Some curators don't care about albums
    lowResCover: true,
    potentialDuplicate: true,
  },
  coverResolutionThreshold: 300  // Configurable per-curator
}
```

**Dashboard Integration:**

Review queue summary on curator dashboard:

```
User Reports: 12 open, 3 claimed
Duplicates: 45 groups detected
Data Quality: 234 tracks need attention
Import Errors: 5 failed imports
```

Click any count → navigates to that queue tab.

### Performance Considerations

**Pagination:**

- Load 50 items per page
- Infinite scroll or "Load More" button
- Don't fetch all 1000+ items at once

**Real-time Updates:**

- Use BroadcastChannel (ADR-033) to sync queue state across tabs
- When item claimed in tab 1 → disappears from queue in tab 2
- When item resolved → updates across all curator tabs

**Deduplication:**

- Same track can't have multiple queue items of same type
- Unique constraint on `[entityType, entityId, issueType, status]` (where `status = 'open'`)
- If user reports track already in queue, increment "report count" instead of creating duplicate

## Consequences

### Positive

- **Centralized visibility**: All issues in one place
- **Clear prioritization**: User reports surfaced first
- **Accountability**: Claimed items have owner
- **Feedback loop**: Users notified when reports resolved
- **Configurable**: Curators control which rules apply
- **Scalable**: Pagination handles large queues

### Negative

- **Queue backlog risk**: If issues generated faster than resolved, queue grows indefinitely (mitigated by curator metrics/monitoring)
- **False positive noise**: System detection may flag non-issues (mitigated by dismiss functionality)
- **Notification fatigue**: Users may get too many resolution notifications (mitigated by configurable notification preferences)

### Trade-offs

**Why tabs instead of single list with filters?**

- Clear separation of issue types
- Different workflows for each type (duplicates = merge, user reports = fix or dismiss)
- Easier to prioritize by source

**Why allow unclaim after 2 hours?**

- Balance between preventing abandoned claims and giving curators time to work
- 2 hours enough for most edits, not so long that queue stalls
- Manual unclaim available for immediate release

**Why notify reporters?**

- Closes feedback loop (users know their reports matter)
- Builds trust in curation system
- Encourages future reporting

## Implementation Notes

### API Endpoints

```typescript
// GET /api/curator/queue?tab=user-reports&page=1
→ { items: ReviewQueueItem[], total: number, hasMore: boolean }

// POST /api/curator/queue/:id/claim
→ { success: true, item: ReviewQueueItem }

// POST /api/curator/queue/:id/unclaim
→ { success: true }

// POST /api/curator/queue/:id/resolve
{ resolution: "Fixed genre and year", action: "fixed" }
→ { success: true }

// POST /api/curator/queue/:id/dismiss
{ reason: "Not a duplicate, different artists" }
→ { success: true }

// POST /api/curator/queue/:id/escalate
{ reason: "Requires admin decision on merge" }
→ { success: true }

// POST /api/curator/queue/:id/request-info
{ message: "Can you provide more details about what's wrong?" }
→ { success: true }
```

### Idempotent Detection

```typescript
async function createOrUpdateQueueItem(data) {
  // Check if open item already exists
  const existing = await prisma.reviewQueueItem.findFirst({
    where: {
      entityType: data.entityType,
      entityId: data.entityId,
      issueType: data.issueType,
      status: "open",
    },
  });

  if (existing) {
    // Increment report count if user report
    if (data.source === "user_report") {
      await prisma.reviewQueueItem.update({
        where: { id: existing.id },
        data: {
          // Increment counter in JSON metadata
          autodetected: {
            ...existing.autodetected,
            reportCount: (existing.autodetected?.reportCount || 1) + 1,
          },
        },
      });
    }
    return existing;
  }

  // Create new item
  return prisma.reviewQueueItem.create({ data });
}
```

## Alternatives Considered

### Separate queues per issue type

Completely separate tables for UserReport, SystemIssue, etc.

**Rejected because:**

- Fragmented data model
- Harder to get unified view
- More complex queries
- Single table with `source` field simpler

### Auto-resolve system issues

Automatically fix missing metadata when detected.

**Rejected because:**

- Risk of incorrect auto-fixes
- Loss of curator judgment
- Some issues require human review (e.g., which duplicate to keep)

### No claiming, pure FIFO

All curators work from shared queue, no claiming.

**Rejected because:**

- Race conditions (two curators work on same item)
- No accountability
- Claiming provides clear ownership

### Assign items to specific curators

Admin assigns items to curators (not self-service).

**Rejected because:**

- Bottleneck (admin must triage)
- Less flexible than self-service pool
- Curators know their expertise best

## References

- Related: ADR-031 (Curator Role), ADR-033 (Real-time Sync), ADR-034 (Duplicate Detection)
- User notifications: Existing notification system in `app/utils/notifications.server.ts`

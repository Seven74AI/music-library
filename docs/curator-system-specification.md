# Curator System - Feature Specification

**Version:** 1.0  
**Date:** 2026-10-02  
**Status:** Approved

## Table of Contents

1. [Overview](#overview)
2. [User Roles](#user-roles)
3. [Core Features](#core-features)
4. [Navigation & UI](#navigation--ui)
5. [Workflows](#workflows)
6. [API Endpoints](#api-endpoints)
7. [Database Schema](#database-schema)
8. [Component Architecture](#component-architecture)
9. [Testing Strategy](#testing-strategy)
10. [Dependencies](#dependencies)

---

## Overview

The Curator System empowers trusted users to maintain metadata quality, resolve duplicates, and manage data integrity across the music library. Curators have powerful editing capabilities with full audit trails, collaborative tools, and automated quality detection.

### Goals

- **Data Quality**: Maintain high-quality, complete, accurate metadata
- **Scalability**: Support curation of 10,000+ tracks by multiple curators
- **Transparency**: Full audit trail of all curator actions
- **Collaboration**: Multiple curators work efficiently without conflicts
- **User Feedback**: Process user-reported issues with notifications

### Out of Scope (v1)

- Cross-device sync (same-browser only)
- Machine learning suggestions
- Auto-fixing metadata
- Public curator profiles
- Curator messaging/chat
- Advanced analytics/reporting exports

---

## User Roles

### Curator

**Assignment**: Admin-only via role assignment

**Permissions**:

- Edit track/artist/album metadata
- Merge duplicate artists/albums
- Split artists
- Bulk edit tracks
- Access review queue
- Flag tracks for attention
- Leave curator notes
- View audit logs
- Undo edits (own: 5 min, others: anytime with comment)

**Cannot**:

- Manage user accounts
- Configure system settings
- Delete entities (only edit/merge)
- Access sensitive user data

### Admin

Implicit curator permissions + user/system management

**Additional Permissions**:

- Assign curator role
- Monitor curator activity
- View curator metrics
- Suspend curator role

Admins work within same audit trail requirements (no special override powers).

---

## Core Features

### 1. Metadata Editing

#### Track Metadata

**Basic Fields** (always visible):

- Title (required)
- Artist (required, autocomplete with create)
- Album (autocomplete with create)
- Genre (multi-select, create new)
- Year

**Extended Fields** (collapsible):

- Track Number, Total Tracks, Total Discs
- Album Artist
- BPM (1-300)
- Label
- ISRC
- Release Date, Original Date, Original Year
- Lyrics (textarea)

**UI**:

- 3-tab dialog: Basic, Extended, History
- Auto-save disabled (explicit "Save Changes" button)
- Validation: required fields, number ranges
- Comment dialog (optional for edits, required for restores)

**Lock System** (ADR-032):

- Lock acquired on dialog open
- Read-only view for other curators with "Locked by X" banner
- Auto-unlock when lock released (via BroadcastChannel)
- Manual refresh button fallback
- 30-minute timeout
- Force-unlock with reason

#### Artist Metadata

**Fields**:

- Name (required)
- Biography (textarea)
- Genre (multi-select)
- Image (upload or URL)

**UI**:

- Dedicated artist edit dialog
- Same lock system as tracks
- Image preview with multi-image support (pick primary)

#### Album Metadata

**Fields**:

- Name (required)
- Year
- Artist
- Genre (multi-select)
- Cover Art (upload or URL)

**UI**:

- Dedicated album edit dialog
- Same lock system as tracks
- Cover art multi-upload with primary selection

### 2. Bulk Operations

#### Bulk Edit

**Trigger**:

- Selection mode toggle in curator tools menu
- Select 2+ tracks via checkboxes
- Click "Bulk Edit" button

**UI Flow**:

1. Bulk edit dialog opens
2. Form with fields to update (leave blank = no change)
3. Show more/fewer fields toggle
4. Comment field (required for audit)
5. Preview table showing all changes
6. Confirmation: "Apply", "Cancel", or adjust

**Soft Limit**: 100 tracks

- Warning shown if 100+ tracks selected
- Allow override with confirmation

**Execution**:

- Live progress panel (detailed log per track)
- Can cancel mid-operation (rollback all)
- Partial failure: show counts, offer "Keep N changes" or "Rollback all" or "Retry M failed"

**Fields Supported**:

- Artist, Album, Genre (add/replace), Year
- Album Artist, Track Number, BPM, Label
- (Not title - too track-specific)

### 3. Merge Operations

#### Artist Merge

**Trigger**:

- From duplicates page: "Merge These →" button
- From artist management page: select 2+ artists → merge

**UI Flow**:

1. Merge preview dialog
2. Source/target selection (swappable)
3. Side-by-side metadata comparison (all fields)
4. Full track list (toggle between flat list and grouped by album)
5. Recommendation badge (e.g., "Keep this one - better metadata")
6. Comment field (required)
7. Confirm merge

**Result**:

- All source tracks relinked to target artist
- Source artists marked as merged (soft delete)
- Audit trail entry
- Success message + option to review merged artist

#### Album Merge

Same flow as artist merge, with album-specific fields.

#### Artist Split

**Trigger**:

- From artist page: "Split Artist" button

**Use Cases**:

- Different artists with same name
- Featuring artists that should be separate

**UI Flow**:

1. Split dialog opens
2. Track list with manual selection checkboxes
3. Smart suggestions based on patterns (date, album, metadata)
4. Select tracks to move to new artist
5. Prompt for new artist names (both source and target)
6. Comment field (required)
7. Confirm split

**Result**:

- Selected tracks relinked to new artist
- Both artists exist independently
- Audit trail entry

### 4. Duplicate Detection (ADR-034)

**Algorithm**:

- **Artists**: Levenshtein distance on normalized names
- **Albums**: Same artist + similar name + similar year
- Cached results, refresh daily + manual refresh

**UI** (`/curator/duplicates`):

- Filter buttons: Both | Artists Only | Albums Only
- Separate sections for exact vs fuzzy matches
- Each group shows:
  - Normalized name
  - List of duplicate entities with counts
  - "Primary" badge on largest
  - "Merge These →" button

**Merge Flow**:

- Click "Merge These →"
- Opens merge preview dialog (see Merge Operations)
- Complete merge
- Duplicate group disappears from list

### 5. Review Queue (ADR-035)

**Path**: `/curator/queue`

**Tabs**:

1. **User Reports** - Issues reported by users
2. **Duplicates** - Potential duplicates from detection
3. **Data Quality** - System-detected issues
4. **Import Errors** - Failed imports/syncs

**Issue Sources**:

- User reports (track overflow menu → "Report Issue")
- System detection (missing metadata, low-res covers)
- Curator flags ("Mark as Needs Review")
- Import errors (YouTube sync failures)

**Queue Item Display**:

- Issue type badge
- Entity name (track/artist/album)
- Description/details
- Reporter (for user reports)
- Timestamp
- "Claim" button

**Claim Flow**:

1. Curator clicks "Claim"
2. Item disappears from others' queues
3. Appears in curator's "My Claimed Items"
4. Auto-unclaim after 2 hours inactivity

**Resolution Actions**:

- **Fix** - Opens edit dialog, auto-resolves on save
- **Mark Resolved** - Already fixed elsewhere
- **Dismiss** - Invalid report (reason required)
- **Escalate** - Send to admin
- **Request Info** - Ask reporter for clarification (user reports only)

**Reporter Notification**:

- When resolved: "Your report about [Track] has been resolved by [Curator]. [Resolution notes]"
- Channels: in-app, email, browser push (user-configurable)

### 6. Data Quality Dashboard

**Path**: `/curator/dashboard`

**Tabs**:

1. **Overview** - Metrics, queue summary, activity feed
2. **Queue** - Embedded review queue
3. **Reports** - Detailed quality reports
4. **Activity** - Full curator activity feed

**Overview Tab**:

- **Metadata Completeness**:
  - Overall percentage (e.g., "Library is 73% complete")
  - Per-field breakdown bars (Genre: 85%, BPM: 45%, etc.)
  - Trend graph (last 30 days)

- **Problem Tracks Summary**:
  - Counts by issue type (clickable to filter library)
  - Prioritized queue (most critical first)

- **Curator Leaderboard**:
  - All curators with pagination
  - Time period filter (this week, this month, all time)
  - Metrics: Edits, Merges, Quality contributions
  - Badges displayed next to names

- **Live Activity Feed**:
  - Recent curator actions (edits, merges, bulk ops, queue claims)
  - Timestamps ("X minutes ago")
  - Filter by: curator, action type, time range

**Reports Tab**:

- Metadata completeness report
- Data quality trends
- Problem tracks report
- Export: None (no CSV/JSON exports in v1)

### 7. Genre Management

**Path**: `/curator/genres`

**Features**:

- List all genres with usage counts
- Create new genre (name only)
- Rename genre (updates all tracks)
- Merge genres (source → target)
- Delete genre (removes from all tracks)
- View tracks by genre (clickable count)

**Multi-Genre Support** (ADR-037):

- Tracks can have unlimited genres
- Flat list (no hierarchy)
- Multi-select dropdown + tag input
- Display as removable pills/chips

### 8. Curator Notes

**UI**:

- Dedicated "Notes" tab in track/artist/album details dialog
- Badge indicator on entity rows (click to view)

**Note Types**:

- Question, Warning, Info, Resolved
- Threaded conversations (replies)
- @ mentions (notify mentioned curator)

**Visibility**: Curators and admins only

### 9. Audit Trail

**Per-Entity History**:

- History tab in track/artist/album details dialog
- Timeline of all edits (newest first)
- Each entry shows:
  - Editor name
  - Timestamp
  - Comment (if provided)
  - Field-by-field changes (before → after)
  - "Restore" button (except most recent)

**System-Wide Audit Log**:

- Path: `/curator/audit`
- All curator actions:
  - Track/artist/album edits
  - Merges and splits
  - Bulk operations
  - Queue resolutions
- Filterable by:
  - Curator (see only own / all)
  - Date range
  - Action type
  - Entity search (track/artist/album name)
- Paginated (50 entries per page)

### 10. Undo System

**Quick Undo** (5 minutes, own edits):

- Toast notification after edit with "Undo" button
- Click "Undo" → confirmation popup
- Reverts changes immediately
- No comment required

**Delayed Undo** (anytime, any curator's edits):

- From History tab: "Restore" button
- Required comment explaining why
- Creates new audit entry
- Broadcasts update via BroadcastChannel

### 11. Session Recovery (ADR-036)

**Saved State**:

- Selection state (track IDs, context)
- Open dialogs (which dialogs, active tab, unsaved changes)
- Filters & sorts (page, filters, scroll position)
- Active tabs (dashboard tab, queue tab)

**Recovery Prompt**:

- On page load, check localStorage
- Modal dialog: "Restore previous session?"
- Summary of saved state (X tracks selected, Y dialogs open)
- Timestamp ("15 minutes ago")
- Actions: "Restore" or "Discard"

**Expiration**:

- Selection/filters: 24 hours
- Unsaved changes: 2 hours
- Manual clear: "Clear Session" in curator menu

### 12. Metadata Clipboard

**Field-Level Copy**:

- Small copy icon next to each field
- Click to copy value
- Paste into same field on another track

**Selective Bulk Template**:

- "Copy selected fields..." button
- Checklist: which fields to copy
- "Copy" → creates template
- "Paste template" fills only checked fields

**Apply from Similar Track**:

- "Copy from similar track..." button
- Search dialog to find track
- Side-by-side comparison
- Checkboxes for which fields to copy
- Apply selected fields

### 13. Cover Image Management

**Upload Sources**:

- File upload (drag-drop or browse)
- URL input

**Validation**:

- Minimum resolution: 500x500px
- No file size limit in v1 (reasonable curator judgment)
- Formats: JPG, PNG, WEBP

**Multi-Image Support**:

- Upload multiple images per entity
- Pick primary image
- Show all images in gallery view

**Bulk Operations**:

- Apply same cover to multiple tracks
- Remove/reset covers from multiple tracks

---

## Navigation & UI

### Curator Tools Menu

**Trigger**: Pencil icon button in top app header (global)

**Menu Items**:

1. **Selection Mode** - Toggle (on/off indicator)
2. **Curator Dashboard** - Link to `/curator/dashboard`
3. **Duplicates** - Link to `/curator/duplicates`
4. **Genre Management** - Link to `/curator/genres`
5. **Review Queue** - Link to `/curator/queue`
6. **My Stats** - Link to `/curator/stats` (personal metrics)
7. **Clear Session** - Clear saved session state

**Visual**: Floating above other content, z-index management

### User Dropdown (Additions)

For curators:

- Link to curator dashboard (same as tools menu)

For admins (existing):

- All existing admin links remain

### Track Overflow Menu

**For All Users**:

- Existing actions (Play Next, Add to Up Next, etc.)
- **Report Issue** (new) - Opens report dialog

**For Curators** (additional):

- **Edit Metadata** (top of menu, most prominent) - Opens 3-tab edit dialog

### Music Player

**For Curators**:

- Edit icon button (pencil) to right of "..." overflow button
- Desktop and mobile
- Opens track details dialog
- Keeps playing (doesn't pause)

### Selection Mode (Library Page)

**When Off**:

- No checkboxes visible
- Curator uses library like regular user

**When On**:

- Checkboxes appear on all track rows
- Selection controls appear (select all, deselect all, count, bulk edit button)
- Toggleable via curator tools menu
- Saved in localStorage (persists across sessions)

### Breadcrumbs

**Where**: Top of all curator pages

**Examples**:

- `/curator/dashboard` → "Curator Dashboard"
- `/curator/queue` → "Curator Dashboard › Review Queue"
- `/curator/duplicates` → "Curator Dashboard › Duplicates"

**Contextual Back Links**:

- Editing track from library: "← Back to Library"
- Editing track from queue: "← Back to Queue"

### Navigation Persistence

**Remembered State** (per-page localStorage):

- Active tab (dashboard, queue)
- Filters and sorts
- Scroll position

**Restored On Return**:

- Same filters applied
- Same tab active
- Scroll position maintained

---

## Workflows

### Workflow 1: Edit Track Metadata

1. User opens track (library, queue, player, etc.)
2. Click "Edit Metadata" (overflow menu or player edit icon)
3. Dialog opens, lock acquired
4. Curator edits fields across Basic/Extended tabs
5. Click "Save Changes"
6. Optional comment dialog appears
7. Submit (with or without comment)
8. Lock released, BroadcastChannel notifies other tabs
9. Toast notification with "Undo" button (5 min window)
10. History tab updated with new edit entry

**Lock Conflict**:

- If locked by another curator:
  - Dialog opens read-only
  - Banner: "Locked by Alice (editing for 5 minutes)"
  - Manual "Refresh" button
  - Auto-unlock + refresh when Alice finishes

### Workflow 2: Bulk Edit Tracks

1. Curator enables selection mode (curator tools menu)
2. Checkboxes appear on track rows
3. Curator selects 25 tracks
4. Click "Bulk Edit" button
5. Bulk edit dialog opens
6. Fill fields to update (leave others blank)
7. Add required comment
8. Click "Preview Changes"
9. Preview table shows all 25 tracks with pending changes
10. Confirm "Apply to 25 Tracks"
11. Live progress panel shows:
    - "Processing track 1 of 25..."
    - "Updated: Song Title 1"
    - "Processing track 2 of 25..."
12. All complete: "25 tracks updated successfully"
13. Selection cleared automatically

**Partial Failure**:

- If 3 tracks fail:
  - "22 tracks updated, 3 failed"
  - Show failed tracks with error reasons
  - Options: "Keep 22 changes", "Rollback all", "Retry 3 failed"

### Workflow 3: Merge Duplicate Artists

1. Curator opens `/curator/duplicates`
2. Click "Artists Only" filter
3. See duplicate group: "The Beatles" / "Beatles" / "Betles"
4. Click "Merge These →"
5. Merge preview dialog opens
6. See metadata comparison:
   - "The Beatles": 245 tracks, 13 albums, bio filled
   - "Beatles": 12 tracks, 1 album, no bio
   - "Betles": 3 tracks, 0 albums, no bio
7. Recommendation badge: "Keep this one - best metadata" on "The Beatles"
8. Curator swaps if needed (arrows to switch source/target)
9. Toggle track list view: grouped by album
10. Add comment: "Merging typos and variations"
11. Click "Confirm Merge"
12. Merge executes:
    - 260 tracks relinked
    - 2 source artists marked merged
13. Success message: "Merged 3 artists into The Beatles"
14. Option: "Review merged artist"

### Workflow 4: Process User Report

1. User reports track (wrong artist)
2. Report appears in `/curator/queue` → User Reports tab
3. Curator sees item:
   - "Wrong metadata"
   - Track: "Bohemian Rhapsody"
   - Reporter: "john_doe"
   - Description: "Artist should be Queen, not Queen + David Bowie"
4. Curator clicks "Claim"
5. Curator clicks "Fix"
6. Edit dialog opens
7. Curator changes artist to "Queen"
8. Saves with comment: "Fixed per user report - removed incorrect featuring artist"
9. Queue item auto-resolved
10. Notification sent to john_doe:
    - "Your report about Bohemian Rhapsody has been resolved by Alice. Fixed per user report - removed incorrect featuring artist"

### Workflow 5: Session Recovery After Browser Crash

1. Curator working on library:
   - 50 tracks selected
   - Track edit dialog open with unsaved changes
   - Filtered to show "Rock" genre only
2. Browser crashes
3. Curator reopens browser
4. Navigates to library
5. Modal dialog appears:
   - "Restore previous session?"
   - "You have unsaved curator work from 2 minutes ago"
   - Details:
     - "50 tracks selected"
     - "Track edit dialog open with unsaved changes"
     - "Rock genre filter applied"
6. Curator clicks "Restore"
7. State restored:
   - 50 tracks selected with checkboxes
   - Edit dialog reopens with form fields filled
   - Genre filter applied
   - Scroll position maintained
8. Curator continues working

---

## API Endpoints

### Track Metadata

```
POST   /api/metadata/tracks/:id/edit
GET    /api/metadata/tracks/:id/history
POST   /api/metadata/tracks/:id/restore/:editId
POST   /api/metadata/tracks/bulk-edit
```

### Artist Metadata

```
POST   /api/metadata/artists/:id/edit
GET    /api/metadata/artists/:id/history
POST   /api/metadata/artists/:id/restore/:editId
POST   /api/artists/create
GET    /api/artists/search
```

### Album Metadata

```
POST   /api/metadata/albums/:id/edit
GET    /api/metadata/albums/:id/history
POST   /api/metadata/albums/:id/restore/:editId
```

### Merge Operations

```
POST   /api/metadata/artists/merge
POST   /api/metadata/albums/merge
POST   /api/metadata/artists/split
```

### Duplicate Detection

```
GET    /api/metadata/artists/duplicates
GET    /api/metadata/albums/duplicates
POST   /api/metadata/duplicates/refresh
```

### Review Queue

```
GET    /api/curator/queue?tab=user-reports&page=1
POST   /api/curator/queue/:id/claim
POST   /api/curator/queue/:id/unclaim
POST   /api/curator/queue/:id/resolve
POST   /api/curator/queue/:id/dismiss
POST   /api/curator/queue/:id/escalate
POST   /api/curator/queue/:id/request-info
```

### Genres

```
GET    /api/curator/genres
POST   /api/curator/genres
PUT    /api/curator/genres/:id
DELETE /api/curator/genres/:id
POST   /api/curator/genres/merge
```

### Locks

```
POST   /api/locks/acquire
POST   /api/locks/release
POST   /api/locks/force-unlock
GET    /api/locks/status
```

### Cover Images

```
POST   /api/images/upload
POST   /api/images/from-url
PUT    /api/images/:id/set-primary
DELETE /api/images/:id
```

### Curator Notes

```
GET    /api/curator/notes/:entityType/:entityId
POST   /api/curator/notes
POST   /api/curator/notes/:id/reply
PUT    /api/curator/notes/:id/resolve
```

### Dashboard & Stats

```
GET    /api/curator/dashboard/metrics
GET    /api/curator/dashboard/activity
GET    /api/curator/dashboard/leaderboard
GET    /api/curator/stats/:userId
```

---

## Database Schema

See ADR documents for detailed schema:

- ADR-031: Role & permissions
- ADR-032: EditLock table
- ADR-034: DuplicateDetection, NormalizedName tables
- ADR-035: ReviewQueueItem table
- ADR-037: Genre, _TrackGenres tables

**New Tables**:

```prisma
model EditLock {
  id          String   @id @default(cuid())
  entityType  String
  entityId    String
  lockedBy    String
  lockedAt    DateTime @default(now())
  expiresAt   DateTime
  user        User     @relation(fields: [lockedBy], references: [id], onDelete: Cascade)
  @@unique([entityType, entityId])
  @@index([expiresAt])
}

model ReviewQueueItem {
  id            String   @id @default(cuid())
  source        String
  issueType     String
  entityType    String
  entityId      String
  description   String?
  autodetected  Json?
  status        String   @default("open")
  priority      Int      @default(0)
  claimedBy     String?
  claimedAt     DateTime?
  resolvedBy    String?
  resolvedAt    DateTime?
  resolution    String?
  reportedBy    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([status, priority, createdAt])
  @@index([entityType, entityId])
}

model Genre {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  createdAt   DateTime @default(now())
  tracks      Track[]  @relation("TrackGenres")
}

model CuratorNote {
  id          String        @id @default(cuid())
  entityType  String
  entityId    String
  authorId    String
  noteType    String        // "question" | "warning" | "info" | "resolved"
  content     String
  parentId    String?       // For threaded replies
  resolved    Boolean       @default(false)
  createdAt   DateTime      @default(now())
  author      User          @relation(fields: [authorId], references: [id], onDelete: Cascade)
  parent      CuratorNote?  @relation("NoteReplies", fields: [parentId], references: [id], onDelete: Cascade)
  replies     CuratorNote[] @relation("NoteReplies")
  @@index([entityType, entityId])
  @@index([authorId])
}

model DuplicateDetection {
  id          String   @id @default(cuid())
  entityType  String
  lastRunAt   DateTime @default(now())
  results     Json
  @@unique([entityType])
}

model NormalizedName {
  id             String @id @default(cuid())
  entityType     String
  entityId       String
  normalizedName String
  @@index([entityType, normalizedName])
  @@unique([entityType, entityId])
}

model ArtistEdit {
  // Similar to TrackEdit
  id          String   @id @default(cuid())
  artistId    String
  editedBy    String
  comment     String?
  name        String
  bio         String?
  genres      Json     // Array of genre IDs
  imageId     String?
  editedAt    DateTime @default(now())
  artist      Artist   @relation(fields: [artistId], references: [id], onDelete: Cascade)
  editor      User     @relation(fields: [editedBy], references: [id], onDelete: Cascade)
  @@index([artistId, editedAt])
}

model AlbumEdit {
  // Similar to TrackEdit
  id          String   @id @default(cuid())
  albumId     String
  editedBy    String
  comment     String?
  name        String
  year        Int?
  artistId    String
  genres      Json
  coverId     String?
  editedAt    DateTime @default(now())
  album       Album    @relation(fields: [albumId], references: [id], onDelete: Cascade)
  editor      User     @relation(fields: [editedBy], references: [id], onDelete: Cascade)
  @@index([albumId, editedAt])
}

model CuratorBadge {
  id          String   @id @default(cuid())
  userId      String
  badgeType   String   // "edits-100", "merges-50", "quality-fix-100", "streak-7"
  level       Int      // 1-10
  earnedAt    DateTime @default(now())
  user        User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([userId, badgeType])
  @@index([userId])
}
```

**Modified Tables**:

```prisma
model Track {
  // Remove: genre String?
  // Add:
  genres  Genre[]  @relation("TrackGenres")
  notes   CuratorNote[]
}

model Artist {
  // Add:
  bio         String?
  genres      Genre[]  @relation("ArtistGenres")
  images      CoverImage[]
  notes       CuratorNote[]
  edits       ArtistEdit[]
  normalizedName NormalizedName?
}

model Album {
  // Add:
  genres      Genre[]  @relation("AlbumGenres")
  covers      CoverImage[]
  notes       CuratorNote[]
  edits       AlbumEdit[]
  normalizedName NormalizedName?
}

model CoverImage {
  // Add:
  width       Int?
  height      Int?
  isPrimary   Boolean @default(false)
}
```

---

## Component Architecture

### Core Components

```
app/
  features/
    curator/
      sync.client.ts                 # BroadcastChannel management
      session-recovery.client.ts     # localStorage recovery logic
      selection.client.ts            # Selection state management
      locks.client.ts                # Lock acquisition/release

  components/
    curator/
      curator-tools-menu.tsx         # Pencil icon dropdown
      selection-mode-toggle.tsx      # Toggle component
      selection-controls.tsx         # Select all, bulk edit button

    track-details-dialog/
      track-details-dialog.tsx       # Main dialog wrapper
      basic-metadata-tab.tsx         # Basic fields form
      extended-metadata-tab.tsx      # Extended fields form
      history-tab.tsx                # Edit history timeline
      notes-tab.tsx                  # Curator notes
      comment-dialog.tsx             # Optional comment modal

    artist-edit-dialog/
      artist-edit-dialog.tsx         # Main dialog
      metadata-form.tsx              # Artist fields
      image-upload.tsx               # Multi-image uploader
      history-tab.tsx                # Edit history
      notes-tab.tsx                  # Curator notes

    album-edit-dialog/
      album-edit-dialog.tsx          # Main dialog
      metadata-form.tsx              # Album fields
      cover-upload.tsx               # Multi-cover uploader
      history-tab.tsx                # Edit history
      notes-tab.tsx                  # Curator notes

    bulk-edit-dialog/
      bulk-edit-dialog.tsx           # Main dialog
      fields-form.tsx                # Fields to update
      preview-table.tsx              # Changes preview
      progress-panel.tsx             # Live progress log

    merge-preview-dialog/
      merge-preview-dialog.tsx       # Main dialog
      metadata-comparison.tsx        # Side-by-side fields
      track-list.tsx                 # Affected tracks
      recommendation-badge.tsx       # Smart suggestions

    split-artist-dialog/
      split-artist-dialog.tsx        # Main dialog
      track-selection.tsx            # Manual + smart select
      name-inputs.tsx                # New artist names

    review-queue/
      queue-tabs.tsx                 # Tab navigation
      queue-list.tsx                 # Paginated list
      queue-item.tsx                 # Single item card
      claim-button.tsx               # Claim action
      resolution-dialog.tsx          # Resolve/dismiss

    curator-dashboard/
      dashboard-tabs.tsx             # Tab navigation
      overview-tab.tsx               # Metrics, queue, feed
      metrics-panel.tsx              # Completeness stats
      problem-tracks-panel.tsx       # Issues summary
      leaderboard.tsx                # Curator rankings
      activity-feed.tsx              # Live actions
      reports-tab.tsx                # Detailed reports

    genre-management/
      genre-list.tsx                 # All genres table
      genre-create-dialog.tsx        # Add genre
      genre-merge-dialog.tsx         # Merge duplicates
      genre-rename-dialog.tsx        # Rename

    curator-notes/
      notes-list.tsx                 # Threaded display
      note-item.tsx                  # Single note
      note-composer.tsx              # New note form
      mention-autocomplete.tsx       # @ mention

    metadata-clipboard/
      field-copy-button.tsx          # Per-field copy icon
      template-dialog.tsx            # Selective copy
      similar-track-dialog.tsx       # Apply from similar

    session-recovery/
      recovery-prompt.tsx            # Modal dialog

    shared/
      lock-banner.tsx                # Read-only lock indicator
      undo-toast.tsx                 # Quick undo notification
      breadcrumbs.tsx                # Navigation breadcrumbs
      genre-select.tsx               # Multi-genre input
      artist-autocomplete.tsx        # Artist search + create
      album-autocomplete.tsx         # Album search + create
      image-uploader.tsx             # Shared upload

  routes/
    curator+/
      dashboard.tsx                  # Main dashboard
      queue.tsx                      # Review queue
      duplicates.tsx                 # Duplicate detection
      genres.tsx                     # Genre management
      audit.tsx                      # System-wide audit log
      stats.$userId.tsx              # Personal stats

    api+/
      curator+/
        queue.tsx                    # Queue endpoints
        genres.tsx                   # Genre CRUD
        dashboard.tsx                # Dashboard data

      metadata+/
        tracks+/
          $trackId.edit.tsx          # Edit endpoint
          $trackId.history.tsx       # History endpoint
          $trackId.restore.$editId.tsx # Restore endpoint
          bulk-edit.tsx              # Bulk edit

        artists+/
          $artistId.edit.tsx
          $artistId.history.tsx
          $artistId.restore.$editId.tsx
          merge.tsx                  # Merge artists
          split.tsx                  # Split artist
          duplicates.tsx             # Duplicate detection

        albums+/
          $albumId.edit.tsx
          $albumId.history.tsx
          $albumId.restore.$editId.tsx
          merge.tsx                  # Merge albums
          duplicates.tsx             # Duplicate detection

      locks+/
        acquire.tsx
        release.tsx
        force-unlock.tsx
        status.tsx

      images+/
        upload.tsx
        from-url.tsx
        set-primary.tsx
```

---

## Testing Strategy

### Unit Tests

**Target**: 90%+ coverage for curator utilities

**Files**:

- `curator.server.ts` - Permission checks
- `locks.client.ts` - Lock acquisition/release
- `session-recovery.client.ts` - localStorage logic
- `sync.client.ts` - BroadcastChannel handling
- Duplicate detection algorithm
- Levenshtein distance implementation

### Integration Tests

**API Endpoints**:

- All metadata edit endpoints
- Merge operations
- Review queue operations
- Lock system
- Bulk edit

**Database**:

- Schema migrations
- Audit trail creation
- Multi-genre relationships
- Lock cleanup job

### E2E Tests (Playwright)

**Critical Paths**:

1. Edit track metadata as curator
2. Bulk edit multiple tracks
3. Merge duplicate artists
4. Process user report from queue
5. Create and manage genres
6. Lock system (concurrent editing)
7. Session recovery after refresh

**Test User**:

- `kody:kodylovesyou` (already exists, assign curator role)

### Manual Testing

**UI/UX Verification**:

- Curator tools menu placement
- Selection mode toggle behavior
- Real-time sync across tabs (open 2 tabs)
- Lock banners and auto-unlock
- Progress panels for bulk operations
- Mobile curator experience (responsive)

**Performance**:

- Bulk edit 200+ tracks
- Duplicate detection with 10,000+ artists
- Review queue with 1000+ items (pagination)
- Real-time sync with 10+ tabs open

---

## Dependencies

### New Dependencies

```json
{
  "dependencies": {
    "js-levenshtein": "^1.1.6" // Duplicate detection
  }
}
```

### Existing Dependencies (verify compatibility)

- `@tanstack/react-query` - Query caching, invalidation
- `@radix-ui/react-tabs` - Already used for track details
- `@radix-ui/react-dialog` - Already used
- `@radix-ui/react-popover` - For dropdowns
- `@radix-ui/react-checkbox` - Selection checkboxes

### Browser APIs

- `BroadcastChannel` - Real-time sync (Safari 15.4+)
- `localStorage` - Session recovery
- `IntersectionObserver` - Infinite scroll (optional)

---

## Implementation Phases

See separate `curator-system-implementation-plan.md` for detailed breakdown.

High-level phases:

1. **Foundation** - Permissions, locks, sync infrastructure
2. **Core Editing** - Track/artist/album edit dialogs with history
3. **Bulk Operations** - Selection mode, bulk edit, progress
4. **Quality Tools** - Review queue, duplicate detection, dashboard
5. **Collaboration** - Notes, audit log, badges
6. **Polish** - Session recovery, clipboard, mobile optimization

---

## References

- ADR-031: Curator Role and Permission System
- ADR-032: Concurrent Edit Locking Mechanism
- ADR-033: Real-time Curator Sync Across Browser Tabs
- ADR-034: Duplicate Detection Algorithm
- ADR-035: Curator Review Queue and User Reports
- ADR-036: Curator Session Recovery
- ADR-037: Multi-Genre Tagging System
- Existing: Track edit history implementation (already done)
- Existing: `curator` role and permissions (already created)

---

**End of Specification**

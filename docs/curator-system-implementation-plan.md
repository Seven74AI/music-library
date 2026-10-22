# Curator System - Implementation Plan

**Version:** 1.0  
**Date:** 2026-10-02

## Table of Contents

1. [Overview](#overview)
2. [Dependency Graph](#dependency-graph)
3. [Implementation Phases](#implementation-phases)
4. [Work Parallelization](#work-parallelization)
5. [Task Breakdown](#task-breakdown)
6. [Database Migrations](#database-migrations)
7. [Testing Checkpoints](#testing-checkpoints)
8. [Risks & Mitigations](#risks--mitigations)

---

## Overview

The Curator System is a large feature set that can be broken into parallel workstreams. This plan identifies dependencies, parallelization opportunities, and a suggested implementation order.

### Estimated Scope

- **Database migrations**: 5 migrations
- **API endpoints**: ~40 endpoints
- **UI components**: ~60 components
- **Utilities**: ~15 utility modules
- **Tests**: ~200 test cases (unit + integration + E2E)

### Key Principles

1. **Foundation First**: Infrastructure (locks, sync, permissions) before features
2. **Vertical Slices**: Complete one feature end-to-end before moving to next
3. **Parallel Workstreams**: Independent features developed concurrently
4. **Test as You Go**: Unit/integration tests with each PR, E2E at phase completion
5. **Incremental Rollout**: Hide behind feature flag until complete

---

## Dependency Graph

```
Foundation (Phase 0)
├── Database Schemas
├── Permission Utilities
├── BroadcastChannel Sync
└── Lock System
    │
    ├─→ Track Editing (Phase 1A)
    │   ├── Edit Dialog
    │   ├── History Tab
    │   └── Artist/Album Autocomplete
    │
    ├─→ Artist/Album Editing (Phase 1B)  [PARALLEL with 1A]
    │   ├── Edit Dialogs
    │   └── History Implementation
    │
    ├─→ Bulk Operations (Phase 2)  [Depends on 1A]
    │   ├── Selection Mode
    │   ├── Bulk Edit Dialog
    │   └── Progress System
    │
    ├─→ Review Queue (Phase 3A)  [Can start after Foundation]
    │   ├── Queue Infrastructure
    │   ├── User Reports
    │   └── System Detection
    │
    ├─→ Duplicate Detection (Phase 3B)  [PARALLEL with 3A]
    │   ├── Algorithm Implementation
    │   ├── Detection Job
    │   └── Merge UI
    │
    ├─→ Curator Dashboard (Phase 4)  [Depends on 2, 3A, 3B]
    │   ├── Metrics
    │   ├── Leaderboard
    │   └── Activity Feed
    │
    ├─→ Genre Management (Phase 5A)  [Can start after Foundation]
    │   ├── Multi-Genre Migration
    │   ├── Genre CRUD
    │   └── Management UI
    │
    ├─→ Curator Notes (Phase 5B)  [PARALLEL with 5A]
    │   ├── Notes System
    │   ├── Threading
    │   └── @ Mentions
    │
    └─→ Polish (Phase 6)  [Depends on all above]
        ├── Session Recovery
        ├── Metadata Clipboard
        ├── Badges & Achievements
        └── Mobile Optimization
```

---

## Implementation Phases

### Phase 0: Foundation (Week 1-2)

**Goal**: Core infrastructure for curator system

**Deliverables**:

1. Database migrations (all tables)
2. Permission utilities (`requireCuratorOrAdmin`, etc.)
3. BroadcastChannel sync infrastructure
4. Lock system (acquire, release, cleanup)
5. Curator tools menu (UI shell, no content yet)

**Testing**: Unit tests for utilities, integration tests for lock system

**Feature Flag**: `CURATOR_SYSTEM_ENABLED=false` (hidden from prod)

---

### Phase 1: Metadata Editing (Week 3-4)

#### Phase 1A: Track Editing [Primary Stream]

**Deliverables**:

1. Track edit dialog (3 tabs: Basic, Extended, History)
2. Edit API endpoint with validation
3. History API endpoint
4. Restore endpoint
5. Comment dialog component
6. Artist autocomplete with create
7. Lock integration in edit dialog
8. Undo toast notification

**Testing**:

- Unit: Form validation, history parsing
- Integration: Edit/history/restore endpoints
- E2E: Full edit workflow with lock

#### Phase 1B: Artist & Album Editing [Parallel Stream]

**Deliverables**:

1. Artist edit dialog (metadata + image upload)
2. Album edit dialog (metadata + cover upload)
3. ArtistEdit & AlbumEdit tables + history API
4. Image upload utilities (file + URL)
5. Multi-image support (gallery, pick primary)

**Testing**:

- Unit: Image validation
- Integration: Artist/album edit endpoints
- E2E: Edit workflows

**Merge Point**: Both streams complete → Phase 2

---

### Phase 2: Bulk Operations (Week 5)

**Depends On**: Phase 1A (track editing)

**Deliverables**:

1. Selection mode toggle in curator tools menu
2. Selection state management (localStorage + BroadcastChannel)
3. Track row checkboxes (conditional on selection mode)
4. Selection controls component (select all, bulk edit button)
5. Bulk edit dialog with preview
6. Bulk edit API endpoint
7. Progress panel with live log
8. Partial failure handling (keep/rollback/retry)

**Testing**:

- Unit: Selection state logic, preview generation
- Integration: Bulk edit endpoint with conflict scenarios
- E2E: Full bulk edit workflow (100+ tracks)

---

### Phase 3: Quality Tools (Week 6-7)

#### Phase 3A: Review Queue [Primary Stream]

**Deliverables**:

1. ReviewQueueItem table & API
2. User report flow (track overflow menu)
3. Queue UI (tabs, pagination, filtering)
4. Claim/unclaim system
5. Resolution actions (fix, dismiss, escalate, request info)
6. Reporter notifications
7. System detection job (missing metadata, low-res covers)
8. Manual curator flagging

**Testing**:

- Unit: Queue filtering, claim logic
- Integration: All queue endpoints
- E2E: User report → curator resolve → notification

#### Phase 3B: Duplicate Detection [Parallel Stream]

**Depends On**: Phase 1B (artist/album editing for merge)

**Deliverables**:

1. Levenshtein distance implementation
2. Normalization utilities
3. Detection algorithm (exact + fuzzy)
4. Detection job (daily cron)
5. DuplicateDetection & NormalizedName tables
6. Duplicates page UI
7. Merge preview dialog (comparison, track list)
8. Merge API endpoints (artists, albums)
9. Artist split dialog & API

**Testing**:

- Unit: Levenshtein, normalization, detection logic
- Integration: Merge endpoints, split endpoint
- E2E: Duplicate detection → merge workflow

**Merge Point**: Both streams complete → Phase 4

---

### Phase 4: Curator Dashboard (Week 8)

**Depends On**: Phases 2, 3A, 3B (needs data to display)

**Deliverables**:

1. Dashboard page with tabs
2. Metrics panel (completeness stats, trends)
3. Problem tracks panel (clickable counts)
4. Curator leaderboard (with time filters)
5. Activity feed (live curator actions via BroadcastChannel)
6. Reports tab (detailed views)
7. Dashboard API endpoints (metrics, activity, leaderboard)
8. Personal stats page

**Testing**:

- Unit: Metrics calculations, activity feed logic
- Integration: Dashboard API endpoints
- E2E: Dashboard navigation, filter interactions

---

### Phase 5: Collaboration & Genre (Week 9-10)

#### Phase 5A: Genre Management [Primary Stream]

**Deliverables**:

1. Multi-genre migration (schema + data)
2. Genre model & API
3. GenreSelect component (multi-select + tag input)
4. Update track/artist/album edit dialogs with multi-genre
5. Genre management page (list, create, rename, delete, merge)
6. Genre CRUD endpoints
7. FTS5 index update for multi-genre

**Testing**:

- Unit: Genre normalization, multi-select logic
- Integration: Genre CRUD, merge endpoint
- E2E: Genre management workflows

#### Phase 5B: Curator Notes [Parallel Stream]

**Deliverables**:

1. CuratorNote table & API
2. Notes tab in edit dialogs
3. Note badge indicator on entity rows
4. Notes list component (threaded)
5. Note composer with @ mentions
6. Mention autocomplete
7. Note resolution

**Testing**:

- Unit: Threading logic, mention parsing
- Integration: Notes CRUD endpoints
- E2E: Create note, reply, @ mention, resolve

**Merge Point**: Both streams complete → Phase 6

---

### Phase 6: Polish & Advanced Features (Week 11-12)

**Depends On**: All previous phases

**Deliverables**:

1. Session recovery (localStorage + recovery prompt)
2. Metadata clipboard (field copy, template, similar track)
3. Badges & achievements system
4. Badge display (profile, leaderboard, history)
5. Mobile curator UI optimization (responsive dialogs, controls)
6. Keyboard navigation (standard patterns)
7. Performance optimization (virtualization, debouncing)
8. Error handling improvements (modal dialogs, retry)
9. Final E2E test suite

**Testing**:

- Unit: Session recovery logic, clipboard utilities
- Integration: Badge earning logic
- E2E: Complete curator workflows on mobile

---

## Work Parallelization

### 3 Parallel Workstreams

**Stream A: Backend/Infrastructure** (Backend-focused developer)

- Phase 0: Database migrations, permissions, lock system
- Phase 1A: Track edit endpoints
- Phase 2: Bulk edit endpoint
- Phase 3A: Review queue API
- Phase 3B: Duplicate detection algorithm & job
- Phase 4: Dashboard API
- Phase 5A: Genre API
- Phase 5B: Notes API

**Stream B: Core UI** (Frontend-focused developer)

- Phase 0: Curator tools menu shell, BroadcastChannel client
- Phase 1A: Track edit dialog components
- Phase 1B: Artist/album edit dialogs
- Phase 2: Bulk edit dialog, progress panel
- Phase 3A: Review queue UI
- Phase 3B: Duplicates page, merge dialogs
- Phase 4: Dashboard UI
- Phase 5A: Genre management UI
- Phase 5B: Notes UI

**Stream C: Features/Polish** (Full-stack developer)

- Phase 0: Lock client utilities
- Phase 1A: Artist/album autocomplete components
- Phase 1B: Image upload components
- Phase 2: Selection state management
- Phase 3A: User report flow
- Phase 3B: Artist split functionality
- Phase 4: Activity feed, leaderboard
- Phase 5A: Multi-genre migration & FTS5 update
- Phase 5B: @ mention system
- Phase 6: Session recovery, clipboard, badges, mobile

### Coordination Points

**Daily Standups**: Sync on interface contracts (API shapes, component props)

**PR Review**: Cross-review between streams for consistency

**Integration Testing**: After each phase, all streams merge and test together

---

## Task Breakdown

### Phase 0: Foundation

#### 0.1: Database Migrations

**Tasks**:

- [ ] Create migration: EditLock table
- [ ] Create migration: ReviewQueueItem table
- [ ] Create migration: DuplicateDetection, NormalizedName tables
- [ ] Create migration: Genre, _TrackGenres join table
- [ ] Create migration: CuratorNote table
- [ ] Create migration: ArtistEdit, AlbumEdit tables
- [ ] Create migration: CuratorBadge table
- [ ] Create migration: Add fields to CoverImage (width, height, isPrimary)
- [ ] Test all migrations up/down

**Estimated**: 1 day

#### 0.2: Permission Utilities

**Tasks**:

- [ ] Verify `requireCuratorOrAdmin` works correctly
- [ ] Add `userIsCuratorOrAdmin` to React context
- [ ] Create `useCuratorPermissions` hook
- [ ] Add curator role check to user dropdown (show/hide menu items)

**Estimated**: 0.5 days

#### 0.3: Lock System (Backend)

**Tasks**:

- [ ] Implement `POST /api/locks/acquire`
- [ ] Implement `POST /api/locks/release`
- [ ] Implement `POST /api/locks/force-unlock`
- [ ] Implement `GET /api/locks/status`
- [ ] Create background job for lock cleanup (expired locks)
- [ ] Unit tests for lock logic
- [ ] Integration tests for lock endpoints

**Estimated**: 1 day

#### 0.4: Lock System (Client)

**Tasks**:

- [ ] Create `useLock` hook (acquire on mount, release on unmount)
- [ ] Create `LockBanner` component (read-only indicator)
- [ ] Implement manual refresh button
- [ ] Unit tests for lock utilities

**Estimated**: 0.5 days

#### 0.5: BroadcastChannel Sync

**Tasks**:

- [ ] Create `app/features/curator/sync.client.ts`
- [ ] Define message protocol types
- [ ] Implement channel initialization & cleanup
- [ ] Create `useCuratorSync` hook
- [ ] Handle message types: LOCK_RELEASED, TRACK_UPDATED, etc.
- [ ] Unit tests for sync utilities

**Estimated**: 1 day

#### 0.6: Curator Tools Menu

**Tasks**:

- [ ] Create pencil icon button in app header
- [ ] Create dropdown menu component
- [ ] Add menu items (placeholders for now)
- [ ] Position menu correctly (z-index, responsive)
- [ ] Show/hide based on curator role

**Estimated**: 0.5 days

**Phase 0 Total**: ~5 days

---

### Phase 1A: Track Editing

#### 1A.1: Edit Dialog Structure

**Tasks**:

- [ ] Create `TrackDetailsDialog` wrapper component
- [ ] Add Tabs component (Basic, Extended, History)
- [ ] Integrate lock system (acquire on open)
- [ ] Show lock banner when locked by others
- [ ] Handle auto-unlock via BroadcastChannel
- [ ] Dialog close releases lock

**Estimated**: 1 day

#### 1A.2: Basic Metadata Tab

**Tasks**:

- [ ] Create `BasicMetadataTab` component
- [ ] Form fields: title, artist, album, genre, year
- [ ] Artist autocomplete (with create new)
- [ ] Form validation (required fields)
- [ ] Detect changes (enable/disable save button)
- [ ] Unit tests for form logic

**Estimated**: 1 day

#### 1A.3: Extended Metadata Tab

**Tasks**:

- [ ] Create `ExtendedMetadataTab` component
- [ ] Form fields: track number, album artist, BPM, label, ISRC, dates, lyrics
- [ ] Number input validation (ranges)
- [ ] Date pickers
- [ ] Textarea for lyrics

**Estimated**: 0.5 days

#### 1A.4: Edit API Endpoint

**Tasks**:

- [ ] Implement `POST /api/metadata/tracks/:id/edit`
- [ ] Validate input (required fields, ranges)
- [ ] Create TrackEdit history entry before update
- [ ] Update Track record
- [ ] Return updated track + edit record
- [ ] Unit tests for validation
- [ ] Integration tests for endpoint

**Estimated**: 1 day

#### 1A.5: History Tab

**Tasks**:

- [ ] Implement `GET /api/metadata/tracks/:id/history`
- [ ] Compute field-by-field changes (before → after)
- [ ] Return history with editor info
- [ ] Create `HistoryTab` component
- [ ] Display timeline (newest first)
- [ ] Show changes per entry
- [ ] "Restore" button (except most recent)
- [ ] Integration tests for history endpoint

**Estimated**: 1 day

#### 1A.6: Restore Functionality

**Tasks**:

- [ ] Implement `POST /api/metadata/tracks/:id/restore/:editId`
- [ ] Validate editId exists
- [ ] Require comment
- [ ] Restore track to that state
- [ ] Create new edit entry documenting restore
- [ ] Create `RestoreConfirmationDialog` component
- [ ] Required comment field
- [ ] Integration tests for restore endpoint

**Estimated**: 0.5 days

#### 1A.7: Comment Dialog

**Tasks**:

- [ ] Create `CommentDialog` component
- [ ] Optional vs required modes
- [ ] Character limit (500)
- [ ] Show in edit flow (optional)
- [ ] Show in restore flow (required)

**Estimated**: 0.5 days

#### 1A.8: Artist Autocomplete

**Tasks**:

- [ ] Implement `GET /api/artists/search?q=...`
- [ ] Debounced search (300ms)
- [ ] Return artists with track counts
- [ ] Create `ArtistAutocomplete` component
- [ ] Dropdown with results
- [ ] "Create new artist" option
- [ ] Implement `POST /api/artists/create`
- [ ] Keyboard navigation (arrow keys, enter)
- [ ] Integration tests for artist endpoints

**Estimated**: 1 day

#### 1A.9: Undo System

**Tasks**:

- [ ] After successful edit, show toast with "Undo" button
- [ ] 5-minute countdown timer
- [ ] Click "Undo" → confirmation popup
- [ ] Revert changes via restore endpoint
- [ ] Auto-dismiss toast after 5 min

**Estimated**: 0.5 days

#### 1A.10: Integration & E2E

**Tasks**:

- [ ] E2E test: Edit track metadata
- [ ] E2E test: Lock conflict (2 curators)
- [ ] E2E test: Restore previous version
- [ ] E2E test: Undo within 5 minutes

**Estimated**: 1 day

**Phase 1A Total**: ~8.5 days

---

### Phase 1B: Artist & Album Editing

#### 1B.1: Artist Edit Dialog

**Tasks**:

- [ ] Create `ArtistEditDialog` component
- [ ] Form fields: name, bio, genre (multi), image
- [ ] Lock integration
- [ ] History tab (reuse pattern from tracks)
- [ ] Unit tests

**Estimated**: 1 day

#### 1B.2: Album Edit Dialog

**Tasks**:

- [ ] Create `AlbumEditDialog` component
- [ ] Form fields: name, year, artist, genre (multi), cover
- [ ] Lock integration
- [ ] History tab

**Estimated**: 1 day

#### 1B.3: Artist/Album Edit APIs

**Tasks**:

- [ ] Implement `POST /api/metadata/artists/:id/edit`
- [ ] Implement `GET /api/metadata/artists/:id/history`
- [ ] Implement `POST /api/metadata/artists/:id/restore/:editId`
- [ ] Implement `POST /api/metadata/albums/:id/edit`
- [ ] Implement `GET /api/metadata/albums/:id/history`
- [ ] Implement `POST /api/metadata/albums/:id/restore/:editId`
- [ ] Integration tests

**Estimated**: 2 days

#### 1B.4: Image Upload System

**Tasks**:

- [ ] Create `ImageUploader` component (file + URL)
- [ ] Implement `POST /api/images/upload`
- [ ] Implement `POST /api/images/from-url`
- [ ] Validate: file type, resolution (min 500x500)
- [ ] Store width/height in database
- [ ] Multi-image support (gallery view)
- [ ] Implement `PUT /api/images/:id/set-primary`
- [ ] Integration tests

**Estimated**: 1.5 days

#### 1B.5: Integration & E2E

**Tasks**:

- [ ] E2E test: Edit artist metadata
- [ ] E2E test: Upload artist image
- [ ] E2E test: Edit album metadata

**Estimated**: 0.5 days

**Phase 1B Total**: ~6 days (parallel with 1A)

---

### Phase 2: Bulk Operations

#### 2.1: Selection Mode

**Tasks**:

- [ ] Add "Selection Mode" toggle to curator tools menu
- [ ] Store selection mode state in localStorage
- [ ] Broadcast selection mode changes via BroadcastChannel
- [ ] Show/hide checkboxes based on mode
- [ ] Create `SelectionModeToggle` component

**Estimated**: 0.5 days

#### 2.2: Selection State Management

**Tasks**:

- [ ] Create `app/features/curator/selection.client.ts`
- [ ] Track selected track IDs (Set for fast lookup)
- [ ] Save to localStorage on change
- [ ] Broadcast updates via BroadcastChannel
- [ ] Create `useSelection` hook
- [ ] Handle select all / deselect all
- [ ] Handle individual track toggle
- [ ] Unit tests

**Estimated**: 1 day

#### 2.3: Selection Controls

**Tasks**:

- [ ] Create `SelectionControls` component
- [ ] Select all button
- [ ] Deselect all button
- [ ] Selected count display
- [ ] "Bulk Edit" button (visible when 2+ selected)
- [ ] Render conditionally based on curator role + selection mode

**Estimated**: 0.5 days

#### 2.4: Track Row Checkboxes

**Tasks**:

- [ ] Add checkbox to `TrackListItem` component
- [ ] Conditional rendering (only in selection mode)
- [ ] Handle click (toggle selection)
- [ ] Shift+click for range selection
- [ ] Cmd/Ctrl+click for individual toggles
- [ ] Visual indicator (checked state)

**Estimated**: 0.5 days

#### 2.5: Bulk Edit Dialog

**Tasks**:

- [ ] Create `BulkEditDialog` component
- [ ] Form with updateable fields (leave blank = no change)
- [ ] Artist autocomplete
- [ ] "Show more/fewer fields" toggle
- [ ] Comment field (required)
- [ ] "Preview Changes" button

**Estimated**: 1 day

#### 2.6: Preview Table

**Tasks**:

- [ ] Create `PreviewTable` component
- [ ] Show all selected tracks
- [ ] Highlight changed fields
- [ ] Paginate if 100+ tracks
- [ ] "Apply" and "Cancel" buttons

**Estimated**: 0.5 days

#### 2.7: Bulk Edit API

**Tasks**:

- [ ] Implement `POST /api/metadata/tracks/bulk-edit`
- [ ] Validate: trackIds array, changes object, comment
- [ ] Process tracks one at a time
- [ ] Create TrackEdit entry for each
- [ ] Track success/failure per track
- [ ] Return: { updated: number, errors: Array }
- [ ] Integration tests (success, partial failure)

**Estimated**: 1 day

#### 2.8: Progress Panel

**Tasks**:

- [ ] Create `ProgressPanel` component
- [ ] Live log display (scroll to bottom)
- [ ] Show progress: "Processing track 45 of 100..."
- [ ] Show each track result (success/error)
- [ ] Cancel button (abort + rollback)
- [ ] Run in background, closable panel

**Estimated**: 1 day

#### 2.9: Partial Failure Handling

**Tasks**:

- [ ] Show results summary: "22 updated, 3 failed"
- [ ] List failed tracks with error reasons
- [ ] Dialog with 3 options:
  - Keep successful changes
  - Rollback all
  - Retry failed tracks
- [ ] Implement rollback logic (restore all to pre-edit state)
- [ ] Implement retry (re-run failed tracks only)

**Estimated**: 1 day

#### 2.10: Integration & E2E

**Tasks**:

- [ ] E2E test: Bulk edit 50 tracks (all succeed)
- [ ] E2E test: Bulk edit 100 tracks (warning, override)
- [ ] E2E test: Partial failure (handle 3 options)
- [ ] E2E test: Cancel mid-operation (rollback)

**Estimated**: 1 day

**Phase 2 Total**: ~8.5 days

---

### Phase 3A: Review Queue

#### 3A.1: Queue Infrastructure

**Tasks**:

- [ ] Implement `GET /api/curator/queue?tab=...&page=...`
- [ ] Filter by tab: user-reports, duplicates, data-quality, import-errors
- [ ] Pagination (50 items per page)
- [ ] Return items with all metadata
- [ ] Integration tests

**Estimated**: 1 day

#### 3A.2: Queue UI

**Tasks**:

- [ ] Create `/curator/queue` page
- [ ] Create `QueueTabs` component (4 tabs)
- [ ] Create `QueueList` component (paginated)
- [ ] Create `QueueItem` component (card display)
- [ ] Issue type badges
- [ ] Reporter info (for user reports)
- [ ] Timestamp display

**Estimated**: 1.5 days

#### 3A.3: Claim System

**Tasks**:

- [ ] Implement `POST /api/curator/queue/:id/claim`
- [ ] Implement `POST /api/curator/queue/:id/unclaim`
- [ ] Create "Claim" button in queue item
- [ ] Claimed items disappear from others' queues (BroadcastChannel)
- [ ] Auto-unclaim job (2 hours inactivity)
- [ ] "My Claimed Items" view
- [ ] Integration tests

**Estimated**: 1 day

#### 3A.4: User Report Flow

**Tasks**:

- [ ] Add "Report Issue" to track overflow menu
- [ ] Create report dialog (issue type dropdown, description)
- [ ] Implement `POST /api/curator/queue` (create item)
- [ ] Confirmation toast for user
- [ ] Unit tests for report form

**Estimated**: 1 day

#### 3A.5: Resolution Actions

**Tasks**:

- [ ] Implement `POST /api/curator/queue/:id/resolve`
- [ ] Implement `POST /api/curator/queue/:id/dismiss`
- [ ] Implement `POST /api/curator/queue/:id/escalate`
- [ ] Implement `POST /api/curator/queue/:id/request-info`
- [ ] Create resolution dialog component
- [ ] "Fix" button (opens edit dialog, auto-resolves on save)
- [ ] Integration tests

**Estimated**: 1.5 days

#### 3A.6: Reporter Notifications

**Tasks**:

- [ ] Send notification when queue item resolved
- [ ] Notification content: curator name, resolution notes
- [ ] Channels: in-app, email, push (user-configurable)
- [ ] Reuse existing notification system
- [ ] Unit tests

**Estimated**: 0.5 days

#### 3A.7: System Detection Job

**Tasks**:

- [ ] Implement detection job (daily cron, 3 AM UTC)
- [ ] Detect missing metadata (genre, year, album null)
- [ ] Detect low-res covers (< 300px width or height)
- [ ] Create queue items (idempotent - check existing)
- [ ] Log execution results
- [ ] Unit tests for detection logic

**Estimated**: 1 day

#### 3A.8: Manual Curator Flagging

**Tasks**:

- [ ] Add "Mark as Needs Review" button to track details dialog
- [ ] Optional comment field
- [ ] Create queue item with source: "curator_flagged"
- [ ] Show flag indicator on track row

**Estimated**: 0.5 days

#### 3A.9: Integration & E2E

**Tasks**:

- [ ] E2E test: User report → curator claim → resolve → notification
- [ ] E2E test: Claim item, unclaim, re-claim
- [ ] E2E test: Dismiss invalid report
- [ ] E2E test: Escalate to admin

**Estimated**: 1 day

**Phase 3A Total**: ~9.5 days

---

### Phase 3B: Duplicate Detection

#### 3B.1: Levenshtein Implementation

**Tasks**:

- [ ] Install `js-levenshtein` dependency
- [ ] Create normalization utility: `normalizeArtistName`, `normalizeAlbumName`
- [ ] Unit tests for normalization (edge cases, Unicode)
- [ ] Unit tests for Levenshtein distance

**Estimated**: 0.5 days

#### 3B.2: Detection Algorithm

**Tasks**:

- [ ] Implement `findExactDuplicates` (artists)
- [ ] Implement `findFuzzyDuplicates` (artists, Levenshtein threshold)
- [ ] Implement album duplicate detection (same artist, similar name, year)
- [ ] Blocking strategy (group by first 2 chars)
- [ ] Unit tests for detection logic

**Estimated**: 1.5 days

#### 3B.3: Detection Job

**Tasks**:

- [ ] Implement detection job (daily cron, 2 AM UTC)
- [ ] Run artist detection (exact + fuzzy)
- [ ] Run album detection
- [ ] Cache results in DuplicateDetection table
- [ ] Populate NormalizedName table
- [ ] Manual refresh endpoint: `POST /api/metadata/duplicates/refresh`
- [ ] Log execution results

**Estimated**: 1 day

#### 3B.4: Duplicates Page UI

**Tasks**:

- [ ] Create `/curator/duplicates` page
- [ ] Filter buttons: Both, Artists Only, Albums Only
- [ ] Separate sections: Exact Matches, Fuzzy Matches
- [ ] Implement `GET /api/metadata/artists/duplicates`
- [ ] Implement `GET /api/metadata/albums/duplicates`
- [ ] Display duplicate groups:
  - Normalized name
  - List of entities with counts
  - "Primary" badge on largest
  - "Merge These →" button
- [ ] Integration tests

**Estimated**: 1.5 days

#### 3B.5: Merge Preview Dialog

**Tasks**:

- [ ] Create `MergePreviewDialog` component
- [ ] Source/target selection (swappable with arrows)
- [ ] Side-by-side metadata comparison (all fields)
- [ ] Show differences highlighted
- [ ] Recommendation badge (e.g., "Keep this one - better metadata")
- [ ] Comment field (required)
- [ ] "Confirm Merge" button

**Estimated**: 1.5 days

#### 3B.6: Track List in Preview

**Tasks**:

- [ ] Show full list of affected tracks
- [ ] Toggle: flat list vs grouped by album
- [ ] Paginate if 500+ tracks
- [ ] Show counts per entity (before merge)
- [ ] Unit tests for list logic

**Estimated**: 0.5 days

#### 3B.7: Merge API Endpoints

**Tasks**:

- [ ] Implement `POST /api/metadata/artists/merge`
- [ ] Validate: sourceIds, targetId, comment
- [ ] Relink all tracks from source artists to target
- [ ] Mark source artists as merged (soft delete)
- [ ] Create audit trail entry
- [ ] Return: { success, mergedCount, targetId }
- [ ] Implement `POST /api/metadata/albums/merge` (same pattern)
- [ ] Integration tests (success, validation errors)

**Estimated**: 1.5 days

#### 3B.8: Split Artist

**Tasks**:

- [ ] Create `SplitArtistDialog` component
- [ ] Track list with checkboxes (manual selection)
- [ ] Smart suggestions (group by date/album patterns)
- [ ] Prompt for new artist names (both source + target)
- [ ] Comment field (required)
- [ ] Implement `POST /api/metadata/artists/split`
- [ ] Validate: artistId, trackIds, newNames, comment
- [ ] Create new artist records
- [ ] Relink tracks
- [ ] Integration tests

**Estimated**: 1.5 days

#### 3B.9: Integration & E2E

**Tasks**:

- [ ] E2E test: View duplicates, merge artists
- [ ] E2E test: Merge albums
- [ ] E2E test: Split artist
- [ ] E2E test: Swap source/target in merge preview

**Estimated**: 1 day

**Phase 3B Total**: ~11 days (parallel with 3A)

---

### Phase 4: Curator Dashboard

#### 4.1: Dashboard Page Structure

**Tasks**:

- [ ] Create `/curator/dashboard` page
- [ ] Create `DashboardTabs` component (4 tabs)
- [ ] Tab navigation (Overview, Queue, Reports, Activity)
- [ ] Responsive layout

**Estimated**: 0.5 days

#### 4.2: Metrics Panel

**Tasks**:

- [ ] Implement `GET /api/curator/dashboard/metrics`
- [ ] Calculate overall completeness percentage
- [ ] Calculate per-field breakdown (genre, year, BPM, etc.)
- [ ] Trend data (last 30 days)
- [ ] Create `MetricsPanel` component
- [ ] Overall percentage display
- [ ] Per-field bars
- [ ] Trend graph (line chart)
- [ ] Integration tests

**Estimated**: 1.5 days

#### 4.3: Problem Tracks Panel

**Tasks**:

- [ ] Aggregate counts by issue type
- [ ] Create `ProblemTracksPanel` component
- [ ] Clickable counts (filter library by issue)
- [ ] Prioritized list (most critical first)
- [ ] Unit tests for count logic

**Estimated**: 1 day

#### 4.4: Curator Leaderboard

**Tasks**:

- [ ] Implement `GET /api/curator/dashboard/leaderboard`
- [ ] Calculate metrics: edits, merges, quality contributions
- [ ] Time period filter: this week, this month, all time
- [ ] Create `Leaderboard` component
- [ ] All curators with pagination
- [ ] Display badges next to names
- [ ] Integration tests

**Estimated**: 1.5 days

#### 4.5: Live Activity Feed

**Tasks**:

- [ ] Implement `GET /api/curator/dashboard/activity`
- [ ] Fetch recent curator actions (edits, merges, queue claims)
- [ ] Create `ActivityFeed` component
- [ ] Display actions with timestamps ("X minutes ago")
- [ ] Filter controls (by curator, action type, time range)
- [ ] BroadcastChannel integration (live updates)
- [ ] Integration tests

**Estimated**: 1.5 days

#### 4.6: Reports Tab

**Tasks**:

- [ ] Metadata completeness report (detailed breakdown)
- [ ] Data quality trends (graphs)
- [ ] Problem tracks report (exportable list - no CSV, just display)
- [ ] Create `ReportsTab` component
- [ ] Render charts/tables

**Estimated**: 1 day

#### 4.7: Personal Stats Page

**Tasks**:

- [ ] Create `/curator/stats/:userId` page
- [ ] Implement `GET /api/curator/stats/:userId`
- [ ] Show personal metrics (edits, merges, streaks)
- [ ] Contribution history graph
- [ ] Earned badges display
- [ ] Integration tests

**Estimated**: 1 day

#### 4.8: Integration & E2E

**Tasks**:

- [ ] E2E test: Navigate dashboard tabs
- [ ] E2E test: Filter activity feed
- [ ] E2E test: View personal stats

**Estimated**: 0.5 days

**Phase 4 Total**: ~8.5 days

---

### Phase 5A: Genre Management

#### 5A.1: Multi-Genre Migration

**Tasks**:

- [ ] Create Genre table migration
- [ ] Create _TrackGenres join table migration
- [ ] Data migration script:
  - Extract unique genres from existing tracks
  - Create Genre records
  - Link tracks to genres via join table
  - Drop old `track.genre` column
- [ ] Test migration up/down
- [ ] Verify FTS5 index still works

**Estimated**: 1 day

#### 5A.2: Genre API

**Tasks**:

- [ ] Implement `GET /api/curator/genres`
- [ ] Implement `POST /api/curator/genres` (create)
- [ ] Implement `PUT /api/curator/genres/:id` (rename)
- [ ] Implement `DELETE /api/curator/genres/:id`
- [ ] Implement `POST /api/curator/genres/merge`
- [ ] Integration tests

**Estimated**: 1 day

#### 5A.3: GenreSelect Component

**Tasks**:

- [ ] Create `GenreSelect` component
- [ ] Multi-select dropdown (searchable)
- [ ] Tag input mode (type + Enter)
- [ ] Display selected as removable pills
- [ ] "Create new genre" option in dropdown
- [ ] Handle create inline
- [ ] Unit tests

**Estimated**: 1.5 days

#### 5A.4: Update Edit Dialogs

**Tasks**:

- [ ] Replace genre input in track edit dialog (Basic tab)
- [ ] Replace genre input in artist edit dialog
- [ ] Replace genre input in album edit dialog
- [ ] Update bulk edit dialog (multi-genre)
- [ ] Test all flows

**Estimated**: 1 day

#### 5A.5: Genre Management Page

**Tasks**:

- [ ] Create `/curator/genres` page
- [ ] List all genres with usage counts
- [ ] Create genre dialog
- [ ] Rename genre dialog
- [ ] Delete genre dialog (confirmation)
- [ ] Merge genres dialog (select 2+, pick target)
- [ ] Click genre → view tracks with that genre

**Estimated**: 1.5 days

#### 5A.6: FTS5 Update

**Tasks**:

- [ ] Update FTS5 trigger to concatenate all genres
- [ ] Rebuild FTS5 index for existing tracks
- [ ] Verify search works with multi-genre
- [ ] Unit tests

**Estimated**: 0.5 days

#### 5A.7: Integration & E2E

**Tasks**:

- [ ] E2E test: Create genre, assign to track
- [ ] E2E test: Merge genres
- [ ] E2E test: Rename genre
- [ ] E2E test: Delete genre
- [ ] E2E test: Search tracks by multi-genre

**Estimated**: 1 day

**Phase 5A Total**: ~7.5 days

---

### Phase 5B: Curator Notes

#### 5B.1: Notes API

**Tasks**:

- [ ] Implement `GET /api/curator/notes/:entityType/:entityId`
- [ ] Implement `POST /api/curator/notes` (create)
- [ ] Implement `POST /api/curator/notes/:id/reply` (threaded)
- [ ] Implement `PUT /api/curator/notes/:id/resolve`
- [ ] Integration tests

**Estimated**: 1 day

#### 5B.2: Notes Tab

**Tasks**:

- [ ] Add "Notes" tab to track/artist/album edit dialogs
- [ ] Create `NotesTab` component
- [ ] Create `NotesList` component (threaded display)
- [ ] Create `NoteItem` component
- [ ] Show note type badge (question, warning, info, resolved)
- [ ] Show author and timestamp

**Estimated**: 1 day

#### 5B.3: Note Composer

**Tasks**:

- [ ] Create `NoteComposer` component
- [ ] Note type selector (dropdown)
- [ ] Textarea for content
- [ ] @ mention support (trigger on "@")
- [ ] Submit button
- [ ] Unit tests

**Estimated**: 1 day

#### 5B.4: @ Mention System

**Tasks**:

- [ ] Create `MentionAutocomplete` component
- [ ] Fetch curators matching query
- [ ] Insert @username on select
- [ ] Parse @ mentions from note content
- [ ] Send notification to mentioned curator
- [ ] Unit tests

**Estimated**: 1.5 days

#### 5B.5: Note Badge Indicator

**Tasks**:

- [ ] Show badge on track/artist/album rows when notes exist
- [ ] Badge shows note count
- [ ] Click badge → open entity details at Notes tab
- [ ] Unit tests

**Estimated**: 0.5 days

#### 5B.6: Note Resolution

**Tasks**:

- [ ] "Mark Resolved" button on note items
- [ ] Update note status
- [ ] Show resolved indicator (strikethrough, muted)
- [ ] Filter: show/hide resolved notes

**Estimated**: 0.5 days

#### 5B.7: Integration & E2E

**Tasks**:

- [ ] E2E test: Create note on track
- [ ] E2E test: Reply to note (threading)
- [ ] E2E test: @ mention curator (verify notification)
- [ ] E2E test: Resolve note

**Estimated**: 1 day

**Phase 5B Total**: ~6.5 days (parallel with 5A)

---

### Phase 6: Polish & Advanced Features

#### 6.1: Session Recovery

**Tasks**:

- [ ] Create `app/features/curator/session-recovery.client.ts`
- [ ] Save selection state to localStorage (incremental)
- [ ] Save dialog state (debounced)
- [ ] Save filters & scroll position
- [ ] Create `SessionRecoveryPrompt` component
- [ ] Aggregate saved state on load
- [ ] Show summary ("25 tracks selected, 1 dialog open")
- [ ] Implement restore logic
- [ ] Implement discard logic
- [ ] Expiration logic (24h for selection, 2h for dialogs)
- [ ] Unit tests

**Estimated**: 2 days

#### 6.2: Metadata Clipboard

**Tasks**:

- [ ] Field-level copy icons (per field)
- [ ] Clipboard utilities (copy/paste)
- [ ] Create `TemplateDialog` component (selective copy)
- [ ] Create `SimilarTrackDialog` component (apply from similar)
- [ ] Track search in similar track dialog
- [ ] Side-by-side comparison view
- [ ] Apply selected fields
- [ ] Unit tests

**Estimated**: 2 days

#### 6.3: Badges & Achievements

**Tasks**:

- [ ] Define badge types (edits, merges, quality, streaks)
- [ ] Implement badge earning logic (background job or on-action)
- [ ] Implement `GET /api/curator/badges/:userId`
- [ ] Create `Badge` display component
- [ ] Show badges on profile page
- [ ] Show badges in leaderboard
- [ ] Show badges in edit history (next to curator name)
- [ ] Integration tests

**Estimated**: 1.5 days

#### 6.4: Mobile Optimization

**Tasks**:

- [ ] Responsive dialogs (full-screen on mobile)
- [ ] Touch-friendly controls (larger tap targets)
- [ ] Mobile-specific curator tools menu (placement)
- [ ] Swipe gestures for selection (optional)
- [ ] Test all workflows on mobile viewport
- [ ] Test on actual iOS/Android devices

**Estimated**: 2 days

#### 6.5: Keyboard Navigation

**Tasks**:

- [ ] Implement standard dialog behaviors (Tab, Enter, Escape)
- [ ] List navigation (arrow keys, Enter)
- [ ] Selection patterns (Shift+click, Cmd+click)
- [ ] Test keyboard accessibility
- [ ] Unit tests for keyboard handlers

**Estimated**: 1 day

#### 6.6: Performance Optimization

**Tasks**:

- [ ] Virtualize long lists (review queue, track list)
- [ ] Debounce rapid sync messages
- [ ] Optimize bulk edit query (batch updates)
- [ ] Profile duplicate detection job (ensure < 2 min)
- [ ] Profile dashboard metrics query
- [ ] Add loading skeletons for slow queries

**Estimated**: 1.5 days

#### 6.7: Error Handling

**Tasks**:

- [ ] Standardize error dialogs (modal with retry)
- [ ] Partial failure UX (keep/rollback/retry)
- [ ] Network error recovery (retry with exponential backoff)
- [ ] Lock acquisition failure handling
- [ ] Test error scenarios (network offline, server errors)

**Estimated**: 1 day

#### 6.8: Final E2E Suite

**Tasks**:

- [ ] E2E test: Complete curator workflow (end-to-end)
- [ ] E2E test: Multi-tab sync (open 2 tabs, edit in one)
- [ ] E2E test: Session recovery after browser restart
- [ ] E2E test: Mobile curator workflows (emulated)
- [ ] E2E test: Lock conflict resolution
- [ ] E2E test: Bulk edit 200 tracks (performance)

**Estimated**: 2 days

**Phase 6 Total**: ~13 days

---

## Database Migrations

### Migration Order

1. **`20261002_001_edit_lock.sql`** - EditLock table
2. **`20261002_002_review_queue.sql`** - ReviewQueueItem table
3. **`20261002_003_duplicate_detection.sql`** - DuplicateDetection, NormalizedName tables
4. **`20261002_004_multi_genre.sql`** - Genre table, _TrackGenres join table, drop track.genre
5. **`20261002_005_curator_notes.sql`** - CuratorNote table
6. **`20261002_006_artist_album_edits.sql`** - ArtistEdit, AlbumEdit tables
7. **`20261002_007_curator_badges.sql`** - CuratorBadge table
8. **`20261002_008_cover_image_metadata.sql`** - Add width, height, isPrimary to CoverImage

### Migration Strategy

- Run migrations incrementally (1 per phase)
- Test each migration up/down in dev
- Seed script updates for curator role (already exists)
- Test data fixtures for dev/test environments

---

## Testing Checkpoints

### After Phase 0

- [ ] Lock system works (acquire, release, timeout)
- [ ] BroadcastChannel syncs messages across tabs
- [ ] Curator tools menu visible for curators only

### After Phase 1A

- [ ] Track edit dialog works end-to-end
- [ ] Lock conflict handled correctly
- [ ] History and restore functional
- [ ] Undo toast works

### After Phase 1B

- [ ] Artist edit works with image upload
- [ ] Album edit works with cover upload

### After Phase 2

- [ ] Selection mode toggle works
- [ ] Bulk edit 100+ tracks successfully
- [ ] Partial failure handled correctly

### After Phase 3A

- [ ] User report flow complete
- [ ] Queue claim/unclaim works
- [ ] Reporter notifications sent

### After Phase 3B

- [ ] Duplicate detection finds real duplicates
- [ ] Merge operation relinks tracks correctly
- [ ] Artist split works

### After Phase 4

- [ ] Dashboard shows accurate metrics
- [ ] Leaderboard ranks curators correctly
- [ ] Activity feed updates in real-time

### After Phase 5A

- [ ] Multi-genre assignment works
- [ ] Genre management page functional
- [ ] FTS5 search works with multi-genre

### After Phase 5B

- [ ] Notes thread correctly
- [ ] @ mentions send notifications

### After Phase 6

- [ ] Session recovery restores state
- [ ] Clipboard utilities work
- [ ] Mobile UX acceptable

---

## Risks & Mitigations

### Risk 1: Lock System Race Conditions

**Risk**: Two curators acquire lock simultaneously due to network latency

**Mitigation**:

- Database unique constraint on `[entityType, entityId]`
- Backend rejects duplicate lock acquisition
- Show error modal to second curator
- Test with simulated race condition

### Risk 2: BroadcastChannel Incompatibility

**Risk**: Older browsers don't support BroadcastChannel

**Mitigation**:

- Feature detection: `if ('BroadcastChannel' in window)`
- Graceful degradation: manual refresh still works
- Show notice: "For real-time sync, update your browser"

### Risk 3: Bulk Edit Performance

**Risk**: Bulk editing 500+ tracks times out

**Mitigation**:

- Soft limit at 100 tracks with override
- Process in batches (50 tracks per transaction)
- Show live progress (not blocking)
- Test with 1000 tracks in dev

### Risk 4: Duplicate Detection False Positives

**Risk**: Fuzzy matching flags non-duplicates

**Mitigation**:

- Separate exact vs fuzzy sections
- Adjustable thresholds (admin config)
- Curators review before merging (no auto-merge)
- Dismiss option for false positives

### Risk 5: FTS5 Rebuild Time

**Risk**: Multi-genre migration rebuilds FTS5, blocks app

**Mitigation**:

- Run migration during maintenance window
- Background job for FTS5 rebuild (async)
- Tracks temporarily unsearchable by new genres (acceptable)

### Risk 6: Session Recovery Storage Limits

**Risk**: localStorage full (5-10MB limit)

**Mitigation**:

- Save only IDs, not full entities
- Expire old state (24h)
- Try/catch localStorage writes
- Show error if storage full: "Cannot save session state"

### Risk 7: Review Queue Backlog

**Risk**: Issues generated faster than resolved

**Mitigation**:

- Dashboard shows queue size trend
- Admin can assign more curators
- Configurable detection rules (curators can disable noisy rules)
- Auto-dismiss stale items (optional)

### Risk 8: Curator Workload

**Risk**: Too many features overwhelm curators

**Mitigation**:

- Feature flag: enable incrementally
- Training documentation for curators
- Prioritize core features (edit, merge, queue)
- Polish features optional (badges, clipboard)

---

## Feature Flag Strategy

### Global Flag

```typescript
// app/utils/feature-flags.ts
export const CURATOR_SYSTEM_ENABLED = process.env.CURATOR_SYSTEM_ENABLED === "true";
```

### Phase-by-Phase Rollout

- **Phase 0-1**: `CURATOR_SYSTEM_ENABLED=false` (dev only)
- **Phase 2**: `CURATOR_SYSTEM_ENABLED=true` (internal beta)
- **Phase 3-4**: Continue beta, gather feedback
- **Phase 5-6**: Full production rollout

### Per-Feature Flags (Optional)

```typescript
export const CURATOR_FEATURES = {
  editMetadata: true, // Phase 1
  bulkEdit: true, // Phase 2
  reviewQueue: true, // Phase 3A
  duplicateDetection: true, // Phase 3B
  dashboard: true, // Phase 4
  genreManagement: true, // Phase 5A
  curatorNotes: true, // Phase 5B
  sessionRecovery: false, // Phase 6 (optional)
  clipboard: false, // Phase 6 (optional)
  badges: false, // Phase 6 (optional)
};
```

Enable features incrementally based on stability.

---

## Timeline Summary

| Phase                    | Workstreams | Duration | Dependencies                |
| ------------------------ | ----------- | -------- | --------------------------- |
| 0: Foundation            | A, B, C     | 5 days   | None                        |
| 1A: Track Editing        | A, B, C     | 8.5 days | Phase 0                     |
| 1B: Artist/Album Editing | A, B, C     | 6 days   | Phase 0 (parallel with 1A)  |
| 2: Bulk Operations       | A, B, C     | 8.5 days | Phase 1A                    |
| 3A: Review Queue         | A, B, C     | 9.5 days | Phase 0                     |
| 3B: Duplicate Detection  | A, B, C     | 11 days  | Phase 1B (parallel with 3A) |
| 4: Dashboard             | A, B, C     | 8.5 days | Phases 2, 3A, 3B            |
| 5A: Genre Management     | A, B, C     | 7.5 days | Phase 0                     |
| 5B: Curator Notes        | A, B, C     | 6.5 days | Phase 0 (parallel with 5A)  |
| 6: Polish                | A, B, C     | 13 days  | All above                   |

**Critical Path**: 0 → 1A → 2 → 4 → 6 = **43.5 days**

**With Parallelization**: ~**10-12 weeks** (accounting for coordination, testing, reviews)

---

**End of Implementation Plan**

# Curator System - Complete Documentation Overview

**Date:** 2026-10-02  
**Status:** Ready for Implementation

## Documentation Index

This document provides an overview and quick links to all curator system documentation.

---

## Core Documentation

### 1. Architecture Decision Records (ADRs)

Located in `/workspace/docs/decisions/`:

- **ADR-031**: [Curator Role and Permission System](./decisions/031-curator-role-and-permissions.md)
  - Single curator role model
  - Permission scope and boundaries
  - Admin oversight

- **ADR-032**: [Concurrent Edit Locking Mechanism](./decisions/032-concurrent-edit-locking.md)
  - Optimistic locking on edit dialogs
  - 30-minute timeout
  - Force-unlock with audit trail

- **ADR-033**: [Real-time Curator Sync Across Browser Tabs](./decisions/033-real-time-curator-sync.md)
  - BroadcastChannel API for same-browser sync
  - Message protocol
  - Conflict detection fallback

- **ADR-034**: [Duplicate Detection Algorithm](./decisions/034-duplicate-detection-algorithm.md)
  - Levenshtein distance matching
  - Exact + fuzzy detection
  - Caching strategy

- **ADR-035**: [Curator Review Queue and User Reports](./decisions/035-curator-review-queue.md)
  - Four issue sources (user, system, curator, import)
  - Claim/resolve workflow
  - Reporter notifications

- **ADR-036**: [Curator Session Recovery](./decisions/036-curator-session-recovery.md)
  - localStorage-based recovery
  - Selection + dialogs + filters
  - Expiration policy

- **ADR-037**: [Multi-Genre Tagging System](./decisions/037-multi-genre-tagging.md)
  - Many-to-many relationship
  - Flat genre list (no hierarchy)
  - Curator-built genre management

### 2. Feature Specification

**File**: `/workspace/docs/curator-system-specification.md`

Complete specification covering:

- User roles and permissions
- All 13 core features (detailed)
- Navigation & UI structure
- User workflows
- API endpoints (40+)
- Database schema
- Component architecture (60+ components)
- Testing strategy
- Dependencies

**Use this for**: Understanding what will be built, feature requirements, UI/UX details

### 3. Implementation Plan

**File**: `/workspace/docs/curator-system-implementation-plan.md`

Detailed implementation roadmap:

- 6 phases with task breakdown
- Dependency graph
- Work parallelization (3 workstreams)
- 200+ granular tasks with estimates
- Database migration order
- Testing checkpoints per phase
- Risk mitigation strategies
- 10-12 week timeline

**Use this for**: Project planning, task assignment, tracking progress

### 4. Context & Glossary

**File**: `/workspace/docs/CONTEXT.md` (updated)

Added curator-specific terms:

- Curator role
- Edit Lock
- BroadcastChannel Sync
- Review Queue
- Duplicate Detection
- Selection Mode
- Bulk Edit
- Merge/Split Operations
- Curator Notes
- Audit Trail
- Undo System
- Session Recovery
- Curator Dashboard
- Genre Management
- And more...

**Use this for**: Quick terminology reference, onboarding new developers

---

## Quick Reference

### Key Features Summary

1. **Metadata Editing** - Track/artist/album edit dialogs with 3 tabs (Basic, Extended, History)
2. **Bulk Operations** - Selection mode + bulk edit with live progress
3. **Merge & Split** - Duplicate detection + artist/album merge + artist split
4. **Review Queue** - User reports + system detection + curator flags
5. **Data Quality Dashboard** - Metrics, leaderboard, activity feed
6. **Genre Management** - Multi-genre tagging + genre CRUD
7. **Curator Notes** - Threaded comments with @ mentions
8. **Audit Trail** - Per-entity history + system-wide log
9. **Undo System** - Quick undo (5 min) + delayed restore (anytime)
10. **Session Recovery** - Save/restore workflow state
11. **Cover Management** - Upload + multi-image support
12. **Metadata Clipboard** - Copy/paste fields across tracks
13. **Badges** - Achievement system with 10 levels

### Database Tables Added

- `EditLock` - Concurrent editing locks
- `ReviewQueueItem` - Review queue entries
- `DuplicateDetection` - Cached duplicate results
- `NormalizedName` - Normalized names for fuzzy matching
- `Genre` - Genre records
- `_TrackGenres` - Many-to-many join table
- `CuratorNote` - Curator notes with threading
- `ArtistEdit` - Artist edit history
- `AlbumEdit` - Album edit history
- `CuratorBadge` - Achievement badges

### API Endpoints Summary

- **Track Metadata**: Edit, history, restore, bulk edit
- **Artist Metadata**: Edit, history, restore, create, search
- **Album Metadata**: Edit, history, restore
- **Merge Operations**: Artists merge, albums merge, artist split
- **Duplicate Detection**: Artists duplicates, albums duplicates, refresh
- **Review Queue**: List, claim, unclaim, resolve, dismiss, escalate
- **Genres**: CRUD operations, merge
- **Locks**: Acquire, release, force-unlock, status
- **Cover Images**: Upload, from URL, set primary
- **Notes**: CRUD, reply, resolve
- **Dashboard**: Metrics, activity, leaderboard, stats

### Implementation Timeline

- **Phase 0**: Foundation (5 days)
- **Phase 1A**: Track Editing (8.5 days)
- **Phase 1B**: Artist/Album Editing (6 days, parallel)
- **Phase 2**: Bulk Operations (8.5 days)
- **Phase 3A**: Review Queue (9.5 days)
- **Phase 3B**: Duplicate Detection (11 days, parallel)
- **Phase 4**: Dashboard (8.5 days)
- **Phase 5A**: Genre Management (7.5 days)
- **Phase 5B**: Curator Notes (6.5 days, parallel)
- **Phase 6**: Polish (13 days)

**Total**: 10-12 weeks with 3 parallel workstreams

---

## Next Steps

### For Product/Design Review

1. Read **Feature Specification** for complete feature details
2. Review UI mockups/flows in specification
3. Validate workflows meet user needs
4. Sign off on scope

### For Engineering Planning

1. Review **Implementation Plan** for task breakdown
2. Assign workstreams to developers (A: Backend, B: UI, C: Features)
3. Set up project board with Phase 0-6 milestones
4. Create GitHub issues from task list
5. Review **ADRs** for technical context

### For Database Team

1. Review **ADRs** for schema decisions
2. Prepare migrations in order (8 migrations total)
3. Plan data migration for multi-genre (Phase 5A)
4. Set up test data fixtures

### For QA/Testing

1. Review **Testing Strategy** in specification
2. Prepare test environment with curator role
3. Review E2E test scenarios in implementation plan
4. Plan manual testing for mobile/browser compatibility

---

## Key Decisions Recap

### What We're Building

✅ Single curator role (no tiers)  
✅ Admin-only role assignment  
✅ Concurrent editing with locks  
✅ Real-time sync (same-browser only)  
✅ Automated duplicate detection (daily job)  
✅ Review queue (4 issue types)  
✅ Multi-genre tagging (unlimited genres)  
✅ Session recovery (localStorage)  
✅ Badges & achievements (10 levels)  
✅ Mobile-optimized curator UI

### What We're NOT Building (v1)

❌ Cross-device sync  
❌ Machine learning suggestions  
❌ Auto-fixing metadata  
❌ Public curator profiles  
❌ Curator chat/messaging  
❌ CSV/JSON exports  
❌ Keyboard shortcuts (only standard navigation)  
❌ Photo-based workflows (barcode scanning)  
❌ Voice input  
❌ Offline curator mode

### Deferred to v2

- Advanced analytics/reporting
- Curator leaderboard gamification enhancements
- ML-based duplicate detection
- Curator collaboration spaces
- Advanced workflow automation

---

## Success Criteria

### User Experience

- [ ] Curators can edit track metadata in < 5 clicks
- [ ] Bulk edit 100 tracks completes in < 30 seconds
- [ ] Duplicate merge shows clear preview before confirming
- [ ] User reports resolved within 24 hours (target)
- [ ] Session recovery restores state 95%+ of the time
- [ ] Mobile curator workflows fully functional

### Technical

- [ ] All API endpoints < 500ms p95 response time
- [ ] Duplicate detection job completes in < 2 minutes (10K artists)
- [ ] BroadcastChannel syncs < 100ms cross-tab latency
- [ ] No data loss from concurrent edits (lock system prevents)
- [ ] 90%+ test coverage for curator utilities
- [ ] E2E tests pass for all critical workflows

### Data Quality

- [ ] Metadata completeness improves by 10% per month
- [ ] Duplicate artists reduced by 50% in 3 months
- [ ] User report resolution rate > 90%
- [ ] Curator edit revert rate < 5% (quality indicator)

---

## Questions or Issues?

- **Architecture Questions**: See ADRs for rationale
- **Feature Clarifications**: See Feature Specification
- **Implementation Questions**: See Implementation Plan
- **Terminology**: See CONTEXT.md glossary

---

**End of Overview**

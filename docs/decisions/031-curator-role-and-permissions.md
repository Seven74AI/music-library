# ADR-031: Curator Role and Permission System

**Status:** Accepted  
**Date:** 2026-10-02

## Context

The music library requires trusted users to maintain metadata quality, fix duplicates, and manage data integrity across thousands of tracks. Regular users can add tracks to their personal library, but cannot edit global metadata like track titles, artist names, genres, or album information. Admin users have full system access but may not have the time or musical expertise for detailed metadata curation.

A dedicated curator role is needed to:

- Edit track/artist/album metadata with full audit trail
- Merge duplicate artists and albums
- Detect and resolve data quality issues
- Process user-reported metadata problems
- Perform bulk operations on multiple tracks

The curator role sits between regular users and admins: curators have powerful editing capabilities but cannot manage users, configure system settings, or access sensitive admin functions.

## Decision

### Single Curator Role

Implement a single `curator` role with a comprehensive permission set. No tiered curator levels (junior/senior) or specialized roles (metadata curator vs merge curator). All curators have identical capabilities.

**Rationale:**

- Simpler permission model
- Curators are trusted users - complexity of tiered permissions not justified
- Admin oversight available if needed

### Role Assignment

Only admins can assign the curator role. No self-service application, activity-based promotion, or automated role assignment.

**Database:**

- Role already exists: `curator` role created in migration `20260927000000_add_edit_history_and_merge_tracking`
- Linked permissions: `perm_metadata_update_any`, `perm_metadata_history_read`, `perm_metadata_restore_any`, `perm_artist_update_any`, `perm_artist_merge_any`, `perm_album_update_any`, `perm_album_merge_any`

### Permission Scope

Curators can:

1. **Metadata Editing**
   - Edit track metadata (title, artist, album, genre, year, BPM, ISRC, lyrics, etc.)
   - Edit artist metadata (name, bio, genre, image)
   - Edit album metadata (name, year, artist, genre, cover art)
   - Create new artists and albums
   - Upload/replace cover images

2. **Bulk Operations**
   - Select multiple tracks for bulk editing
   - Apply metadata changes to 100+ tracks at once (soft limit with override)
   - Bulk upload/replace cover images

3. **Merge & Split**
   - Merge duplicate artists (2+ artists → 1)
   - Merge duplicate albums (2+ albums → 1)
   - Split artists (1 artist → 2+ artists)
   - Batch merge operations (merge 3+ entities at once)

4. **Quality Management**
   - Access data quality dashboard
   - View and process review queue (user reports + system-detected issues)
   - Flag tracks for curator attention
   - Resolve user-reported issues
   - Access duplicate detection tools

5. **Audit & History**
   - View full edit history for any track/artist/album
   - View system-wide audit log
   - Restore previous versions with comment
   - Undo own edits within 5 minutes
   - Undo any curator's edits with comment and reason

6. **Collaboration**
   - Leave notes on tracks for other curators
   - @ mention other curators
   - Claim items from review queue
   - See other curators' active work

Curators **cannot**:

- Manage user accounts or roles
- Configure system settings
- Access admin-only pages (except data quality tools)
- Delete tracks, artists, or albums (only edit/merge)
- Bypass validation rules
- Access sensitive user data

### Permission Checking

Server-side enforcement only. Two utility functions:

```typescript
// app/utils/curator.server.ts
export async function requireCuratorOrAdmin(request: Request): Promise<string>;
export async function userIsCuratorOrAdmin(userId: string): Promise<boolean>;
```

UI shows/hides curator features based on role check, but all mutations validate server-side.

### Admin Oversight

Admins have implicit curator permissions (admin role includes all curator capabilities). Admins can:

- Monitor curator activity via dashboard
- View curator performance metrics
- See real-time curator actions
- Revert any changes (same as curators)
- Suspend curator role assignment

Admins do **not** have special intervention powers (e.g., no revert without comment, no force-through operations). They work within the same audit trail requirements as curators.

## Consequences

### Positive

- **Clear permission boundary**: Curators focus on data quality, admins focus on system management
- **Audit trail**: All curator actions are logged with user attribution
- **Trust-based**: Curators are trusted users - no warnings, approvals, or restrictions beyond audit requirements
- **Simple model**: Single role easier to understand and maintain than tiered system
- **Implicit admin access**: Admins can perform curator duties without separate role assignment

### Negative

- **No gradual permissions**: New curators get full access immediately (mitigated by small trusted curator pool)
- **No specialized roles**: Can't restrict some curators to only merges or only metadata (acceptable given trust model)

## Implementation Notes

### Existing Infrastructure

Already implemented:

- `curator` role in database
- Permission records linked to role
- `requireCuratorOrAdmin()` and `userIsCuratorOrAdmin()` utilities
- Track edit history with curator attribution

### Required Extensions

New functionality needed:

- Artist/album edit history (same pattern as tracks)
- Merge operation audit trail
- Curator notes system
- Review queue infrastructure
- Data quality dashboard

### Migration Path

No migration required for existing `curator` role. New features will extend the existing permission set without changing role structure.

## References

- Migration: `prisma/migrations/20260927000000_add_edit_history_and_merge_tracking/migration.sql`
- Utilities: `app/utils/curator.server.ts`
- Permissions utility: `app/utils/permissions.server.ts`
- Related: ADR-032 (Concurrent Edit Locking), ADR-035 (Review Queue)

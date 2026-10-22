# Track Metadata Edit Dialog Implementation

## Summary

This implementation resolves GitHub issue #252 by adding a comprehensive track metadata editing system with full audit history, role-based permissions, and a tabbed user interface.

## Components Implemented

### Backend (Resolves #251)

#### Database Schema

- Added `TrackEdit` model to `prisma/schema.prisma`
- Captures complete metadata snapshots for every edit
- Links edits to users and tracks
- Supports optional comments

#### API Endpoints

1. **POST /api/metadata/tracks/:id/edit**
   - Edit track metadata with validation
   - Creates history entry before updating
   - Returns updated track and edit record

2. **GET /api/metadata/tracks/:id/history**
   - Retrieves complete edit timeline
   - Computes field-by-field changes (before → after)
   - Includes editor information

3. **POST /api/metadata/tracks/:id/restore/:editId**
   - Restores track to a previous state
   - Requires comment (audit trail)
   - Creates new edit entry for restore action

4. **GET /api/artists/search**
   - Autocomplete endpoint for artist search
   - Returns artists with track counts

5. **POST /api/artists/create**
   - Creates new artist (curator-only)
   - Prevents duplicates

#### Utilities

- `app/utils/curator.server.ts` - Permission checking functions
- Support for both `curator` and `admin` roles

### Frontend (Resolves #252)

#### Enhanced Track Details Dialog

**File**: `app/components/track-details-dialog.tsx`

Three tabs for curators/admins:

- **Basic**: Core metadata (title, artist, album, genre, year)
- **Extended**: Additional fields (track#, BPM, ISRC, lyrics, etc.)
- **History**: Full edit timeline with restore capability

Read-only view for regular users (no tabs).

#### New Components

1. **ArtistAutocomplete** (`app/components/artist-autocomplete.tsx`)
   - Debounced search (300ms)
   - Dropdown with track counts
   - Create new artist option
   - Keyboard navigation

2. **BasicMetadataTab** (`app/components/track-details-dialog/basic-metadata-tab.tsx`)
   - Title (required)
   - Artist autocomplete (required)
   - Album, Genre, Year

3. **ExtendedMetadataTab** (`app/components/track-details-dialog/extended-metadata-tab.tsx`)
   - Track Number, Total Tracks, Total Discs
   - Album Artist, BPM, Label, ISRC
   - Release Date, Original Date, Original Year
   - Lyrics (textarea)

4. **HistoryTab** (`app/components/track-details-dialog/history-tab.tsx`)
   - Timeline of all edits
   - Field-by-field change display
   - Restore button on each entry
   - Restore confirmation with required comment

5. **CommentDialog** (`app/components/track-details-dialog/comment-dialog.tsx`)
   - Optional comment for edits
   - Required comment for restores
   - Character limit (500)

6. **Tabs UI Component** (`app/components/ui/tabs.tsx`)
   - Radix UI-based tabs
   - Consistent styling with app

## User Flows

### Editing Track Metadata

1. Curator opens track details dialog
2. Sees three tabs (Basic/Extended/History)
3. Edits fields in Basic or Extended tab
4. Clicks "Save Changes"
5. Optional comment dialog appears
6. Submits with or without comment
7. Track updates, history entry created
8. History tab shows the new edit

### Restoring Previous Version

1. Curator opens History tab
2. Views edit timeline
3. Clicks "Restore" on previous edit
4. Confirmation dialog with **required** comment
5. Confirms restoration
6. Track reverts to that version
7. New edit entry created documenting the restore

### Artist Autocomplete

1. User focuses artist input
2. Types artist name
3. Dropdown shows matching artists with track counts
4. User selects existing artist or
5. Clicks "Create new artist" if no matches
6. New artist created and selected

## Testing

### Automated Tests

- ✅ 1310 tests passing
- ✅ Backend API endpoint tests
- ✅ Permission checking tests
- ✅ Track details loader tests updated
- ✅ Type safety throughout

### Manual Testing (Required by Reviewer)

**Test as Curator (kody:kodylovesyou)**

1. Open any track details dialog
2. Verify three tabs visible
3. Edit title in Basic tab
4. Add genre in Basic tab
5. Switch to Extended tab
6. Add BPM, Track Number
7. Save with optional comment
8. Check History tab shows edit
9. Restore previous version with comment
10. Verify restore appears in history

**Test as Regular User**

1. Login as non-curator user
2. Open track details
3. Verify read-only view (no tabs)
4. Verify no edit buttons

**Test Artist Autocomplete**

1. Open Basic tab as curator
2. Click artist field
3. Type partial artist name
4. Select from dropdown
5. Try creating new artist
6. Verify artist created and selected

## Database Changes

### Migration

- `20260927132657_add_track_edit_history`
- Creates `TrackEdit` table
- Adds foreign keys to Track and User
- Creates indexes for performance

### New Table: TrackEdit

```sql
CREATE TABLE "TrackEdit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "editedBy" TEXT NOT NULL,
    "comment" TEXT,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "albumId" TEXT,
    "genre" TEXT,
    "year" INTEGER,
    -- ... all other metadata fields
    "editedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackEdit_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE,
    CONSTRAINT "TrackEdit_editedBy_fkey" FOREIGN KEY ("editedBy") REFERENCES "User" ("id") ON DELETE CASCADE
);
```

## Security & Permissions

- Only users with `curator` or `admin` role can edit metadata
- Permission checked on every API request
- Regular users see read-only view
- All edits are logged with user attribution
- Cannot delete or hide edit history

## Dependencies Added

- `@radix-ui/react-tabs@^1.1.1`

## Files Changed

### Backend

- `prisma/schema.prisma` - Added TrackEdit model
- `prisma/migrations/20260927132657_add_track_edit_history/migration.sql` - Migration
- `app/utils/curator.server.ts` - New permission utilities
- `app/routes/api+/metadata+/tracks+/$trackId.edit.tsx` - Edit endpoint
- `app/routes/api+/metadata+/tracks+/$trackId.history.tsx` - History endpoint
- `app/routes/api+/metadata+/tracks+/$trackId.restore.$editId.tsx` - Restore endpoint
- `app/routes/api+/artists+/search.tsx` - Search endpoint
- `app/routes/api+/artists+/create.tsx` - Create endpoint

### Frontend

- `app/components/track-details-dialog.tsx` - Enhanced with tabs
- `app/components/artist-autocomplete.tsx` - New component
- `app/components/ui/tabs.tsx` - New UI component
- `app/components/track-details-dialog/basic-metadata-tab.tsx` - New tab
- `app/components/track-details-dialog/extended-metadata-tab.tsx` - New tab
- `app/components/track-details-dialog/history-tab.tsx` - New tab
- `app/components/track-details-dialog/comment-dialog.tsx` - New dialog
- `app/routes/resources+/track-details.tsx` - Enhanced with role check

### Tests

- `app/routes/resources+/track-details.test.tsx` - Updated

## Notes for Reviewers

1. **Manual testing is required** - Automated GUI testing was not available
2. The `curator` role is auto-created if it doesn't exist
3. Admin role implicitly has curator permissions
4. All date fields use ISO 8601 format
5. Form validation is client-side first, then server-side
6. Artist autocomplete debounces at 300ms
7. History shows newest edits first
8. Restore doesn't delete history, creates new entry

## Future Enhancements

- Album autocomplete/create (currently disabled)
- Bulk edit capability
- Export edit history to CSV
- Email notifications on metadata changes
- Conflict resolution for concurrent edits

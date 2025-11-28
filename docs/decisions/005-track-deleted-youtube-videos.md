# ADR-005: Track Deleted YouTube Videos with Original Titles

## Status
Accepted

## Context

When syncing YouTube playlists, videos can become unavailable in two distinct scenarios:

1. **Video deleted from YouTube**: The video is removed from YouTube entirely, but still appears in the playlist API response with a generic title like "Deleted video" or "Private video"
2. **Track removed from playlist**: The video is still available on YouTube, but has been removed from the specific playlist

Previously, the sync process would:
- Overwrite existing track data with generic "Deleted video" titles
- Not distinguish between deleted videos and removed tracks
- Lose the original video information when videos were deleted

This made it difficult for users to:
- Remember what deleted videos were
- Understand which videos were deleted vs. removed from playlists
- Maintain a complete history of their playlists

## Decision

We implemented a comprehensive solution that:

1. **Distinguishes between deleted videos and removed tracks**:
   - **Deleted from YouTube**: Video appears in playlist items but marked as "Deleted video" → Keep in playlist, mark `isDeleted = true`, preserve original data
   - **Removed from playlist**: Video doesn't appear in playlist items at all → Remove `ServicePlaylistTrack` relationship

2. **Preserves original track data** when videos are deleted:
   - If a track already exists in the database with a real title (not "Deleted video"), preserve that title, artist, and thumbnail
   - Only update the deletion status flag and timestamp
   - Prevents loss of information when YouTube returns generic titles

3. **Tracks deletion status at the playlist-track relationship level**:
   - Added `isDeleted` boolean field to `ServicePlaylistTrack` model
   - Added `deletedAt` DateTime field to record when deletion was first detected
   - Allows a track to be deleted in one playlist but active in another

4. **Provides sync reporting**:
   - Returns lists of deleted tracks and removed tracks after each sync
   - Displays sync summary to users showing what changed
   - Helps users understand what happened during sync

## Implementation Details

### Database Schema Changes

**File**: `prisma/schema.prisma`

Added to `ServicePlaylistTrack` model:
- `isDeleted Boolean @default(false)` - Indicates if the video has been deleted from YouTube
- `deletedAt DateTime?` - Records when the video was first detected as deleted
- Index on `[playlistId, isDeleted]` for efficient queries

**Rationale**: Store deletion status at the playlist-track relationship level since a track could be in multiple playlists and only deleted in one.

### Detection Logic

**File**: `app/utils/service-playlist.server.ts`

#### Helper Functions

1. **`isDeletedYouTubeVideo(item: YouTubePlaylistItem): boolean`**
   - Checks for common deleted video patterns in title: "Deleted video", "Private video", "Unavailable video", etc.
   - Validates video ID presence
   - Checks metadata completeness (thumbnail availability)

2. **`shouldPreserveTrackData(existingTrack, newItem): boolean`**
   - Determines if we should keep existing track data vs. update it
   - Preserves data when video is deleted and we have a real title (not "Deleted video")

#### Sync Process

**`processTracksInBatches`**:
- Detects deleted videos during batch processing
- Preserves original track data when video is deleted (title, artist, thumbnail)
- Marks tracks as deleted with `isDeleted = true` and sets `deletedAt` timestamp
- Tracks deleted videos for reporting
- Returns processed external IDs for cleanup comparison

**`syncPlaylistTracks`**:
- After processing all tracks, identifies orphaned tracks (exist in DB but not in current sync)
- Deletes `ServicePlaylistTrack` relationships for removed tracks
- Returns sync summary with:
  - `deletedTracks: Array<{ id, title, externalId }>` - tracks marked as deleted
  - `removedTracks: Array<{ id, title, externalId }>` - tracks removed from playlist

### UI Changes

**File**: `app/components/track-list-item.tsx`
- Added `isDeleted` prop
- Visual indicator (icon + text) for deleted tracks: "• Deleted from YouTube"
- Muted styling (opacity-60) for deleted tracks
- Disabled play button for deleted tracks
- Tooltip explaining the video was deleted

**File**: `app/routes/music+/services+/youtube+/playlist.$id.tsx`
- Passes `isDeleted` status to `TrackListItem`
- Displays sync summary after sync with lists of deleted and removed tracks
- Shows counts and track titles in success message

### Type Definitions

**File**: `app/types/frontend/shared.ts`
- Added `isDeleted?: boolean` and `deletedAt?: Date | null` to `TrackWithUserStatus` interface

## Important Distinctions

| Scenario | YouTube API Response | Our Action |
|----------|---------------------|------------|
| **Video deleted from YouTube** | Item appears with "Deleted video" title | Keep in playlist, mark `isDeleted = true`, preserve original data |
| **Track removed from playlist** | Item does NOT appear in playlist items | Delete `ServicePlaylistTrack` relationship |
| **Video restored** | Item appears with normal data | Update track, set `isDeleted = false`, clear `deletedAt` |
| **Track re-added to playlist** | Item appears again | Create new `ServicePlaylistTrack` relationship |

## Edge Cases Handled

1. **First sync with deleted video**: If a video is already deleted when first syncing, we'll store "Deleted video" as title initially. On subsequent syncs, if YouTube provides more info, we can update.

2. **Video restored**: If a deleted video becomes available again, we update normally and clear deletion status.

3. **Multiple playlists**: A track can be deleted in one playlist but active in another - handled by `ServicePlaylistTrack.isDeleted` being playlist-specific.

4. **Partial data**: If we have original title but video is deleted, preserve the title. If we only have "Deleted video", keep that but mark as deleted.

5. **Track removed then re-added**: If a track is removed from playlist, then added back later, it will be recreated as a new `ServicePlaylistTrack` relationship.

6. **Track deleted then removed**: If a track is deleted from YouTube (marked `isDeleted = true`), then later removed from playlist entirely, the `ServicePlaylistTrack` relationship is deleted (normal removal behavior).

## Consequences

### Positive

- **Preserves user data**: Original video titles and metadata are preserved when videos are deleted
- **Clear distinction**: Users can see which videos were deleted vs. removed from playlists
- **Better UX**: Visual indicators help users understand what happened to their playlists
- **Sync transparency**: Users see exactly what changed during sync operations
- **Data integrity**: Track records remain in database even when deleted, allowing for recovery if videos are restored

### Negative

- **Database growth**: Deleted tracks remain in playlists, increasing database size over time
- **UI complexity**: Additional visual indicators and sync summaries add complexity to the UI
- **Sync performance**: Additional checks and data preservation logic slightly increase sync time

### Neutral

- **Migration required**: Existing playlists need to be re-synced to detect and mark deleted videos
- **Testing complexity**: More edge cases to test and maintain

## Testing

Comprehensive Vitest tests were added in `app/utils/service-playlist.server.test.ts` covering:

- Deleted video detection patterns
- Data preservation logic
- Removed tracks cleanup
- Sync summary reporting

## Related Decisions

- ADR-004: Remove Audio Download Functionality (unrelated, but shows pattern of ADR documentation)

## References

- [Prisma Schema](prisma/schema.prisma)
- [Service Playlist Service](app/utils/service-playlist.server.ts)
- [Track List Item Component](app/components/track-list-item.tsx)
- [Playlist Detail Page](app/routes/music+/services+/youtube+/playlist.$id.tsx)
- [Test Suite](app/utils/service-playlist.server.test.ts)


# ADR-006: Orphaned Track Confirmation for Deleted Videos

## Status
Accepted

## Context

When syncing YouTube playlists, deleted videos (videos that have been removed from YouTube but still appear in playlist items) need to be matched to existing tracks in the database to preserve their original titles and metadata.

The previous implementation (ADR-005) used position-based matching to find existing tracks for deleted videos. However, this approach has significant limitations:

1. **Unreliable when playlist order changes**: Users can manually reorder playlists on YouTube, causing positions to shift
2. **Breaks when videos are added/removed**: Adding or removing videos from a playlist causes all subsequent positions to shift
3. **Incorrect matches**: Position-based matching can match deleted videos to the wrong tracks when positions don't align

This led to:
- Loss of original track data when positions changed
- Incorrect matches between deleted videos and existing tracks
- User confusion when track titles don't match expectations

## Decision

We replaced position-based matching with a confirmation system that:

1. **Matches by stable identifiers first**: Tries to match deleted videos by `externalId` (video ID) or playlist item ID before falling back to orphaned track detection
2. **Finds orphaned tracks**: Identifies tracks in the database that are in the playlist but not in the current YouTube API response
3. **Shows confirmation dialog**: Presents orphaned tracks as candidates for user selection when automatic matching fails
4. **Requires all-or-nothing confirmation**: User must select an action (match, create new, or skip) for every deleted video before submitting
5. **Processes in transaction**: All confirmations are processed atomically - if any fails, all changes are rolled back

## Implementation Details

### Matching Strategy

1. **First**: Try matching by playlist item ID (`item.id`) - this is stable across syncs
2. **Second**: Try matching by `externalId` (video ID) - this is the most reliable identifier
3. **Third**: If no match found, find orphaned tracks (tracks in playlist but not in current sync)
4. **Fourth**: Add to `pendingMatches` for user confirmation

### Orphaned Track Detection

Orphaned tracks are identified as:
- Tracks in the `ServicePlaylistTrack` table for this playlist
- NOT in `processedExternalIds` or `processedTrackIds` (not processed in current sync)
- NOT already deleted (`isDeleted === false`) - Edge Case 9
- NOT already claimed in other pending matches - Edge Case 1

### User Confirmation Flow

1. After sync completes, if `pendingMatches` exist, show confirmation dialog
2. Dialog shows each deleted video with:
   - Position in playlist
   - Candidate tracks (if any) with title, artist, and position
   - Options: "Match to [Track Name]", "Create New Track", or "Skip"
3. User must select an action for every deleted video (all-or-nothing - Edge Case 5)
4. Dialog is paginated for large lists (5-10 per page - Edge Case 7)
5. Sync button is disabled while dialog is open (Edge Case 6)
6. On confirmation, all matches are processed in a single transaction (Edge Case 10)

### Edge Cases Handled

1. **Multiple Deleted Videos, Multiple Orphaned Tracks**: Track which orphaned tracks are claimed to prevent duplicate suggestions
2. **User Closes Dialog**: Show persistent banner, allow retry on next sync
3. **No Orphaned Tracks**: Only show "Create New" and "Skip" options
4. **Orphaned Track Matches Multiple Deleted Videos**: Show as candidate for all, user chooses
5. **Partial Confirmation**: Not allowed - all selections must be made (all-or-nothing)
6. **Sync While Dialog Open**: Disable sync button, show message
7. **Large Number of Matches**: Paginate dialog (5-10 per page)
8. **Cross-Playlist Matching**: Only show orphaned tracks from same playlist
9. **Already-Deleted Tracks**: Excluded from orphaned track candidates (already processed)
10. **Transaction Failure**: Rollback all changes, show error, allow retry

## Consequences

### Positive

- **Reliable matching**: No longer depends on unstable position data
- **User control**: Users can verify and correct matches before they're applied
- **Data integrity**: Original track data is preserved when users confirm correct matches
- **Flexible**: Handles edge cases gracefully (reordered playlists, multiple deletions, etc.)
- **Atomic operations**: All confirmations processed in transaction, preventing partial states

### Negative

- **Additional user interaction**: Requires user confirmation for deleted videos that can't be auto-matched
- **Two-step process**: Sync happens first, then confirmation (requires second action)
- **UI complexity**: Added confirmation dialog with pagination and state management
- **Potential delay**: Users must complete confirmation before syncing again

### Trade-offs

- **User experience vs. automation**: We chose user control over full automation to ensure data accuracy
- **Position-based vs. confirmation**: We chose reliability over convenience
- **All-or-nothing vs. partial**: We chose data consistency over flexibility

## Testing

- Test with reordered playlists (positions changed)
- Test with multiple deleted videos
- Test with no orphaned tracks (new playlist scenario)
- Test with orphaned tracks that match deleted videos
- Test all-or-nothing confirmation requirement
- Test pagination for large lists
- Test sync button disabling
- Test transaction rollback on failure
- Test already-deleted tracks exclusion

## References

- ADR-005: Track Deleted YouTube Videos with Original Titles
- [MDN: HTMLMediaElement.seeking](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/seeking)
- [MDN: HTMLMediaElement.readyState](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/readyState)






# Issue 5: Service playlist + user library modules

**Labels:** `ready-for-agent`  
**Blocks:** none  
**Blocked by:** #47  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Deepen **Playlist Sync** into service-playlist feature; split **UserTrack** writes into user-library feature. Big-bang from ServicePlaylistService facade.

## Acceptance criteria

- [ ] `syncServicePlaylist` + `confirmOrphanedMatches` public interface
- [ ] Listing/queries: getAllPlaylistsWithSyncStatus, getPlaylistTracksWithUserStatus
- [ ] User library: add/remove UserTrack in separate module
- [ ] Provider seam: fetch + normalize only; no validateConnection
- [ ] resolveServiceAccessToken() for tokens; ArchiveEnqueueAdapter injected
- [ ] Cover images fire-and-forget post-sync; delete dead preDownloadImages
- [ ] Collapse batch/image processor into service-playlist; delete fragmented provider slices
- [ ] Existing service-playlist tests updated to new module paths/interfaces

## Implementation notes

Blocked by #1 (tokens). Archive enqueue adapter can use production auto-enqueue from audio-archive feature. Largest refactor — see spec § Service playlist module.

## Testing

Prior art: service-playlist server tests. End-to-end sync scenarios through syncServicePlaylist seam.

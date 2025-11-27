# ADR-004: Remove Audio Download Functionality

## Status
Accepted

## Context
The Music Library application previously included functionality to download and archive YouTube audio files using `yt-dlp`. This feature allowed users to download audio tracks from YouTube videos and store them in S3-compatible storage (Tigris) for offline playback.

### Problems with Audio Download Functionality

#### 1. YouTube Bot Detection
- YouTube's bot detection systems became increasingly sophisticated
- Download attempts were frequently blocked or rate-limited
- IP addresses were being flagged and temporarily banned
- Downloads would fail with various error codes (403, 429, etc.)
- Required constant workarounds and updates to `yt-dlp` configurations

#### 2. Maintenance Burden
- `yt-dlp` required frequent updates to bypass detection
- Chromium cookie database setup was complex and fragile
- `ffmpeg` dependency added complexity to Docker builds
- Storage costs for audio files were significant
- Background worker system added architectural complexity

#### 3. Legal and Ethical Concerns
- Downloading copyrighted content may violate YouTube's Terms of Service
- Potential legal issues with storing and serving copyrighted audio
- Ethical concerns about bypassing platform restrictions

#### 4. Feature Complexity
- Complex queue management system
- WebSocket progress broadcasting
- Background worker architecture
- Storage upload/download workflows
- Multiple failure states and retry logic

### Requirements
- Remove all audio download functionality
- Clean up database schema (remove `TrackAudioFile` model)
- Remove all related API routes and utilities
- Clean up UI components that referenced audio files
- Update documentation to reflect changes
- Maintain core functionality (playlist management, track library)

## Decision
Completely remove all audio download functionality from the codebase, including:
- YouTube audio download utilities (`yt-dlp` integration)
- Background audio archive workers
- Audio file storage and retrieval
- Download queue management
- Audio playback UI components
- Related database models and migrations

The application will continue to function as a music library manager, allowing users to:
- Sync YouTube playlists
- View and manage tracks
- Create and manage playlists
- Import tracks from YouTube

Audio playback functionality is disabled until a legal and sustainable alternative is identified.

## Consequences

### Positive
- ✅ **Reduced Maintenance**: No more `yt-dlp` updates or bot detection workarounds
- ✅ **Simpler Architecture**: Removed complex worker system and queue management
- ✅ **Lower Costs**: No storage costs for audio files
- ✅ **Legal Compliance**: Avoids potential ToS violations
- ✅ **Faster Builds**: Removed `yt-dlp`, `ffmpeg`, and Chromium dependencies
- ✅ **Cleaner Codebase**: Removed ~15 files and simplified many components
- ✅ **Better Performance**: No background processing overhead

### Negative
- ❌ **No Offline Playback**: Users cannot download or play audio files
- ❌ **Reduced Functionality**: Audio player component is disabled
- ❌ **Lost Features**: Download progress, queue management, and audio archive features removed
- ❌ **Migration Required**: Existing `TrackAudioFile` records need to be cleaned up

### Neutral
- 🔄 **Simplified UI**: Audio player UI removed, but core library management remains
- 🔄 **Database Changes**: `TrackAudioFile` table removed via migration
- 🔄 **Documentation Updates**: README and ARCHITECTURE.md updated

## Implementation Details

### Files Removed

#### API Routes
- `app/routes/api+/download-youtube-audio.tsx`
- `app/routes/api+/mark-track-downloading.tsx`
- `app/routes/api+/cancel-track-download.tsx`
- `app/routes/api+/get-downloading-tracks.tsx`
- `app/routes/api+/get-track-status.tsx`
- `app/routes/api+/mark-track-failed.tsx`
- `app/routes/api+/upload-track-audio.tsx`
- `app/routes/resources+/track.$trackId.download.tsx`
- `app/routes/resources+/audio.tsx`
- `app/routes/admin+/audio-queue.tsx`
- `app/routes/test-progress.tsx`

#### Utilities
- `app/utils/youtube-downloader.server.ts`
- `app/utils/youtube-downloader.client.ts`
- `app/utils/track-enqueue.server.ts`
- `app/utils/audio-archive.ts`
- `app/utils/progress-broadcast.server.ts`
- `app/utils/progress-broadcast.client.ts`

#### Components and Hooks
- `app/components/download-progress.tsx`
- `app/components/download-queue-provider.tsx`
- `app/hooks/use-download-manager.tsx`

#### Server Workers
- `server/workers/audio-archive.ts`
- `server/workers/audio-queue.ts`
- `server/workers/audio-worker-control.ts`
- `server/workers/audio-worker.ts`
- `server/utils/websocket.ts`

#### Documentation
- `audio-archive-feature.md`
- `refactor-storage-system.md`
- `docs/decisions/003-audio-worker-architecture.md`

### Database Changes

#### Schema Updates
- Removed `TrackAudioFile` model from `prisma/schema.prisma`
- Removed `audioFile` relation from `Track` model
- Created migration to drop `TrackAudioFile` table and indexes

#### Migration
```sql
-- Migration: Remove TrackAudioFile table
DROP INDEX IF EXISTS "TrackAudioFile_trackId_key";
DROP INDEX IF EXISTS "TrackAudioFile_objectKey_key";
DROP TABLE IF EXISTS "TrackAudioFile";
```

### Code Changes

#### Components Simplified
- `app/components/audio-player.tsx`: Simplified to return `null` (disabled)
- `app/components/track-list-item.tsx`: Removed download buttons and audio file status
- `app/components/audio-player-provider.tsx`: Removed `audioFile` references
- `app/routes/library.$trackId.tsx`: Removed audio playback section
- `app/routes/music+/services+/youtube+/playlist.$id.tsx`: Removed download queue integration

#### Utilities Cleaned
- `app/utils/storage.server.ts`: Removed `uploadAudioFile` function
- `app/utils/misc.tsx`: Removed `getAudioSrc` function
- `app/utils/download.ts`: Removed `downloadTrack` function
- `app/utils/service-import.server.ts`: Removed download-related logic
- `app/utils/service-playlist.server.ts`: Removed `markTrackAsPendingDownload` calls

#### Environment Variables Removed
- `AUDIO_ARCHIVE_ENABLED`
- `AUDIO_ARCHIVE_MAX_CONCURRENT`
- `AUDIO_ARCHIVE_INTERVAL_MS`

#### Dockerfile Changes
- Removed `yt-dlp` installation
- Removed Chromium cookie database setup
- Removed `ffmpeg` installation

#### Server Changes
- `server/index.ts`: Removed WebSocket progress broadcasting
- Removed audio worker initialization

### Type Changes
- `app/types/frontend/shared.ts`: Removed `audioFile` from `TrackWithUserStatus` type

## Alternatives Considered

### Alternative 1: Keep Functionality with Better Error Handling
- **Pros**: Maintains feature for users
- **Cons**: Still subject to bot detection, requires constant maintenance
- **Decision**: Rejected - doesn't solve the root problem

### Alternative 2: Use Official YouTube API for Audio
- **Pros**: Legal and sustainable
- **Cons**: YouTube API doesn't provide audio download capabilities
- **Decision**: Rejected - not technically feasible

### Alternative 3: Switch to Different Audio Source
- **Pros**: Could provide audio from other sources
- **Cons**: Would require significant refactoring, may have similar legal issues
- **Decision**: Deferred - can be considered in the future

### Alternative 4: Make Downloads Optional/User-Initiated
- **Pros**: Reduces server load and bot detection risk
- **Cons**: Still violates ToS, doesn't solve legal concerns
- **Decision**: Rejected - doesn't address core issues

### Alternative 5: Remove Completely (Chosen)
- **Pros**: Eliminates all problems, simplifies codebase
- **Cons**: Loses functionality
- **Decision**: Accepted - best long-term solution

## Migration Strategy

### Phase 1: Code Removal
1. Delete all audio download-related files
2. Remove `audioFile` references from components
3. Remove download-related API routes
4. Remove background workers

### Phase 2: Database Migration
1. Create migration to drop `TrackAudioFile` table
2. Remove model from Prisma schema
3. Run migration in production

### Phase 3: Cleanup
1. Remove unused imports and variables
2. Fix build/typecheck/lint errors
3. Update documentation
4. Remove environment variables

### Phase 4: Verification
1. Verify app builds successfully
2. Verify no broken imports
3. Verify database migration runs
4. Test remaining functionality

## Success Metrics

### Technical Metrics
- [x] Zero references to `audioFile` in codebase
- [x] Zero references to `yt-dlp` or download functionality
- [x] Build succeeds without errors
- [x] TypeScript compilation succeeds
- [x] Lint passes with no errors
- [x] Database migration runs successfully

### Quality Metrics
- [x] All audio-related code removed
- [x] Documentation updated
- [x] No broken functionality (playlists, tracks, library management)
- [x] Clean codebase with no dead code

### Developer Experience Metrics
- [x] Simpler codebase to understand
- [x] Faster build times
- [x] Reduced maintenance burden
- [x] Clear documentation of changes

## Future Considerations

### Potential Alternatives
- **Streaming Integration**: Integrate with legal streaming services (Spotify, Apple Music APIs)
- **User Uploads**: Allow users to upload their own audio files
- **External Links**: Focus on providing links to legal streaming sources
- **Podcast Support**: Add support for podcast RSS feeds

### Architecture
- Audio player component structure remains for future use
- Database schema can be extended if needed
- Storage utilities remain for other use cases (images, etc.)

### Legal Compliance
- All future audio features must comply with platform ToS
- Consider legal review before adding audio download features
- Prefer official APIs over scraping/downloading

## References

- [YouTube Terms of Service](https://www.youtube.com/static?template=terms)
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [ADR-002: Eliminating Cross-Boundary Imports](./002-cross-boundary-imports.md) - Documents audio worker architecture (now removed)

## Related ADRs

- [ADR-002: Eliminating Cross-Boundary Imports](./002-cross-boundary-imports.md) - Documents the audio worker architecture that was removed
- [ADR-001: Type Safety with Zod Validation](./001-type-safety-architecture.md)

## Revision History

- **2025-01-15**: Initial version - Documents decision to remove audio download functionality


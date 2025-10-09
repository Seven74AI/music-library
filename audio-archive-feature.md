# Audio Archive Implementation Plan

## Overview

Implement a background job system that gradually archives audio files for all YouTube tracks in the database. Files will be stored as MP3 in Tigris storage (one file per track, shared globally). Authenticated users can download archived tracks. Admins can control the worker (pause/resume/break long pauses) without interrupting current downloads.

## Key Technical Decisions

1. **Storage Structure**: Store audio files at `audio/{serviceName}/{trackId}.mp3` in Tigris (e.g., `audio/youtube/ckl123.mp3`)
2. **Storage Metadata**: Include S3 metadata headers for searching/filtering without downloading files
3. **Database**: Repurpose existing `TrackAudioFile` model with additional status tracking fields
4. **Queue System**: Database-persisted queue with in-memory worker, priority-first then FIFO ordering
5. **Worker Control**: Database-persisted WorkerState for pause/resume/break controls that survive restarts
6. **yt-dlp Integration**: Execute yt-dlp binary directly via execa (no wrappers)
7. **Processing**: Background worker processes max 2 tracks concurrently (2 separate yt-dlp processes via Promise.all)
8. **Rate Limiting**: yt-dlp sleep intervals (2-5s) + long breaks every 6-8h for 3-4h to mimic human behavior
9. **Retry Logic**: Exponential backoff (5min, 30min, 2h), max 3 retries, then permanently failed

## Implementation Steps

### 1. Database Schema Updates

**Migration 1 - Rename Field**:

- Rename `Track.serviceProviderId` → `Track.externalId` (consistent with ServicePlaylist naming)

**Migration 2 - Update TrackAudioFile**:

Add archiving status fields:

- `status` (enum: 'pending', 'processing', 'completed', 'failed') - Current archive status
- `priority` (boolean, default false) - Admin-triggered priority archiving (processed first)
- `errorHistory` (nullable JSON text) - Array of all errors: `[{code, message, attemptAt, retryCount}]`. Latest error = last entry in array
- `retryCount` (integer, default 0) - Number of retry attempts (0-3)
- `downloadedAt` (nullable timestamp) - When archiving completed
- `lastAttemptAt` (nullable timestamp) - Last processing attempt
- Index on `status` for queue queries
- Index on `[status, priority, createdAt]` for queue ordering (priority first, then FIFO)
- Index on `[status, lastAttemptAt]` for retry logic

**Migration 3 - Create WorkerState**:

Worker control state (single row table):

- `id` (string, default 'singleton') - Primary key, always 'singleton' (only 1 record)
- `status` (enum: 'running', 'paused', 'long_break') - Current worker state
- `lastStateChange` (timestamp) - When state last changed
- `lastQueueRun` (nullable timestamp) - Last time queue was processed
- `nextLongBreakAt` (nullable timestamp) - When next automatic long break starts
- `currentlyProcessing` (integer, default 0) - Count of active downloads (0-2)
- `updatedAt` (timestamp) - Auto-updated timestamp

**Error History Format**:

```typescript
type ErrorHistoryEntry = {
  code: string // e.g., 'VIDEO_UNAVAILABLE', 'RATE_LIMITED', 'NETWORK_ERROR'
  message: string // Actual yt-dlp error message
  attemptAt: string // ISO timestamp
  retryCount: number // Which retry attempt this was (0-3)
}

// Get current error: errorHistory[errorHistory.length - 1]
```

**Note**: Removed separate `errorCode` and `errorMessage` fields since they're redundant with errorHistory

### 2. Install yt-dlp Binary

**Update Dockerfile** (`other/Dockerfile`):

```dockerfile
# Install yt-dlp via pip
RUN pip install yt-dlp

# Install ffmpeg for audio conversion (if not already present)
RUN apt-get update && apt-get install -y ffmpeg
```

**Install Node.js execution package**:

```bash
npm install execa
```

**yt-dlp Command** (from [official docs](https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#usage-and-options)):

```bash
yt-dlp -x --audio-format mp3 --audio-quality 0 -f bestaudio \
  --no-playlist --quiet --no-warnings --newline \
  --sleep-interval 2-5 \
  --embed-thumbnail \
  --add-metadata \
  --retries 3 \
  --fragment-retries 3 \
  -o "/tmp/%(id)s.%(ext)s" \
  "https://www.youtube.com/watch?v={VIDEO_ID}"
```

**Key Options**:

- `-x, --extract-audio`: Audio only
- `--audio-format mp3`: Convert to MP3 (requires ffmpeg)
- `--audio-quality 0`: Best quality (0=best, 9=worst; 320kbps when available)
- `-f bestaudio`: Best available audio stream
- `--no-playlist`: Single video only
- `--quiet`: Suppress output except errors
- `--no-warnings`: No warning messages
- `--newline`: Progress as new lines (easier to parse)
- `--sleep-interval 2-5`: Random 2-5 second delay (anti-rate-limit)
- `--embed-thumbnail`: Embed thumbnail as album art
- `--add-metadata`: Write ID3 tags (title, artist from YouTube)
- `--retries 3`: Retry download 3 times
- `--fragment-retries 3`: Retry fragments 3 times

**Two Metadata Systems**:

1. **MP3 File Metadata (ID3 Tags)**:

   - Created by yt-dlp (`--add-metadata`, `--embed-thumbnail`)
   - Embedded inside MP3 file
   - Source: YouTube video metadata
   - Users see in music players

2. **Tigris Storage Metadata (S3 Headers)**:

   - Added when uploading to Tigris
   - Source: Our database Track model
   - Format: `x-amz-meta-*` headers (AWS S3 standard for custom metadata - Tigris is S3-compatible)
   - Used for searching/filtering in Tigris console without downloading files
   - Example: `x-amz-meta-track-id: ckl123`, `x-amz-meta-service: youtube`

### 3. Create Audio Archiving Service

**File**: `app/utils/audio-archive.server.ts`

**Constants**:

```typescript
const MAX_CONCURRENT_DOWNLOADS = 2
const SLEEP_INTERVAL_RANGE = '2-5' // Passed to yt-dlp
const LONG_BREAK_INTERVAL_HOURS = [6, 8] // Random 6-8h
const LONG_BREAK_DURATION_HOURS = [3, 4] // Random 3-4h pause
```

**Functions**:

- `downloadTrackAudio(track: Track)`: Execute yt-dlp with track.externalId, returns local file path
- `uploadAudioToStorage(filePath: string, track: Track)`: Upload to Tigris at `audio/{service}/{trackId}.mp3` with metadata:
  - `x-amz-meta-track-id`: track.id
  - `x-amz-meta-service`: service name
  - `x-amz-meta-external-id`: track.externalId
  - `x-amz-meta-title`: track.title
  - `x-amz-meta-artist`: track.artist
  - `x-amz-meta-archived-at`: ISO timestamp
- `archiveTrackAudio(trackId: string)`: Main function - orchestrates download → upload → update DB, updates `currentlyProcessing` count
- `addToErrorHistory(trackAudioFile, errorCode, errorMessage)`: Append to errorHistory JSON array
- Error handling and status updates

### 4. Create Background Job Queue

**File**: `app/utils/audio-queue.server.ts`

**Retry Strategy**:

- Max 3 retries (4 total attempts)
- Exponential backoff:
  - 1st retry: 5 minutes after failure
  - 2nd retry: 30 minutes after failure
  - 3rd retry: 2 hours after failure
- After 3rd failure: status='failed' permanently

**Functions**:

- `enqueueTrack(trackId: string, priority = false)`: Create TrackAudioFile with status='pending' and optional priority flag
- `processQueue()`: 

  1. Check WorkerState.status - skip if 'paused' or 'long_break'
  2. Query for pending tracks with priority-first, FIFO ordering:
     ```sql
     WHERE status = 'pending'
     ORDER BY priority DESC, createdAt ASC
     LIMIT 2
     ```

  1. Process both tracks **concurrently** using `Promise.all([archiveTrackAudio(track1.id), archiveTrackAudio(track2.id)])` - runs 2 separate yt-dlp processes simultaneously
  2. Update WorkerState.lastQueueRun and currentlyProcessing count

- `getRetryableTracks()`: Get failed tracks eligible for retry (exponential backoff check)
- `resetTrackForRetry(trackId: string, priority = false)`: Admin manual retry - reset status to 'pending', retryCount to 0, set priority flag, preserve errorHistory
- Long break scheduling based on WorkerState.nextLongBreakAt

### 5. Worker Control Functions

**File**: `app/utils/audio-worker-control.server.ts`

**Functions**:

- `pauseWorker()`: 
  - Set WorkerState.status = 'paused'
  - Stop interval timer (no new queue processing)
  - Wait for current downloads to finish (check currentlyProcessing until 0)
  - Return success when fully paused
- `resumeWorker()`:
  - Set WorkerState.status = 'running'
  - Restart interval timer
  - Calculate next long break time (random 6-8h from now)
  - Update WorkerState.nextLongBreakAt
  - Immediately trigger processQueue() (don't wait for next interval)
- `breakLongPause()`:
  - Only callable when WorkerState.status = 'long_break'
  - Set WorkerState.status = 'running'
  - Calculate next long break time (random 6-8h from now)
  - Restart interval timer
  - Immediately trigger processQueue()
- `getWorkerStatus()`:
  - Return current WorkerState
  - Calculate time until next long break
  - Get currentlyProcessing count
- `cleanupStuckTracks()`:
  - Called on server startup
  - Reset any tracks with status='processing' back to 'pending'
  - These are tracks that were interrupted by server restart

### 6. Background Worker Process

**File**: `app/utils/audio-worker.server.ts`

**On Startup**:

1. Initialize or fetch WorkerState from database (singleton record)
2. Run `cleanupStuckTracks()` to reset any tracks stuck in 'processing' status
3. If WorkerState.status = 'running':

   - Start interval timer (every 5 min)
   - Check if long break is due

4. If WorkerState.status = 'paused':

   - Don't start interval timer (stay paused)

5. If WorkerState.status = 'long_break':

   - Don't start interval timer (stay in break)

**Interval Logic** (every 5 minutes):

1. Check if it's time for long break (compare now vs WorkerState.nextLongBreakAt)
2. If long break due:

   - Wait for currentlyProcessing to reach 0
   - Set WorkerState.status = 'long_break'
   - Sleep for random 3-4h
   - Set status back to 'running', calculate next break time

3. Call `processQueue()` if status is 'running'
4. Handle errors and logging

**Graceful Shutdown**:

- Stop interval timer
- Wait for currentlyProcessing to reach 0 (or timeout after 10 minutes)
- Don't change WorkerState.status (preserves paused state across restarts)

### 7. Storage Utility Updates

**File**: `app/utils/storage.server.ts`

- `uploadAudioFile(buffer: Buffer, objectKey: string, metadata: Record<string, string>)`: Upload with S3 metadata headers
- `getSignedAudioUrl(objectKey: string)`: Generate signed download URL (5-min expiry)
- `deleteAudioFile(objectKey: string)`: Delete from Tigris (cleanup/retry)

### 8. Download Route

**File**: `app/routes/resources+/track.$trackId.download.tsx`

**Loader**:

- Require authentication
- Fetch track with audioFile relation
- Check if `audioFile.objectKey` exists (implies completed successfully)
- Generate signed Tigris URL using `audioFile.objectKey`
- Set `Content-Disposition: attachment; filename="{audioFile.fileName}"`
- Redirect to signed URL

**Key Distinction**:

- `objectKey`: Storage path (e.g., `audio/youtube/ckl123.mp3`)
- `fileName`: Download name (e.g., `Never Gonna Give You Up.mp3`)

### 9. UI Updates - User Pages

**Update**: `app/routes/library.index.tsx`

- Download icon button when `track.audioFile?.objectKey` exists
- Status badge: 'Pending', 'Processing', 'Failed', 'Completed'
- Link to download route

**Update**: `app/routes/library.$trackId.tsx`

- Download button when `audioFile.objectKey` exists
- Status badge display
- Latest error from errorHistory (read-only, NO retry button for users)

**Update**: `app/routes/music+/services+/youtube+/playlist.$id.tsx`

- Download icons when `track.audioFile?.objectKey` exists

### 10. Admin Queue Management Page

**File**: `app/routes/admin+/audio-queue.tsx`

**Features**:

- Require admin permissions

**Worker Control Panel**:

- **Status Badge**: 
  - "Running" (green) when status='running'
  - "Paused" (yellow) when status='paused'
  - "Long Break" (blue) when status='long_break'
- **Control Buttons**:
  - "Pause Archiving" (when running) → calls `pauseWorker()`, shows "Pausing... (X downloads completing)" during graceful pause
  - "Resume Archiving" (when paused or long_break) → calls `resumeWorker()` or `breakLongPause()`
  - "Break Long Pause" (only when long_break) → calls `breakLongPause()`
- **Worker Info**:
  - Currently processing: X/2 tracks
  - Last queue run: timestamp
  - Next scheduled run: timestamp (when running)
  - Next long break in: "4h 23m" (only when running)
  - Paused since: timestamp (only when paused)
  - Break ends at: timestamp (only when long_break)

**Queue Statistics**:

- Total pending
- Currently processing (0-2) with name (id)
- Completed count
- Failed count
- Success rate %

**Track Table**:

- Track title, artist, service
- Status badge
- Retry count
- Latest error from errorHistory (last entry in array)
- Last attempt timestamp
- **Actions**:
  - "Retry Archive" button (failed tracks) → calls `resetTrackForRetry(trackId, priority=true)`
  - "Archive Now" button (any track without audioFile) → calls `enqueueTrack(trackId, priority=true)`
  - "View Track" link
- **Filters**: All / Pending / Processing / Completed / Failed
- Pagination

**Admin Actions Explained**:

1. **"Pause Archiving"**: Gracefully stops worker (current downloads finish, no new ones start), persists across restarts
2. **"Resume Archiving"**: Restarts worker from paused state, immediately processes queue
3. **"Break Long Pause"**: Ends automatic long break early, resumes normal operation
4. **"Retry Archive"**: Resets failed track to pending with priority, preserves error history
5. **"Archive Now"**: Immediately enqueues track with priority flag

### 11. Auto-Enqueue on Track Creation

**Files to modify**:

- `app/utils/service-import.server.ts` (track import)
- `app/utils/service-playlist.server.ts` (playlist sync)

**Logic**:

- When new Track created → call `enqueueTrack(trackId, priority=false)`
- Creates TrackAudioFile with status='pending', priority=false
- Background worker picks up automatically in FIFO order
- No "Enqueue All" button needed (fresh DB)

### 12. Environment Configuration

**File**: `app/utils/env.server.ts`

Add environment variables:

```typescript
AUDIO_ARCHIVE_ENABLED: z.enum(['true', 'false']).optional()
AUDIO_ARCHIVE_MAX_CONCURRENT: z.string().optional() // Default: '2'
AUDIO_ARCHIVE_INTERVAL_MS: z.string().optional() // Default: '300000' (5 min)
```

**.env**:

```env
AUDIO_ARCHIVE_ENABLED=true
AUDIO_ARCHIVE_MAX_CONCURRENT=2
AUDIO_ARCHIVE_INTERVAL_MS=300000
```

### 13. Server Integration

**File**: `server/index.ts`

- Import and initialize audio worker on server startup
- Run `cleanupStuckTracks()` on startup
- Initialize WorkerState if doesn't exist
- Check WorkerState.status and start worker accordingly
- Handle graceful shutdown (wait for current downloads, preserve state)

## Files to Create

1. `app/utils/audio-archive.server.ts` - Core archiving logic
2. `app/utils/audio-queue.server.ts` - Queue management
3. `app/utils/audio-worker.server.ts` - Background worker
4. `app/utils/audio-worker-control.server.ts` - Worker control functions (pause/resume/break)
5. `app/routes/resources+/track.$trackId.download.tsx` - Download endpoint
6. `app/routes/admin+/audio-queue.tsx` - Admin queue page with worker controls
7. `prisma/migrations/XXXXXX_rename_service_provider_id/migration.sql` - Rename migration
8. `prisma/migrations/XXXXXX_add_audio_archive_fields/migration.sql` - TrackAudioFile fields
9. `prisma/migrations/XXXXXX_create_worker_state/migration.sql` - WorkerState table

## Files to Modify

1. `prisma/schema.prisma` - Rename field, add TrackAudioFile fields, add WorkerState model
2. `app/utils/storage.server.ts` - Audio file methods
3. `app/routes/library.index.tsx` - Download UI
4. `app/routes/library.$trackId.tsx` - Download button, status
5. `app/routes/music+/services+/youtube+/playlist.$id.tsx` - Download icons
6. `server/index.ts` - Initialize worker with cleanup and state check
7. `package.json` - Add execa
8. `app/utils/env.server.ts` - Environment variables
9. `app/utils/service-import.server.ts` - Auto-enqueue on import
10. `app/utils/service-playlist.server.ts` - Auto-enqueue on playlist sync
11. `other/Dockerfile` - Install yt-dlp and ffmpeg

## Additional Considerations

- **Storage Costs**: Monitor Tigris usage (~3-5MB per track)
- **Legal**: Ensure YouTube ToS compliance
- **Performance**: yt-dlp is CPU intensive
- **Cleanup**: Strategy for removing unused files
- **Monitoring**: Sentry tracking for failures
- **Rate Limiting**: Long breaks critical to avoid YouTube bans
- **Worker Control**: Pause state persists across restarts for safety
- **Graceful Operations**: Current downloads always finish before pause/break/shutdown
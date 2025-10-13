# ADR-003: Audio Worker Architecture

## Status
Accepted

## Context
The music library needed a robust background service to automatically download and archive YouTube audio tracks. The initial implementation had several limitations:

1. **Blocking long breaks**: Worker used `setTimeout` for long breaks, making it impossible for admins to interrupt
2. **Slow processing**: 5-minute intervals were too slow for responsive user experience
3. **OAuth dependency**: YouTube downloads required OAuth tokens that were causing HTTP 400 errors
4. **Poor admin control**: Limited ability to control worker behavior in real-time

## Decision
We implemented a comprehensive audio worker system with the following key architectural decisions:

### 1. Polling-Based Long Breaks
**Decision**: Replace blocking `setTimeout` with polling-based system
**Rationale**: 
- Allows admin interruption of long breaks
- Maintains responsiveness while respecting break durations
- 30-second polling interval balances responsiveness with efficiency

**Implementation**:
```typescript
// Polling approach to allow admin interruption
const startTime = Date.now()
const checkInterval = 30 * 1000 // Check every 30 seconds

while (Date.now() - startTime < breakDurationMs) {
  // Check if admin wants to break the pause
  const currentState = await prisma.workerState.findUnique({
    where: { id: 'singleton' },
    select: { status: true },
  })
  
  if (currentState?.status !== 'long_break') {
    console.log('Long break interrupted by admin')
    return true
  }
  
  // Sleep for a shorter interval
  await new Promise(resolve => setTimeout(resolve, checkInterval))
}
```

### 2. Reduced Processing Intervals
**Decision**: Reduce worker interval from 5 minutes to 2 minutes
**Rationale**:
- Faster response to new tracks in queue
- Better user experience with quicker processing
- Still respects rate limiting with sleep intervals

### 3. Shorter Long Break Durations
**Decision**: Reduce long break duration from 3-4 hours to 1-2 hours
**Rationale**:
- More responsive system
- Still provides necessary rest periods
- Admin can interrupt if needed

### 4. OAuth Token Removal
**Decision**: Remove OAuth token dependency from yt-dlp calls
**Rationale**:
- OAuth tokens were causing HTTP 400 errors
- yt-dlp works reliably without authentication for public videos
- Simplifies the system and reduces failure points

**Implementation**:
```typescript
// OAuth token removed - using yt-dlp without authentication
await execa('yt-dlp', ytDlpArgs.filter((arg): arg is string => typeof arg === 'string'))
```

### 5. Enhanced Download System
**Decision**: Implement comprehensive download optimization
**Rationale**:
- Random user agents prevent detection
- Sleep intervals respect rate limits
- Fragment retries handle network issues
- Quality settings ensure best audio quality

**Implementation**:
```typescript
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
]
const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)]

const ytDlpArgs = [
  '-x', // Extract audio only
  '--audio-format', 'mp3',
  '--audio-quality', '0', // Best quality
  '-f', 'bestaudio',
  '--no-playlist',
  '--quiet',
  '--no-warnings',
  '--newline',
  '--sleep-interval', String(sleepInterval),
  '--max-sleep-interval', String(sleepInterval * 2),
  '--user-agent', randomUserAgent,
  '--embed-thumbnail',
  '--add-metadata',
  '--retries', '3',
  '--fragment-retries', '3',
  '-o', outputPath, youtubeUrl,
]
```

## Consequences

### Positive
- **Admin control**: Long breaks can be interrupted via admin interface
- **Faster processing**: 2-minute intervals provide quicker response
- **Reliability**: OAuth removal eliminates HTTP 400 errors
- **Better UX**: Shorter breaks and faster processing improve user experience
- **Robust downloads**: Enhanced yt-dlp configuration improves success rates

### Negative
- **Slightly more database queries**: Polling system checks database every 30 seconds
- **No authenticated downloads**: Cannot download private/age-restricted content
- **Resource usage**: More frequent processing increases CPU usage

### Neutral
- **Complexity**: System is more complex but more capable
- **Configuration**: More environment variables for fine-tuning

## Implementation Details

### File Structure
```
server/workers/
├── audio-worker.ts          # Main orchestrator
├── audio-queue.ts           # Queue processing
├── audio-archive.ts         # Individual track processing
└── audio-worker-control.ts  # State management utilities
```

### Database Schema
```sql
-- Worker state tracking
CREATE TABLE WorkerState (
  id TEXT PRIMARY KEY DEFAULT 'singleton',
  status TEXT NOT NULL CHECK (status IN ('running', 'paused', 'long_break')),
  currentlyProcessing INTEGER NOT NULL DEFAULT 0,
  lastQueueRun TIMESTAMP,
  nextLongBreakAt TIMESTAMP,
  lastStateChange TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Track processing status
CREATE TABLE TrackAudioFile (
  trackId TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  priority BOOLEAN NOT NULL DEFAULT FALSE,
  retryCount INTEGER NOT NULL DEFAULT 0,
  lastAttemptAt TIMESTAMP,
  errorHistory TEXT, -- JSON array of error entries
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Environment Variables
```bash
# Enable/disable audio archiving
AUDIO_ARCHIVE_ENABLED=true

# Worker interval (milliseconds)
AUDIO_ARCHIVE_INTERVAL_MS=120000  # 2 minutes

# Concurrent download limit
MAX_CONCURRENT_DOWNLOADS=3
```

## Monitoring & Observability

### Key Metrics
- **Processing success rate**: Percentage of successful downloads
- **Average processing time**: Time per track from start to completion
- **Queue depth**: Number of pending tracks
- **Worker uptime**: Percentage of time worker is running vs paused

### Logging Strategy
- **Structured logging**: JSON-formatted logs with context
- **Error tracking**: Detailed error information with stack traces
- **Performance metrics**: Download times and success rates
- **Admin action logging**: All control actions logged

### Health Checks
- **Worker status monitoring**: Real-time status checks
- **Queue health**: Track processing success rates
- **Resource usage**: Monitor memory and CPU usage
- **Database connectivity**: Verify database access

## Future Considerations

### Potential Enhancements
- **Multi-service support**: Extend to other audio sources beyond YouTube
- **Quality selection**: User-configurable audio quality settings
- **Batch processing**: Optimized bulk operations for large playlists
- **Advanced scheduling**: Time-based processing windows

### Scalability Improvements
- **Horizontal scaling**: Multiple worker instances with load balancing
- **Queue partitioning**: Separate queues for different priorities or services
- **Resource optimization**: Dynamic resource allocation based on load
- **Distributed processing**: Process tracks across multiple servers

## References
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [Epic Stack Documentation](https://epicweb.dev/epic-stack)
- [Prisma Documentation](https://www.prisma.io/docs/)

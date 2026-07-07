# ADR-011: Audio Archive Worker — Reintroduction

## Status

Accepted

**Supersedes:** [ADR-004: Remove Audio Download Functionality](./004-remove-audio-download-functionality.md)

## Context

ADR-004 (January 2025) documented the decision to remove all audio download functionality due to YouTube bot detection, maintenance burden, legal concerns, and feature complexity. Eighteen months later, the landscape has changed:

1. **yt-dlp maturity**: The tool has become significantly more robust, with improved anti-detection measures and active maintenance.
2. **Cookie-based auth**: YouTube cookies (Netscape format) provide a reliable authentication mechanism that avoids OAuth token fragility.
3. **Architectural lessons**: The previous implementation's complexity (WebSocket progress broadcasting, multi-file worker architecture) can be avoided with a simpler design.
4. **User demand**: Offline playback remains the most-requested feature.

This ADR documents the architecture of the reintroduced audio archiving system and the decisions that shaped it.

## Decision

We reintroduced audio archiving with a **simpler, more resilient architecture** based on seven design principles:

### 1. yt-dlp as Download Tool

**Chosen over**: `youtube-dl` (unmaintained), direct HTTP stream capture (YouTube's adaptive streaming is fragile), and browser-based download (complex, heavy).

yt-dlp is actively maintained, handles YouTube's anti-bot measures (sign-in walls, bot detection, rate limiting), and supports the full range of YouTube URL formats. It is installed as a self-contained binary in the Dockerfile (lines 14-16).

### 2. Cookie-Based YouTube Authentication

**Chosen over**: OAuth token passing (yt-dlp's `--cookies-from-browser` has intermittent breakage), headless browser extraction (too heavy for a background worker), and unauthenticated downloads (blocked for most content).

YouTube cookies (Netscape format) are uploaded by the admin via `/admin/youtube-cookies` and stored on the server filesystem at `COOKIE_FILE_PATH`. yt-dlp receives them via the `--cookies` flag.

**Cookie lifecycle**:
- Upload → stored as `YoutubeCookie` DB record with `valid: true`
- On AUTH/COOKIE_EXPIRED error → all cookies invalidated (`valid: false`), admin notified via Telegram
- Admin re-uploads fresh cookies → new `YoutubeCookie` record created

### 3. Worker State Machine (running/paused/long_break)

**Chosen over**: Simple on/off toggle (doesn't support scheduled breaks), external scheduler (adds operational complexity), and per-job pausing (state explosion).

The worker has three states stored in a singleton `WorkerState` database record:

```
             ┌─────────┐      pause()     ┌─────────┐
             │ RUNNING │ ────────────────>│ PAUSED  │
             └────┬────┘                  └────┬────┘
                  │        resume()            │
                  │<───────────────────────────│ resume()
                  │                            │
                  │  takeLongBreak(duration)    │
                  │ ─────────────────────────>┐│
                  │                           ▼▼
                  │                  ┌──────────────┐
                  │                  │ LONG_BREAK   │
                  │                  │ (auto-resume │
                  └──────────────────│  at expiry)  │
                     resume()        └──────────────┘
                    (or auto)
```

- **`running`**: Worker processes jobs normally
- **`paused`**: Worker stops picking up new jobs; running jobs complete
- **`long_break`**: Worker pauses for a configurable duration (default: 6 hours), then auto-resumes. Prevents rate-limit bans by spacing out download sessions.

State transitions are controlled via the admin dashboard at `/admin/audio-queue`.

### 4. Telegram Notification Design

**Chosen over**: Email (deliverability issues), Discord webhook (adds a dependency), in-app notifications (admin may not be logged in), and no notifications (silent failures are bad operations).

Notifications are sent via Telegram Bot API when:
- **Cookie expires**: `notifyCookieExpired()` — includes job ID, track URL, and error message. Message includes a reminder to upload fresh cookies.
- **Job fails permanently**: `notifyJobFailed()` — includes job ID, track URL, error category, and error message.

Both functions are fire-and-forget (`void`-prefixed). If Telegram is unreachable, the job processing continues unaffected.

Configuration: `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID` environment variables.

### 5. Tigris Storage Pipeline

**Chosen over**: Local filesystem (not durable across deploys on Fly.io), AWS S3 directly (separate billing, vendor lock-in), and database BLOBs (SQLite performance, size limits for audio files).

**Pipeline**: `yt-dlp download → local temp file → Tigris upload → TrackAudioFile DB record`

**Object key format**: `audio/{trackId}/{filename}` — predictable, no-hash, human-readable.

**Upload strategy**:
- Files ≤ 5MB: `PutObjectCommand` (single-part — Tigris multipart minimum is 5MB)
- Files > 5MB: AWS SDK `Upload` class with multipart (50MB parts, 4 concurrent)

Tigris is configured via standard S3 environment variables (`AWS_ENDPOINT_URL_S3`, `BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).

### 6. Error Categorization

**Chosen over**: Binary success/failure (no retry intelligence), exponential backoff without categorization (wastes retries on permanent failures), and per-job manual retry (doesn't scale).

yt-dlp stderr output is pattern-matched against six categories:

| Category | Trigger Patterns | Retriable? | Max Retries | Side Effect |
|----------|-----------------|-----------|-------------|-------------|
| `AUTH` | HTTP 403, "forbidden", "login required" | No | 0 | Invalidate all cookies, notify admin |
| `RATE_LIMITED` | HTTP 429, "too many requests", "rate limit" | Yes | 3 | None |
| `GEO_BLOCKED` | "not available in your country", "geo-restricted" | No | 0 | None |
| `VIDEO_UNAVAILABLE` | "video unavailable", "removed", "private" | No | 0 | None |
| `NETWORK` | "unable to connect", DNS failures, timeouts | Yes | 3 | None |
| `COOKIE_EXPIRED` | "sign in to confirm", "sign-in required", "cookie" | No | 0 | Invalidate all cookies, notify admin |
| `UNKNOWN` | No pattern match | Yes | 3 | None |

Non-retriable errors fail the job permanently on first occurrence. Retriable errors are re-queued (status reset to `pending`) up to `MAX_RETRIES` (3). After 3 retries, the job is marked `failed` regardless of category.

Error history is stored as a JSON array on the `ArchiveJob` record for debugging.

### 7. Auto-Enqueue Design

**Chosen over**: Manual enqueue (creates friction), separate scheduled discovery (complex, misses timing), and enqueue on playlist view (UI-triggered, unreliable).

`enqueueArchiveJob()` is called from the track batch processor during YouTube playlist import/sync. For every track with a `serviceUrl`, an `ArchiveJob` is created with `status: 'pending'` and `priority: false`.

**Idempotency**: `trackId` has a unique constraint on `ArchiveJob`. Duplicate creation attempts are silently caught — existing jobs (any status) are never disrupted by a re-sync.

**Guard**: `AUDIO_ARCHIVE_ENABLED` must be `'true'` for auto-enqueue to create jobs.

### 8. Retry Strategy Summary

| Scenario | Behavior |
|----------|----------|
| RATE_LIMITED / NETWORK / UNKNOWN | Re-queue (status → `pending`), increment `retryCount` |
| After 3 retries (any retriable category) | Mark `failed`, record error in `errorHistory` |
| AUTH / COOKIE_EXPIRED | Mark `failed` immediately, invalidate all cookies, notify admin |
| GEO_BLOCKED / VIDEO_UNAVAILABLE | Mark `failed` immediately |
| Cookie-related permanent failure | Fire-and-forget Telegram notification |

## Implementation Details

### File Structure

All audio archiving code lives in `app/features/audio-archive/`:

| File | Responsibility |
|------|---------------|
| `worker.server.ts` | Queue processing loop (`processQueueTick`) + job processing (`processJob`) |
| `worker-control.server.ts` | Worker state machine (pause/resume/break) |
| `yt-dlp.server.ts` | yt-dlp child process spawn + error categorization |
| `tigris-upload.server.ts` | S3/Tigris upload + presigned URLs |
| `auto-enqueue.server.ts` | Automatic ArchiveJob creation on import |
| `notification.server.ts` | Telegram Bot API notifications |
| `youtube-cookie.server.ts` | Cookie upload + validation |

Each file has a corresponding `.test.ts` file with full unit test coverage.

### Database Models

From `prisma/schema.prisma`:

**`ArchiveJob`** (lines 376-391):
```prisma
model ArchiveJob {
  id             String    @id @default(cuid())
  status         String    @default("pending") // pending, processing, completed, failed
  priority       Boolean   @default(false)
  retryCount     Int       @default(0)
  errorHistory   String    @default("[]") // JSON array
  lastAttemptAt  DateTime?
  trackId        String    @unique
  track          Track     @relation(fields: [trackId], references: [id], onDelete: Cascade)
}
```

**`WorkerState`** (lines 393-402):
```prisma
model WorkerState {
  id                 String    @id @default("singleton")
  status             String    @default("running") // running, paused, long_break
  currentlyProcessing String?
  lastQueueRun       DateTime?
  nextLongBreakAt    DateTime?
  lastStateChange    DateTime  @default(now())
}
```

**`YoutubeCookie`** (lines 404-410):
```prisma
model YoutubeCookie {
  id        String   @id @default(cuid())
  updatedAt DateTime @default(now())
  updatedBy String   // userId who uploaded the cookie
  valid     Boolean  @default(true)
}
```

**`TrackAudioFile`** (lines 342-374): Reintroduced model linking tracks to stored audio files in Tigris.

### Environment Variables

From `.env.example` (lines 41-51):

| Variable | Default | Description |
|----------|---------|-------------|
| `AUDIO_ARCHIVE_ENABLED` | `"false"` | Master switch for the archive worker |
| `AUDIO_ARCHIVE_MAX_CONCURRENT` | `"2"` | Max simultaneous yt-dlp processes |
| `AUDIO_ARCHIVE_INTERVAL_MS` | `"120000"` | Queue polling interval (2 minutes) |
| `TELEGRAM_BOT_TOKEN` | `""` | Telegram bot token for notifications |
| `TELEGRAM_ADMIN_CHAT_ID` | `""` | Telegram chat ID for admin alerts |
| `COOKIE_FILE_PATH` | `"/data/youtube-cookies.txt"` | Path to YouTube cookies file |

### Dockerfile Changes

The Dockerfile was updated to include:
- **ffmpeg** (line 11): Required by yt-dlp for audio format conversion
- **yt-dlp** (lines 14-16): Self-contained binary from GitHub releases at `/usr/local/bin/yt-dlp`

These were previously removed in ADR-004 and have been re-added.

## Alternatives Considered

### 1. Serverless Worker (separate process / queue)
**Pros**: Better isolation, scalable independently
**Cons**: Adds operational complexity (Redis/BullMQ), overkill for single-server deployment
**Decision**: In-process interval timer is sufficient for current scale

### 2. OAuth-Based Authentication (yt-dlp's built-in)
**Pros**: No cookie management needed
**Cons**: Intermittent breakage, yt-dlp's OAuth module is less reliable than cookie auth
**Decision**: Cookie-based auth is more stable

### 3. Direct HTTP Stream Capture (no yt-dlp)
**Pros**: No external dependency, faster
**Cons**: YouTube's adaptive streaming is fragile; signature deciphering changes frequently
**Decision**: yt-dlp abstracts these complexities

### 4. In-Memory Queue (no database)
**Pros**: Simpler, faster
**Cons**: Lost on restart, no visibility, no retry history
**Decision**: Database-backed queue provides durability and observability

### 5. WebSocket Progress Broadcasting
**Pros**: Real-time progress in UI (as in the removed implementation)
**Cons**: Architectural complexity, additional server resources
**Decision**: Not implemented in initial reintroduction — admin dashboard shows queue stats via polling; download progress can be added later

## Consequences

### Positive
- ✅ **Offline playback restored**: Tracks can be downloaded and played without internet
- ✅ **Simpler architecture**: 14 files in a single feature directory vs. the previous scattered implementation
- ✅ **Resilient error handling**: Category-aware retry prevents wasted attempts on permanent failures
- ✅ **Operational visibility**: Database-backed queue with admin dashboard; Telegram notifications for critical events
- ✅ **Cookie management**: Automatic invalidation on auth failures prevents silent queue stagnation
- ✅ **Rate-limit protection**: Long break mechanism spaces out download sessions
- ✅ **MOCKS support**: Full mock mode for CI and development (no real downloads)

### Negative
- ⚠️ **yt-dlp dependency**: External binary that requires periodic updates
- ⚠️ **Cookie maintenance**: Admin must upload fresh cookies periodically (YouTube sessions expire)
- ⚠️ **Storage costs**: Audio files consume Tigris storage (mitigated by MP3 compression)
- ⚠️ **YouTube ToS**: Downloading content may violate YouTube's Terms of Service (same risk as ADR-004)

### Neutral
- 🔄 **Supersedes ADR-004**: Audio download functionality has been fully reintroduced with a different architecture
- 🔄 **Re-added models**: `TrackAudioFile` and `ArchiveJob` models re-added to Prisma schema

## Migration from ADR-004

ADR-004 removed the following; ADR-011 reintroduces equivalents:

| ADR-004 Removed | ADR-011 Replacement |
|----------------|---------------------|
| `app/utils/youtube-downloader.server.ts` | `app/features/audio-archive/yt-dlp.server.ts` |
| `app/utils/audio-archive.ts` | `app/features/audio-archive/worker.server.ts` |
| `server/workers/audio-archive.ts` | In-process interval timer in `server/index.ts` |
| `server/workers/audio-worker-control.ts` | `app/features/audio-archive/worker-control.server.ts` |
| `TrackAudioFile` model (removed) | `TrackAudioFile` model (re-added, lines 342-374) |
| Download progress UI | Admin queue dashboard at `/admin/audio-queue` |
| `AUDIO_ARCHIVE_ENABLED` env (removed) | `AUDIO_ARCHIVE_ENABLED` env (re-added) |

## Testing

### Unit Tests
- `yt-dlp.server.test.ts`: Mock child process spawn, error categorization, progress parsing
- `worker.server.test.ts`: Queue processing logic, retry behavior, error history
- `worker-control.server.test.ts`: State transitions, pause/resume/break lifecycle
- `tigris-upload.server.test.ts`: Upload strategies, mock mode, presigned URLs
- `auto-enqueue.server.test.ts`: Idempotent enqueue, AUDIO_ARCHIVE_ENABLED guard
- `notification.server.test.ts`: Telegram message formatting, HTML escaping, missing config handling
- `youtube-cookie.server.test.ts`: Cookie upload, validation, invalidation

All tests run in MOCKS mode — no real yt-dlp, no real network calls, no real file I/O.

## Production Considerations

### Scalability
- The in-process worker is sufficient for single-server deployments
- For multi-server: add a distributed lock (e.g., PostgreSQL advisory lock) to prevent duplicate processing
- Current `maxConcurrent: 2` keeps CPU/memory usage predictable

### Monitoring
- Queue stats endpoint (`getQueueStats()`) exposes pending/processing/completed/failed counts
- Telegram notifications for cookie expiry and permanent failures
- Worker state transitions logged via `WorkerState.lastStateChange`

### Cookie Rotation
- YouTube cookies typically expire after ~30 days
- Admin receives Telegram notification on cookie failure
- Cookie re-upload at `/admin/youtube-cookies` creates a new valid record

## References

- [ADR-004: Remove Audio Download Functionality](./004-remove-audio-download-functionality.md) — Superseded by this ADR
- [ADR-010: Audio File Upload and Storage System](./010-audio-upload-storage-system.md) — Tigris storage patterns
- [CONTEXT.md](../CONTEXT.md) — Glossary and settled decisions
- [ARCHITECTURE.md](../ARCHITECTURE.md) — Overall architecture
- [mocking.md](../mocking.md) — Mock system documentation
- [yt-dlp Documentation](https://github.com/yt-dlp/yt-dlp)
- [Tigris Documentation](https://www.tigrisdata.com/docs/)
- [Telegram Bot API](https://core.telegram.org/bots/api)

## Revision History

- **2026-07-07**: Initial version — Documents reintroduction of audio archiving, superseding ADR-004

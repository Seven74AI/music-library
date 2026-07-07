# 📚 Music Library — Context & Glossary

Shared vocabulary and settled decisions for the Music Library project.
New contributors: read this before writing code.

## Glossary

### Audio Archiving

- **ArchiveJob** — A queue entry in the database representing a track awaiting audio download. States: `pending` (waiting), `processing` (being downloaded), `completed` (audio stored), `failed` (permanent error). Each job tracks its retry count and error history (JSON array).

- **WorkerState** — A singleton database record controlling the background worker lifecycle. States:
  - `running` — Worker picks up and processes jobs normally
  - `paused` — Worker stops picking up new jobs; running jobs finish
  - `long_break` — Worker pauses for a configurable duration (default 6h), then auto-resumes

- **WorkerStatus** — The current operational mode of the worker (`running`, `paused`, `long_break`). Managed by `worker-control.server.ts`.

- **YoutubeCookie** — A database record tracking uploaded YouTube cookie files. Stores validity flag, upload timestamp, and uploading user. When cookie-related errors are detected, all cookie records are invalidated and the admin is notified.

- **yt-dlp** — The CLI tool used to download YouTube audio. Spawned as a child process with `--extract-audio --audio-format mp3`. Supports cookie-based authentication for age-restricted or bot-protected content.

- **Tigris** — S3-compatible object storage (Fly.io). Audio files are uploaded after yt-dlp download. Object key format: `audio/{trackId}/{filename}`.

- **COOKIE_FILE_PATH** — Environment variable pointing to a YouTube cookies.txt file. Used by yt-dlp with the `--cookies` flag for authenticated downloads.

- **Telegram notification** — Admin alerts sent via Telegram Bot API when cookies expire or jobs fail permanently. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`.

- **Auto-enqueue** — Automatic creation of `ArchiveJob` records when YouTube tracks are imported or synced. Implemented in `auto-enqueue.server.ts`, called from the track batch processor. Skips if AUDIO_ARCHIVE_ENABLED is not `true`. Idempotent (silently skips if job already exists).

- **TrackAudioFile** — A Prisma model linking a track to its stored audio file in Tigris. Stores object key, format, MIME type, file size, bitrate, sample rate, and upload metadata.

### Error Categories

yt-dlp errors are classified into one of six categories for retry decision-making:

| Category | Description | Retriable? |
|----------|-------------|-----------|
| `AUTH` | HTTP 403, login required | No |
| `RATE_LIMITED` | HTTP 429, too many requests | Yes |
| `GEO_BLOCKED` | Video blocked in current country | No |
| `VIDEO_UNAVAILABLE` | Video removed, private, or unavailable | No |
| `NETWORK` | DNS failures, timeouts, connection refused | Yes |
| `COOKIE_EXPIRED` | Sign-in required, cookie rejected | No |
| `UNKNOWN` | Unclassified failure | Yes |

### YouTube Integration

- **ServicePlaylist** — A YouTube playlist synced to the user's library. Tracks are imported as `PlaylistTrack` records.

- **PlaylistTrack** — A track within a synced playlist, with `isDeleted` flag for tracks removed from YouTube.

- **Orphaned Track** — A `PlaylistTrack` where the YouTube video was deleted but could not be automatically matched to an existing track. Requires user confirmation.

### Generic

- **Epic Stack** — The full-stack framework this project is built on (React Router v7, Prisma, SQLite, Tailwind, Fly.io).

- **MOCKS** — Environment variable (`MOCKS=true`) enabling server-side mocking of all external services (YouTube API, yt-dlp, Tigris uploads, Telegram). Used in development and CI.

## Settled Decisions

These 16 decisions emerged from the audio archiving implementation and architecture review phases.

### Architecture

1. **Feature in `app/features/audio-archive/`** — Audio archiving is a self-contained feature module, not scattered across `app/utils/`. All 14 files (7 source + 7 test) live under one directory.

2. **yt-dlp as download tool** — Chosen over `youtube-dl` (unmaintained) and direct HTTP stream capture. yt-dlp is actively maintained, handles YouTube's anti-bot measures, and supports cookie-based authentication.

3. **Background worker via setInterval** — The archive worker runs as an interval timer in the server process (configured by `AUDIO_ARCHIVE_INTERVAL_MS`) rather than a separate worker process. Simpler deployment, same process boundary as the app.

4. **WorkerState as singleton DB record** — Worker lifecycle (running/paused/long_break) stored in a singleton `WorkerState` database record rather than in-memory or a separate control file. Survives server restarts and is inspectable via the admin UI.

5. **Error categorization before retry** — yt-dlp stderr is pattern-matched into error categories. Retry logic is category-aware: non-retriable errors (AUTH, GEO_BLOCKED, VIDEO_UNAVAILABLE, COOKIE_EXPIRED) fail permanently on first occurrence; retriable errors (RATE_LIMITED, NETWORK, UNKNOWN) retry up to 3 times.

### Authentication

6. **Cookie-based YouTube auth** — Cookies file (Netscape format) stored on the server filesystem and passed to yt-dlp via `--cookies`. Chosen over OAuth token passing (yt-dlp's built-in OAuth has intermittent breakage) and headless browser cookie extraction (too complex for a background worker).

7. **Cookie invalidation on AUTH/COOKIE_EXPIRED** — When yt-dlp returns an AUTH or COOKIE_EXPIRED error, all `YoutubeCookie` records are immediately invalidated. This prevents the worker from burning retries on expired cookies across all jobs.

### Storage

8. **Tigris Object Storage** — S3-compatible storage on Fly.io. Chosen over local filesystem (not durable across deploys), AWS S3 directly (vendor lock-in, separate billing), and database BLOBs (performance, size limits).

9. **Object key format: `audio/{trackId}/{filename}`** — Predictable, human-readable keys. No hashing — trackId is already unique.

10. **Multipart upload for files > 5MB** — Using `@aws-sdk/lib-storage` Upload class. Files ≤ 5MB use single-part PutObjectCommand (Tigris multipart minimum is 5MB per part).

### Notifications

11. **Telegram Bot API for admin alerts** — Chosen over email (RESEND has deliverability issues for system alerts), Discord webhook (adds a dependency), and in-app notifications (admin might not be logged in). Telegram is reliable, free, and the admin already uses it.

12. **Fire-and-forget notification pattern** — `notifyCookieExpired()` and `notifyJobFailed()` are called with `void` — they never block the worker loop. If Telegram is unreachable, the job still completes/fails correctly.

### Auto-Enqueue

13. **Enqueue on import/sync** — `ArchiveJob` records are created during YouTube track import and playlist sync, NOT on a separate schedule. This ensures tracks are archived as soon as they enter the library.

14. **Idempotent enqueue** — `enqueueArchiveJob()` catches unique constraint violations (`trackId` is unique on `ArchiveJob`) and silently skips. A re-sync won't create duplicate jobs or disrupt existing ones.

### Worker Behavior

15. **Priority-based queue ordering** — Jobs are picked in order: `priority DESC, createdAt ASC`. Priority-flagged jobs (e.g., user-requested) are processed before auto-enqueued ones.

16. **Long break auto-resume** — The `long_break` state auto-resumes after `nextLongBreakAt` is reached (default: 6 hours). No manual intervention needed. This prevents rate-limit bans by spacing out download sessions.

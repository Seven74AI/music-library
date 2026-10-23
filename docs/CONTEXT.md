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

- **Tigris** — S3-compatible object storage (Fly.io) for server-side audio and cover images. All **TrackAudioFile** object keys use `audio/tracks/{serviceName}/{trackId}.{ext}` (e.g. `audio/tracks/youtube/clxyz123.mp3`, `audio/tracks/local/clabc456.flac`). `serviceName` is the track's service (`youtube`, `local`, …). Covers use a separate `images/…` namespace.

- **TrackAudioFile** — Links a track to its stored audio file in Tigris. Stores the object key (`audio/tracks/{serviceName}/{trackId}.{ext}`), format, MIME type, file size, bitrate, sample rate, and upload metadata. A track may have multiple files (different formats); see **Preferred Audio Format**. Created by **Track Audio Persist** (archive worker or admin upload).

- **Track Audio Persist** — The act of storing audio bytes in Tigris and linking them to a track: upload to object storage, create a `TrackAudioFile` row, then best-effort metadata backfill from the file. Used by the archive worker (existing track) and admin upload (new track, usually inside a DB transaction).

- **Preferred Audio Format** — When a track has more than one `TrackAudioFile`, streaming, download, and offline caching pick the best available format in order: FLAC → WAV → MP3 → M4A → OGG → AAC → WebM → first available.

- **COOKIE_FILE_PATH** — Environment variable pointing to a YouTube cookies.txt file. Used by yt-dlp with the `--cookies` flag for authenticated downloads.

- **Telegram notification** — Admin alerts sent via Telegram Bot API when cookies expire or jobs fail permanently. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`.

- **Auto-enqueue** — Automatic creation of `ArchiveJob` records when YouTube tracks are imported or synced during playlist sync. Skips if `AUDIO_ARCHIVE_ENABLED` is not `true`. Idempotent (silently skips if a job already exists for the track).

### Error Categories

yt-dlp errors are classified into one of nine categories for retry decision-making:

| Category             | Description                                 | Retriable? |
| -------------------- | ------------------------------------------- | ---------- |
| `AUTH`               | HTTP 403, login required                    | No         |
| `RATE_LIMITED`       | HTTP 429, too many requests                 | Yes        |
| `GEO_BLOCKED`        | Video blocked in current country            | No         |
| `VIDEO_UNAVAILABLE`  | Video removed, private, or unavailable      | No         |
| `NETWORK`            | DNS failures, timeouts, connection refused  | Yes        |
| `COOKIE_EXPIRED`     | Sign-in required, cookie rejected           | No         |
| `FILE_NOT_FOUND`     | Download path missing or escapes output dir | No         |
| `FORMAT_UNAVAILABLE` | Requested format not available              | Yes        |
| `UNKNOWN`            | Unclassified failure                        | Yes        |

### YouTube Integration

- **ServicePlaylist** — A playlist imported from an external service (YouTube today). Owned by a user and kept in sync with the service's playlist state.

- **ServicePlaylistTrack** — A track's membership in a synced playlist, including position and deletion status (`isDeleted`, `deletedAt`) when the YouTube video becomes unavailable.

- **Playlist Sync** — Fetching playlist state from an external service and updating `ServicePlaylist` / `ServicePlaylistTrack` records (and global `Track` rows where needed). Sync populates the synced-playlist catalog; it does **not** add tracks to the user's personal library.

- **Orphaned Track** — A deleted YouTube video in a synced playlist that could not be automatically matched to an existing `Track`. Sync pauses on ambiguous cases until the user confirms.

- **Orphaned Track Confirmation** — A user-driven step separate from automatic playlist sync: the user chooses whether a deleted item matches an existing track, should become a new track, or should be skipped.

- **CoverImage** — A processed, deduplicated cover image stored in Tigris. Keyed by SHA-256 `contentHash` so identical thumbnails are stored once and shared across tracks/albums. Populated by a post-sync background step from YouTube thumbnails.

- **Service Connection** — OAuth link between a user and an external music service (YouTube today). Holds access and refresh tokens for API calls during playlist sync and browsing. Implemented in `app/features/service-connection/`. **`resolveServiceAccessToken(serviceName, userId)`** returns a valid access token or `null`; expired tokens are refreshed automatically when a refresh token is available. **`hasServiceConnection(serviceName, userId)`** is the boolean check for UI ("connected or not"). **`disconnectServiceConnection(serviceName, userId)`** removes the OAuth link.

### Personal Library

- **Personal Library** — The user's curated listening collection — what powers `/library`, onboarding, and "Play library". Distinct from synced ServicePlaylist catalogs.

- **UserTrack** — A user's membership in their personal library: an active link between a user and a `Track`. Adding or removing a `UserTrack` is always an explicit user action; playlist sync never creates one.

### Listening Insights

- **On-Repeat Snapshot** — A frozen, system-generated, read-only playlist of the user's top tracks by `play_completed` **UsageEvent** count over the **previous calendar month** (UTC, matching **DailyUsageStat** day boundaries). Generated on a fixed cadence: **1st of each month**. Capped at **30 tracks**, ranked by completed-play count (tie-break TBD at implementation). Each row shows that track's completed-listen count for that month. **Skip generation** when the month has zero `play_completed` events; if 1–29 tracks qualify, still create a short snapshot. Snapshots are dated (by the month they cover) and retained historically with **no retention prune in v1** — not a single replace-in-place playlist. Distinct from **UserPlaylist** (user-curated, editable).

- **Snapshot Shelf** — UI that shows the **latest 3** On-Repeat Snapshots, plus a control to open the full snapshot history page (all snapshots for the user).

- **Promote Snapshot** — From an On-Repeat Snapshot, the user can copy all of its tracks into a **new or existing UserPlaylist** in one action. The snapshot itself stays read-only; promotion is the only edit path.

- **Recently Played Strip** — Listening-hub row of the user's most recently finished tracks, ranked by latest `play_completed` **UsageEvent**. **Distinct tracks only** (collapse repeats — one row per `trackId`, ordered by most recent completion). Cap **20** tiles. Placed **above** the recent-playlists section on `/` (does not replace **recently added**). Distinct from `/history`, which remains a per-play chronological list (ADR-017).

- **Heavy Rotation** — Live ranking of distinct tracks by `play_completed` count. Two windows: **this month** (current UTC calendar month) and **ever** (lifetime). Complements frozen **On-Repeat Snapshot**s (previous month). Surfaces: (1) **two** listening-hub strips — one per window — each capped at **50** and hidden when empty; (2) two mutually exclusive **Personal Library** (`/library`) sort options (“Most played · this month” / “Most played · ever”) that reorder the full library list by the chosen signal with **no 50 cap** (the sorted list is the whole library, searchable/pageable as today). Not dated snapshots — recomputed on read.

- **Weekly Wrap** — Quiet listening-hub summary for the **current UTC calendar week (Monday–Sunday)**. Shows `play_completed` **finishes** count and **unique tracks** count; if the user has a **day streak** > 1 (consecutive UTC days with ≥1 `play_completed` ending today), also show that streak. Home only; **hide when empty** (zero finishes in the week). Not a playlist or strip of tracks — stats copy only. Distinct from admin **DailyUsageStat** charts.

- **Personal Play Boost** — Soft re-ranking of **global FTS** search results using the **current user's lifetime** `play_completed` counts. Affects only that user (not global popularity). Relevance still wins; plays nudge familiar tracks upward among already-matching hits. Does **not** change ServicePlaylist browse or replace **Heavy Rotation** library sorts in v1.

Implementation tickets: [On-Repeat Snapshots #198](https://github.com/mnlamart/music-library/issues/198) · [Recently Played Strip #199](https://github.com/mnlamart/music-library/issues/199) · [Heavy Rotation #200](https://github.com/mnlamart/music-library/issues/200) · [Weekly Wrap #201](https://github.com/mnlamart/music-library/issues/201) · [Personal Play Boost #202](https://github.com/mnlamart/music-library/issues/202).

### Audio Player & Queue

- **Queue Spine** — Ordered playable tracks for the active play context (library or playlist). Loaded in one request as lightweight `QueueTrack` rows (`id`, `title`, and an `artist` object `{ id, name }`). The spine is the automatic continuation after **Up Next** is drained; shuffle permutes spine play order client-side.

- **Up Next** — Manual injection zone between now playing and the spine. User-added tracks via **Play next** or **Add to up next** live here in memory only (not persisted across sessions). **Play next** inserts at the front (FIFO among play-next items); **Add to up next** appends to the tail.

- **Hydration** — Lazy fetch of the full playback payload (`FullTrack`: audioFiles, cover, duration) for tracks about to play. The provider hydrates the current track plus a small lookahead (four upcoming tracks) via `GET /api/tracks/playback`. Until hydrated, the UI uses minimal spine stubs.

- **QueueNavigationState** — The in-memory state machine that drives queue positioning and next-track resolution. Contains five fields: `upNext` (the manual injection queue, held in memory only), `spine` (the full ordered list of `QueueTrack` rows for the active play context), `spineOrder` (a permutation of spine indices defining linear or shuffle play order), `spinePosition` (the current position within `spineOrder` — not the raw spine index), and `loopMode` (the current repeat mode). Created on play from a spine fetch and updated immutably by navigation functions — never mutated in place. See `app/features/queue/queue-navigation.ts`.

- **QueueZone** — One of the two zones in the queue architecture: `'upNext'` or `'spine'`. The upNext zone is the manual injection area between the now-playing track and the spine; the spine zone is the automatic continuation (library or playlist). Navigation always drains upNext before advancing the spine pointer.

- **QueueTarget** — A `{ zone, index }` pair that unambiguously identifies a specific track position in the queue. `zone` is a `QueueZone`; `index` is the position within that zone. For upNext targets, `index` is the array index into `upNext`. For spine targets, `index` is the position in `spineOrder` (not the raw spine index) — use `getTrackAtTarget()` to resolve a target to the actual `QueueTrack`.

- **LoopMode** — Controls playback repetition when the spine pointer reaches either end: `'off'` (playback stops when no next/previous track exists), `'all'` (wraps the spine — next from end goes to start, previous from start goes to end), `'one'` (repeats the current track indefinitely — both `resolveNextTrack` and `resolvePreviousTrack` return the current spine position). Up Next is never affected by loop mode; it drains independently.

### Party Room

- **Party Room** — Server-hosted in-person party session: shared live queue, roles, optional guests, one speaker device. Distinct from the personal **Queue Spine** / **Up Next** player. See [ADR-030](./decisions/030-party-room.md).

- **RoomParticipant** — A person’s seat in one **Party Room**: linked `userId` **or** guest (display name + opaque token), plus role (**Host** / **DJ** / **Listener**). Prefer this term over “membership.”

- **Host / DJ / Listener** — Room roles on a **RoomParticipant**. **Host:** transport, manage room, speaker (v1), add/edit queue. **DJ:** add and edit others’ upcoming rows (no transport / manage). **Listener:** watch (+ **remove-own**); cannot add unless promoted or **defaultJoinRole** is DJ. Host configures **`defaultJoinRole`** (`listener` | `dj`) for new joiners.

- **Room Queue** — Flat ordered list of track ids for a **Party Room** (cap 500), plus **`currentIndex`**. Not a **Queue Spine**. Starts empty; Host may bulk **Add playlist to queue**. Rows before the pointer are history (read-only); upcoming rows are editable by Host/DJ. Each row records **`addedByParticipantId`** (**remove-own** works for every role).

- **Room Speaker** — The single device that outputs audio for the room (v1: current Host’s device). Personal **PlayerState** is suspended on that device while the room is live.

- **Room Code** — Six-character join code (`ABCDEFGHJKLMNPQRSTUVWXYZ123456789`). The only identity of a **Party Room** (no display name). Same value appears in the join URL. Host UI shows code, copy-link, and a QR encoding the **full URL**. **Smart join:** logged-in users become linked participants; logged-out users enter the **Guest Shell**.

- **Away** — A **RoomParticipant** seat that is still in the room (`leftAt` null) but whose page is gone. The speaker is not Away while that device is playing, nor for ~30s after the sound stops. An open page is not Away, even while paused. See [ADR-030](./decisions/030-party-room.md).

- **Guest Shell** — Minified app for anonymous participants: Room tab + Search tab (artists / albums / tracks with audio only, full archived catalog).

- **Audition** — Participant-gated, short-lived audio URL so a guest (or participant) can play **one track at a time** on their device to verify it — not the room speaker. Rate-limited (~20 grants/participant/min).

- **Room Play Event** — Room-scoped play start/complete for the speaker’s playback. Does **not** write personal `play_started` / `play_completed` **UsageEvent**s and does not feed personal listening insights.

### Curator System

- **Curator** — Trusted user role with permissions to edit track/artist/album metadata, merge duplicates, and manage data quality. Assigned by admins only. See ADR-031.

- **Edit Lock** — Optimistic lock acquired when curator opens edit dialog, preventing concurrent edits. Released on save/close or after 30-minute timeout. Other curators see read-only view until released. Force-unlock available with required reason. See ADR-032.

- **BroadcastChannel Sync** — Real-time synchronization of curator state across browser tabs using BroadcastChannel API. Syncs lock releases, edits, selection state, queue updates. Same-browser only (not cross-device). See ADR-033.

- **Review Queue** — Centralized queue aggregating data quality issues from four sources: user reports, system-detected issues, curator flags, and import errors. Organized in tabs (User Reports, Duplicates, Data Quality, Import Errors). Curators can claim items, resolve with fixes, or dismiss as invalid. See ADR-035.

- **Duplicate Detection** — Automated detection of duplicate artists/albums using Levenshtein distance on normalized names. Runs daily as background job, caches results. Presents exact matches and fuzzy matches separately. Curators review and merge duplicates. See ADR-034.

- **Selection Mode** — Toggleable mode (curator tools menu) that shows checkboxes on track rows in library. Enables multi-track selection for bulk operations. Selection state persists in localStorage and syncs via BroadcastChannel. Curators can disable to use library like regular users.

- **Bulk Edit** — Curator operation to update metadata fields on 2+ selected tracks simultaneously. Soft limit of 100 tracks with override option. Shows live progress log, handles partial failures (keep/rollback/retry), supports cancellation with rollback. Requires comment for audit trail.

- **Merge Operation** — Combining duplicate artists or albums into a single entity. Shows metadata comparison, track list (flat or grouped by album), and smart recommendations. All source entity tracks relinked to target. Source entities soft-deleted with merged marker. Creates audit trail entry.

- **Artist Split** — Separating one artist into two distinct artists (e.g., different artists with same name). Curator manually selects tracks to move, system provides smart suggestions based on patterns. Prompts for new artist names. Creates audit trail entry.

- **Curator Notes** — Threaded comments on tracks/artists/albums visible only to curators and admins. Categorized (Question, Warning, Info, Resolved). Supports @ mentions (notifies mentioned curator). Badge indicator on entity rows shows note count.

- **Audit Trail** — Complete history of all curator actions. Per-entity: edit history tab in details dialogs. System-wide: audit log page with filtering by curator, date range, action type, entity name. All entries include curator name, timestamp, changes, and optional comment.

- **Undo System** — Quick undo (5 minutes, own edits, no comment) via toast notification. Delayed undo/restore (anytime, any curator's edits, comment required) via History tab. Both create audit trail entries. Version-based restore to any point in history.

- **Session Recovery** — Automatic save of curator workflow state (selection, open dialogs with unsaved changes, filters, scroll position) to localStorage. On page load, prompt offers to restore or discard. Expires after 24 hours (selection) or 2 hours (unsaved changes). See ADR-036.

- **Curator Dashboard** — Central hub for curator work. Tabs: Overview (metrics, queue summary, leaderboard, activity feed), Queue (embedded review queue), Reports (data quality reports), Activity (filterable curator actions). Metrics show library completeness percentage, per-field breakdown, trend graphs. Leaderboard ranks curators by edits/merges/quality contributions with time filters.

- **Genre Management** — Multi-genre tagging system (ADR-037). Tracks can have unlimited genres (flat list, no hierarchy). Curators build genre list from scratch. Genre management page supports create, rename, delete, merge, view tracks per genre. Genre select component: multi-select dropdown + tag input, displays as removable pills.

- **Metadata Clipboard** — Three copy/paste modes: (1) Field-level copy icon per field, (2) Selective bulk template (checkbox which fields to copy), (3) Apply from similar track (search, side-by-side comparison, pick fields). Works across windows/tabs.

- **Curator Tools Menu** — Global dropdown (pencil icon in header) providing access to all curator features: Selection Mode toggle, Curator Dashboard, Duplicates, Genre Management, Review Queue, My Stats, Clear Session.

- **Data Quality Dashboard** — Section of curator dashboard showing metadata completeness (overall % + per-field breakdown + trends), problem tracks summary (counts by issue type, clickable to filter library), curator leaderboard, and live activity feed.

- **Duplicate Detection Algorithm** — Levenshtein distance on normalized names (lowercase, trim, remove punctuation, remove "the" prefix). Artists: distance ≤ 2 for names < 10 chars, ≤ 3 for ≥ 10 chars. Albums: same artist + similar name, OR similar artist + similar name + year within ±2. Blocking strategy (group by first 2 chars) reduces comparisons by ~95%.

- **Curator Badge** — Achievement earned for milestones (100 edits, 50 merges, 100 quality fixes, 7-day streak). Progressive levels (1-10). Displayed on profile, leaderboard, and in edit history next to curator name.

### Generic

- **Epic Stack** — The full-stack framework this project is built on (React Router v7, Prisma, SQLite, Tailwind, Fly.io).

- **MOCKS** — Environment variable (`MOCKS=true`) enabling server-side mocking of all external services (YouTube API, yt-dlp, Tigris uploads, Telegram). Used in development and CI.

- **UsageEvent** — Append-only product analytics row (`signup`, `login`, `library_add`, `play_started`, `play_completed`). Written via `recordUsageEvent`; powers the admin user activity feed, `/history`, **On-Repeat Snapshot** / **Heavy Rotation** / **Weekly Wrap** / **Recently Played Strip** ranking, and **Personal Play Boost** (`play_completed` where noted). **Party Room** speaker plays use **Room Play Event**s instead — they must not inflate these personal signals. `play_completed` is emitted by the audio player once a track reaches **50%** playback progress (not only on natural end), so a track skipped past halfway still counts as a "finish" for these insights.

- **DailyUsageStat** — Per-UTC-day counter for admin time-series charts (`signups`, `logins`, `library_adds`, `plays_*`, `dau`). Incremented when usage events are recorded.

- **DailyActiveUser** — Dedupes DAU: at most one row per `(UTC day, userId)` so the `dau` metric increments once per user per day.

- **disabledAt** — Optional timestamp on `User`. When set, the account cannot create sessions and existing sessions are rejected in `getUserId`.

### PWA

- **Installed App** — Music Library added to the device home screen and opened in a standalone window (no browser chrome). Driven by the web app manifest and a registered service worker.

- **Archived Audio** — Audio stored server-side in Tigris after the archive worker downloads it (`TrackAudioFile`). Playable over the network via presigned URLs — **not** the same as device-local storage.

- **Cached Playback** — Audio files on the device (OPFS) plus track/playlist metadata (IndexedDB) so tracks play with no network. Shipped in the PWA Phase 2 rollout.

- **Offline Metadata Store** — IndexedDB records for downloaded tracks and playlists: title, artist, cover thumbnail (dedicated `covers` store), pinned vs queue-cached flag, playlist membership, and a pointer to the OPFS audio file path. Queried by Downloads, offline library, and offline playlist views.

- **Offline Audio Store** — OPFS files holding audio bytes, one file per track (`audio/{trackId}.mp3` or format-appropriate extension). Written via a dedicated Web Worker using `createSyncAccessHandle()` for iOS Safari compatibility.

- **Pinned Download** — A track or playlist the user explicitly downloaded. Persisted in device storage until the user removes it; never LRU-evicted automatically. **Offline `/library` shows pinned tracks only** — queue-cached tracks appear on `/downloads` but not in the offline library view.

- **Queue Cache** — Tracks auto-cached from the active queue for listening continuity. Stored in the same device storage as pinned downloads but eligible for LRU eviction when storage is tight. A track that is both pinned and queue-cached counts as pinned.

- **Queue Cache Preference** — Per-user, device-local setting (`localStorage`) for whether Queue Cache auto-writes run while listening. Default is on. Opting out stops new auto-cache writes only; it does not purge existing queue-cached tracks. Managed on `/downloads`.

- **Offline Shell** — Cached HTML, JS, CSS, and static assets so the app loads and navigates without network. Service-worker precache plus a supplemental root shell cache (user, theme, ENV) for warm navigations when loader fetches fail.

- **Offline Live Route** — A route that serves real Cached Playback data from device storage when offline (library, playlists, downloads, home).

- **Offline Stub Route** — A route that loads offline with placeholder data or a blocker UI instead of network-backed content (YouTube sync, search, admin).

## Settled Decisions

These decisions emerged from the audio archiving implementation, architecture review, and subsequent feature work.

### Architecture

1. **Feature in `app/features/audio-archive/`** — Audio archiving is a self-contained feature module, not scattered across `app/utils/`. All 18 files (9 source + 9 test) live under one directory.

2. **yt-dlp as download tool** — Chosen over `youtube-dl` (unmaintained) and direct HTTP stream capture. yt-dlp is actively maintained, handles YouTube's anti-bot measures, and supports cookie-based authentication. Defense strategy: cookies (auth) + sleep intervals / long breaks (rate limit). User-agent rotation dropped as redundant.

3. **Background worker via setInterval** — The archive worker runs as an interval timer in the server process (configured by `AUDIO_ARCHIVE_INTERVAL_MS`, default 2 min) rather than a separate worker process. Simpler deployment, same process boundary as the app. Max 2 concurrent downloads.

4. **WorkerState as singleton DB record** — Worker lifecycle (running/paused/long_break) stored in a singleton `WorkerState` database record rather than in-memory or a separate control file. Survives server restarts and is inspectable via the admin UI. Long breaks: 1-2h every 6-8h, polling-based (30s DB checks, admin-interruptible).

5. **Error categorization before retry** — yt-dlp stderr is pattern-matched into error categories. Retry logic is category-aware: non-retriable errors (AUTH, GEO_BLOCKED, VIDEO_UNAVAILABLE, COOKIE_EXPIRED, FILE_NOT_FOUND) fail permanently on first occurrence; retriable errors (RATE_LIMITED, NETWORK, FORMAT_UNAVAILABLE, UNKNOWN) retry up to 3 times. Exponential backoff: 1st retry 5min, 2nd 30min, 3rd 2h.

6. **Dockerfile** — Add `pip install yt-dlp` and `apt-get install -y ffmpeg` to the base Docker image.

### Authentication

7. **Cookie-based YouTube auth** — Cookies file (Netscape format) stored on the server filesystem at `/data/youtube-cookies.txt` and passed to yt-dlp via `--cookies`. Chosen over OAuth token passing (yt-dlp's built-in OAuth has intermittent breakage) and headless browser cookie extraction (too complex for a background worker). DB for audit metadata (uploadedBy, updatedAt, valid flag).

8. **Cookie invalidation on AUTH/COOKIE_EXPIRED** — When yt-dlp returns an AUTH or COOKIE_EXPIRED error, all `YoutubeCookie` records are immediately invalidated. This prevents the worker from burning retries on expired cookies across all jobs.

9. **Cookie upload UI** — Both file upload (drag-drop `cookies.txt`) and textarea paste on the admin panel. Both write to `/data/youtube-cookies.txt` and update the `YoutubeCookie` audit record.

10. **Cookie upload does not auto-reset jobs** — Uploading new cookies writes the cookie file, updates the `YoutubeCookie` audit records, and resets the cookie failure streak (`resetCookieFailureStreak`), but does NOT touch `ArchiveJob`s. Failed jobs whose latest error is recoverable (COOKIE_EXPIRED or FORMAT_UNAVAILABLE) are re-queued only via the admin queue's explicit "Retry cookie & format failures" action (`audio-queue.tsx`), which sets them back to `pending` with `priority: true`. Jobs with non-recoverable errors are left alone.

### Storage

11. **Tigris Object Storage** — S3-compatible storage on Fly.io. Chosen over local filesystem (not durable across deploys), AWS S3 directly (vendor lock-in, separate billing), and database BLOBs (performance, size limits).

12. **Unified audio object key format** — All server-side audio in Tigris: `audio/tracks/{serviceName}/{trackId}.{ext}`. Applies to archived (YouTube worker) and uploaded (admin/local) audio alike. Legacy keys (`audio/{trackId}/{filename}` and older upload paths) were migrated once via copy-and-update; new code never writes them. Device-side OPFS paths (`audio/{trackId}.{ext}`) are a separate namespace — not Tigris keys.

13. **Multipart upload for files > 5MB** — Using `@aws-sdk/lib-storage` Upload class. Files ≤ 5MB use single-part PutObjectCommand (Tigris multipart minimum is 5MB per part).

14. **No `uploadAudioFile` wrapper** — Call `uploadFile` directly with `contentType: 'audio/mpeg'`. The wrapper adds no value — call site already has context, and generic `uploadFile` already accepts `contentType` and `metadata` cleanly.

14b. **SQLite off-volume backups** — Automated `litefs export` on the LiteFS primary to a **separate** Tigris bucket (`BACKUP_BUCKET_NAME`), daily + weekly retention (~30 days), Telegram after exhausted retries, admin status + Backup now at `/admin/db-backup`. Restore is ops-only via `litefs import`. Cookies and `cache.db` are not included. See [ADR-029](./decisions/029-sqlite-off-volume-backups.md).

### Notifications

15. **Telegram Bot API for admin alerts** — Chosen over email (RESEND has deliverability issues for system alerts), Discord webhook (adds a dependency), and in-app notifications (admin might not be logged in). Telegram is reliable, free, and the admin already uses it. Direct `fetch()` to `https://api.telegram.org/bot{TOKEN}/sendMessage` from the worker. Two env vars: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ADMIN_CHAT_ID`.

16. **Fire-and-forget notification pattern** — `notifyCookieExpired()` and `notifyJobFailed()` are called with `void` — they never block the worker loop. If Telegram is unreachable, the job still completes/fails correctly.

### Auto-Enqueue

17. **Enqueue on import/sync** — `ArchiveJob` records are created during YouTube track import and playlist sync, NOT on a separate schedule. This ensures tracks are archived as soon as they enter the library. Gated behind `AUDIO_ARCHIVE_ENABLED=true`.

18. **Idempotent enqueue** — `enqueueArchiveJob()` catches unique constraint violations (`trackId` is unique on `ArchiveJob`) and silently skips. A re-sync won't create duplicate jobs or disrupt existing ones.

### Worker Behavior

19. **Priority-based queue ordering** — Jobs are picked in order: `priority DESC, createdAt ASC`. Priority-flagged jobs (e.g., admin-triggered) are processed before auto-enqueued ones. Admin-only manual priority — no auto-prioritization for new imports.

20. **Long break auto-resume** — The `long_break` state auto-resumes after `nextLongBreakAt` is reached (default: 6 hours). No manual intervention needed. This prevents rate-limit bans by spacing out download sessions.

21. **Worker lifecycle exports** — `startWorker()` and `stopWorker()` exported from the feature directory. `server/index.ts` imports and calls them on startup/graceful shutdown. Feature directory stays self-contained.

### Audio Serving

22. **No redirect — direct presigned URL** — The audio resource route returns the presigned Tigris URL directly (no 302 redirect). Client fetches it and sets `<audio src>` to the S3 URL. Presigned URL exposes only the access key ID + signature — can only GET that single MP3 until expiry. CORS config on Tigris bucket enables Range-seeking directly against the CDN. S3 client uses **virtual-hosted-style** URLs (`https://{bucket}.fly.storage.tigris.dev/{key}`) — required for buckets created after 2025-02-19 and matches the `*.fly.storage.tigris.dev` TLS cert. CSP `media-src` must include `https://*.fly.storage.tigris.dev`.

### Display & Navigation

23. **Null durations display as `--:--`** — Tracks without duration data (synced tracks that the archive worker hasn't downloaded yet) show `--:--` rather than `0:00`. `formatDuration()` handles null natively; callers must not coerce null to 0 with `|| 0`.

24. **Library add/remove on service playlist pages only** — The `itemActions` render prop (per-track add/remove library buttons) and "Add All Missing" bulk button belong on the YouTube playlist sync page (`playlist.$id.tsx`), NOT on user-created playlist pages (`playlists.$playlistId.tsx`). User playlist pages are for playlist management only (reorder, remove from playlist, add to queue). Per-track toggles POST to `/resources/track-library` with `trackId` + `action`. **Add All Missing** sends **one** request with repeated `trackIds` fields (not one request per track) so large playlists don't hit rate limits.

25. **Library track row → user playlist (Spotify-like)** — When `TrackListItem` receives a `playlists` prop (including an empty `[]`), show **Add to Playlist** on library and user-playlist pages. `AddToPlaylistMenu` lists existing playlists (searchable) and offers **+ New playlist** inline (name-only field, no page navigation). Inline create POSTs to `/resources/create-playlist-with-track`; adding to an existing playlist POSTs to `/resources/add-track-to-playlist` (duplicate track detection with confirm: **Add Duplicate** or **Remove from Playlist** via `/resources/remove-track-from-playlist`). The duplicate confirm dialog is hosted by `DuplicatePlaylistDialogProvider` in `root.tsx` so it survives desktop dropdown unmount when focus moves to the dialog. Shared helpers live in `app/utils/user-playlist.server.ts` (`createUserPlaylistWithTrack`, `createUserPlaylist`, `userPlaylistTitleTaken`, `removeTrackFromUserPlaylist`). **Per-user playlist titles are unique case-insensitively** — enforced on inline create, `/playlists/new`, and playlist rename. Standalone `/playlists/new` still redirects to `/playlists/{id}`. Do not gate the menu on `playlists.length > 0`.

26. **Admin links in UserDropdown** — Admin-only pages (audio queue, YouTube cookies) are linked from the user dropdown menu, gated by `userHasRole(user, 'admin')`. No separate admin sidebar or nav — the dropdown pattern scales until admin pages outgrow it.

### Home Page (`/`)

Home page redesign decisions (implemented). Route: `app/routes/_marketing+/index.tsx`.

27. **Auth-aware home** — `/` shows different content by auth state. Logged-out users see a marketing landing; logged-in users see the app home (not the Epic Stack placeholder). Logo in `root.tsx` continues to link to `/`.

28. **State-aware hybrid (logged-in)** — Logged-in `/` has two modes: **onboarding** (guide the user to add music) and **listening hub** (feed the audio player). Mode is chosen server-side in the route loader from library/connection data.

29. **Onboarding → listening hub threshold: any library track** — Switch to listening hub when the user has ≥1 active `UserTrack` (`isActive: true`, `deletedAt: null`). Do not wait for archived/playable audio.

30. **Gray zone: archiving banner** — When the user is in listening-hub mode but has **zero playable tracks** (no `TrackAudioFile`), keep the listening-hub layout and show a prominent top banner (e.g. "12 tracks · 3 ready · 9 archiving") with a link to `/library`. Disable play actions on tracks without audio; do not revert to full onboarding.

31. **Empty-state onboarding is context-aware** — When the user has **zero** library tracks, primary CTA depends on YouTube connection state: not connected → **Connect YouTube** (`/music/services/youtube/auth`); connected but no tracks → **Sync a playlist** (`/music/services/youtube/playlists` or synced-playlists flow). **Upload** (`/music/services/local/upload`) and **search** (global search bar) are always available as secondary paths below the primary CTA.

32. **Logged-out landing is a minimal gate** — No feature pitch or screenshot sections. Show logo/product name, a one-liner (e.g. "Your personal music library"), and **Log in** / **Sign up** CTAs in the page body. The global header does not show a login button when logged out (auth entry is via `/` or auth routes). Footer links to About · Privacy · Terms as today. Replace Epic Stack boilerplate entirely.

33. **Listening hub layout: no "Play library" hero** — In listening-hub mode the home page has **no** "Play library" CTA (the earlier hero design was dropped; `ListeningHome` renders the install prompt → archiving banner → Weekly Wrap → Explore Music card → recently added row → listening strips → playlists → overview stats). A **recently added** row of latest `UserTrack`s with per-track play remains below the fold. v1 does **not** add play-history or "continue listening" — defer `localStorage`/DB resume to a follow-up.

34. **Remove Music Hub; no `/music` redirect** — Delete `music.index.tsx` (dashboard). Home is only `/`. Update internal links that pointed to `/music` (UserDropdown, `/music/services` back link) to `/`. Remove "Music Hub" from nav. **`/music/services/*` routes and `music.tsx` layout stay.** Bare `/music` may 404 — no redirect stub for bookmarks.

35. **Single route, split components** — One route at `/` (`_marketing+/index.tsx` or equivalent). Loader branches on auth + library state and returns a `mode`: `marketing` | `onboarding` | `listening` | `gray` plus mode-specific data. UI lives in `app/components/home/` (`MarketingHome`, `OnboardingHome`, `ListeningHome` with gray-zone banner). No `/home` route, no loader redirect to a second URL.

### Track Metadata

36. **Archive worker is the source of truth for track metadata** — When the worker downloads a track's audio, it extracts metadata from the file itself (`music-metadata`): duration, title, artist, album, genre, BPM, ISRC, label, track number, release date, lyrics, etc. Playlist sync does NOT hydrate metadata via `videos.list` — sync only creates tracks with the fields available in `playlistItems` responses, and duration stays `null` until the track is archived. One API call per track was rejected as wasteful; `--:--` in the meantime is acceptable. See [ADR-012](./decisions/012-track-metadata-from-audio-file.md).

37. **Metadata backfill is best-effort** — `updateTrackMetadataFromAudioFile` is wrapped in try/catch inside the worker. By the time it runs, the audio is uploaded and `TrackAudioFile` exists — failing the job would trigger a retry that re-downloads and creates a duplicate `TrackAudioFile`. A failed metadata update is logged and the job still completes.

38. **YouTube API field semantics** — Fields that look interchangeable are not:
    - `contentDetails.videoPublishedAt` = video publication date → use as `releaseDate`. `snippet.publishedAt` on a playlistItem = when the item was ADDED TO THE PLAYLIST — never use it as a release date.
    - `snippet.videoOwnerChannelTitle` = channel that uploaded the video → use as artist name. `snippet.channelTitle` on a playlistItem = the PLAYLIST owner's channel — never use it as the artist. Fallback is `'Unknown Artist'`.

### Images & Covers

39. **Cover thumbnail selection: maxres > medium > default** — `pickCoverThumbnailUrl()` (in `transformations.ts`) picks the cover source from YouTube thumbnails. `maxres` (1280x720) and `medium` (320x180) are true 16:9 renditions; `high` (480x360) and `standard` (640x480) are 4:3 with black letterbox bars and are deliberately skipped — cropping them to a square cover would include the bars. `maxres` only exists for some videos. Playlist thumbnails (display-only, hotlinked from `i.ytimg.com`) stay on `medium`.

40. **Covers are downloaded post-sync, deduplicated, and proxied** — After a playlist sync responds, a background job downloads each track's thumbnail, dedupes by SHA-256 content hash (`CoverImage.contentHash`), re-encodes via sharp (max 1000x1000 JPEG q85), and uploads to Tigris (`images/tracks/{trackId}/cover/…`). Covers are served through the `/resources/images` openimg proxy — its `allowlistedOrigins` must include BOTH storage origins (`getStorageOrigins()`: the raw endpoint and the virtual-hosted `{bucket}.` origin), because openimg matches presigned-URL origins exactly. Until a cover is processed, the UI hotlinks the YouTube thumbnail (CSP `img-src` allows `https://i.ytimg.com` and `https://img.youtube.com`). **Large playlists:** cover processing paginates by `playlistId` (cursor, 100 rows/page) — do not pass 1000+ IDs in a single Prisma `IN` clause; SQLite limits bind parameters to 999. Use `chunkArray()` from `app/utils/chunk-array.ts` (500 IDs/chunk) for any remaining bulk `IN` queries; prefer relational filters (`some: { playlistId }`) when possible.

41. **CSP is set in ONE place — `createCSP()` in `app/entry.server.tsx`** — Every HTML document gets a nonce-based enforcing policy from `createCSP()` (`app/utils/csp.server.ts`), the sole CSP source of truth. It emits `Content-Security-Policy-Report-Only` when `MOCKS=true` (dev/test) and enforced `Content-Security-Policy` in production, satisfying "report-only in dev, enforced in prod". Helmet CSP in `server/index.ts` is **deliberately disabled** (`contentSecurityPolicy: false`) — a per-request nonce is only known at document render time, so a second middleware-level policy would duplicate the nonce and every host allowlist (a drift hazard) with no defense-in-depth gain. **`script-src` is `'nonce-…' 'strict-dynamic'`** (no `'self'`): the nonce is the sole script gate and `'strict-dynamic'` transitively trusts nonced scripts while ignoring host allowlists. Same-origin workers (`/sw.js` service worker, OPFS dedicated worker) load via `Worker`/`serviceWorker.register` rather than nonced tags, so they are granted by `worker-src 'self'`. **When adding a host** (e.g. a new image CDN), update `createCSP()` only. Processed covers use `'self'` (`/resources/images`); hotlinked YouTube art needs `img-src`; presigned audio needs `media-src` for `https://*.fly.storage.tigris.dev`.

42. **Display sizes are proxied, not stored** — Only one cover file exists per unique image (see #40). UI components request on-the-fly square resizes via `/resources/images?w=&h=&fit=cover&format=webp`, built by `coverImageUrl()` in `app/utils/cover-image-url.ts`. `TrackThumbnail` and `PlaylistCover` use default pixel maps at **2× CSS size** for retina (`trackThumbnailPixelSizes`, `playlistCoverPixelSizes`). When a component displays larger than its `size` variant (e.g. a full-width card), pass `pixelSize` on `TrackThumbnail` or extend the shared maps — do not reuse a small `size` with a large `className` without bumping the requested pixels.

### PWA

43. **PWA rollout order: Installed App → Offline Playback** — Phase 1 (installable standalone app: manifest + service worker + install prompts) and Phase 2 (cached audio on device + full offline app shell) are **shipped**. The original C-then-B split was dropped; both ship together because offline playback without cold start is too weak for an installed music app.

44. **PWA target platforms: iOS Safari and Android Chrome equally** — Mobile-first; desktop install is out of scope. Design for platform parity in UX copy and testing, accepting technical gaps (e.g. iOS has no install prompt, stricter service-worker limits, weaker background audio).

45. **Install prompt: smart, dual placement** — Platform-aware install UX (Android `beforeinstallprompt` button; iOS Share → Add to Home Screen coach mark). Shown when not already in standalone mode; dismissible with `localStorage` so it does not nag. **Two surfaces:** (1) global bottom banner above the audio player, (2) contextual block on the logged-in home page. Hide both once installed or permanently dismissed.

46. **Cached Playback: manual downloads + queue auto-cache** — Device storage (not presigned URLs). Users can explicitly download tracks or playlists for planned offline listening; the app also auto-caches the current queue track plus lookahead while online, gated by **Queue Cache Preference** (default on; per-user `localStorage`; toggle on `/downloads`). Opting out stops new Queue Cache writes only — existing queue-cached bytes stay until LRU eviction or an explicit purge. **Clear auto-cached tracks** on `/downloads` deletes queue-only tracks (`isQueueCached && !isPinned`); Pinned Downloads are kept. Remote/presigned URL prefetch for seamless online skips is unaffected by the preference. **Hybrid storage:** track/playlist metadata in IndexedDB, audio bytes in OPFS (via a Web Worker on iOS). Request `navigator.storage.persist()` where supported. Do not store audio in the service-worker Cache API.

47. **Manual offline downloads: per-track and per-playlist** — Download action on individual track rows plus bulk "Download playlist" on user playlists and synced YouTube playlists. No "download entire library" in v1.

48. **Offline UX: player + downloads + read-only library & playlists** — When offline, users can open the installed app (cold start via SW precache in production), play cached audio, browse `/downloads`, browse `/library` filtered to **pinned** downloads, and open user playlist pages (read-only). `/` shows a dedicated offline home. YouTube sync, upload, search, settings, and admin routes show a friendly offline blocker via `OfflineRouteBlocker`. An offline status banner appears on supported pages.

49. **Offline cold start: SW precache + localStorage root shell** — Production builds precache the app shell via `@serwist/build` `injectManifest` into `app/pwa/sw.ts`. `app/features/offline-app/offline-root-shell.client.ts` additionally caches user, theme, and ENV in `localStorage` for warm navigations when loader fetches fail. Dev mode has a minimal SW precache only; full cold-start offline requires a production build.

50. **Offline auth: device-trusted cached playback** — Cached downloads remain playable offline even if the session cookie has expired. Server auth gates new content and network-backed features; already-cached bytes on the device do not require live session validation. Re-authenticate when back online for sync, upload, and non-cached browsing.

51. **Service worker via manual esbuild + Serwist injectManifest** — React Router 7 framework mode is incompatible with `vite-plugin-pwa`'s build order, so the worker is hand-written at `app/pwa/sw.ts`, bundled with esbuild, and precached via `@serwist/build` in `scripts/build-sw.ts` after `react-router build`. Offline audio bytes live in OPFS; metadata in IndexedDB (both separate from SW cache). `navigateFallback` denylist includes `/resources/*` and `*.data`. Do not cache presigned Tigris URLs in the SW.

52. **Unified offline storage; manual downloads win** — Pinned downloads and queue auto-cache share one logical offline library. IndexedDB holds metadata and pin/cache flags; OPFS holds audio files. Pinned tracks persist until the user removes them. Queue-cached tracks are LRU-evicted under storage pressure (delete OPFS file + metadata row). A track that is both pinned and queue-cached is treated as pinned.

53. **Hybrid IndexedDB + OPFS for offline audio** — IndexedDB for queryable metadata (Downloads list, offline library/playlist views). OPFS for audio bytes (streamed download while online). OPFS writes go through a dedicated Web Worker with `createSyncAccessHandle()` because Safari/iOS does not reliably support `createWritable()` on the main thread.

54. **Offline library shows pinned downloads only** — `/library` offline fallback uses `listPinned()`, not all cached tracks. Queue-cached-only tracks remain visible on `/downloads` and are playable offline but do not appear in the offline library browse view.

55. **Cover art cached during download** — `cover-cache.client.ts` stores resized cover blobs in IndexedDB (`covers` store) when a track is downloaded. `useOfflineCoverUrl` serves cached covers when offline. Tracks downloaded before cover-cache shipped may show placeholders until re-downloaded.

56. **iOS download via same-origin stream + Web Share** — Browser "save file" downloads use `/resources/audio/:trackId?stream=1` (same-origin proxy in production) fetched as a blob. iOS falls back to `navigator.share({ files })` when `canShare` supports files (`app/utils/download.ts`). Do not use presigned cross-origin URLs for mobile download triggers.

57. **Unified offline middleware** — All offline data handling goes through a single `offlineClientMiddleware` (`app/middleware/offline-client.middleware.client.ts`). When `navigator.onLine` is false or a fetch fails, it substitutes offline stub data from `OFFLINE_ROUTE_POLICIES` (`app/features/offline-app/offline-route-policies.client.ts`). The earlier per-route `createOfflineClientLoader` / `loadWithOfflineFallback` helpers and route-level `clientLoader` exports were removed in favor of this single mechanism (see ADR-039).

58. **Offline integrity: prune stale metadata** — If IndexedDB references an OPFS file that no longer exists, metadata is pruned on read so Downloads and playback do not surface ghost tracks.

59. **Mobile player sheet — "…" overflow for secondary actions** — The `PlayerNowPlayingSheet` (mobile bottom sheet) gains a "…" overflow button that opens a secondary sheet containing: Download, Play Next, Add to Up Next, Add to Queue, and Track Details. Download is moved from the bottom action row into this overflow sheet. Add to Playlist remains on the bottom row alongside Loop, Shuffle, and Sleep Timer.

60. **Mobile player sheet — Add to Playlist self-fetching** — `AddToPlaylistMenu`'s `playlists` prop becomes optional. When omitted, the component self-fetches the user's playlists from a new `GET /resources/playlists` route on mount. This avoids passing playlist data through the audio player component tree.

61. **Mobile player sheet — Track details dialog with lazy fetch** — Tapping "Track Details" in the overflow sheet opens a dialog modal. Track detail data (service name, source URL, added date) is fetched on-demand from a new `GET /resources/track-details?trackId=...` route. `FullTrack` is not enriched — the player stays lightweight.

### Listening Insights

62. **On-Repeat Snapshot from `play_completed` only** — Rank by `play_completed` **UsageEvent**s (not `play_started`). **Cadence:** generate on the **1st of each month**. **Window:** the **previous calendar month** (UTC). Persist dated **snapshots** (not a single replace-in-place list). Cap at **30 tracks**; each row shows the completed-listen count for that month. **Empty month:** skip snapshot creation when there are zero `play_completed` events; **thin month:** still create when 1–29 tracks qualify. **Retention:** keep all snapshots in v1 (no prune; history page pages as needed). UI: **Snapshot Shelf** (latest 3) + full history page. Snapshots are **read-only**; the only mutation path is **Promote Snapshot** (add all tracks to a new or existing **UserPlaylist**). See [ADR-024](./decisions/024-on-repeat-snapshots.md).

63. **Recently Played Strip on listening hub** — On logged-in `/` (listening hub), show a **Recently Played Strip** **above** recent playlists. Source: `play_completed` only. **Collapse to distinct tracks** (one tile per `trackId`, ordered by most recent completion). Cap **20**. Does not replace recently added; does not change `/history` per-play semantics (ADR-017). See [ADR-025](./decisions/025-recently-played-strip.md).

64. **Heavy Rotation (this month + ever)** — Rank distinct tracks by `play_completed` count for **this UTC month** and for **lifetime (ever)**. Home: **two strips**, each cap **50**, **hide** when empty. Library: **two mutually exclusive sort options** (cannot combine); sorts apply to the **full** library list with **no 50 cap**. Complements **On-Repeat Snapshot** (frozen previous month) — Heavy Rotation is live, not persisted. See [ADR-026](./decisions/026-heavy-rotation.md).

65. **Weekly Wrap on listening hub** — Quiet home-only summary for the **current UTC week (Mon–Sun)**: finishes + unique tracks from `play_completed`; show day streak only when > 1. **Hide when empty**. See [ADR-027](./decisions/027-weekly-wrap.md).

66. **Personal Play Boost on global FTS** — Soft-boost global search results by the **current user's lifetime** `play_completed` counts. Personal only; relevance remains primary. No ServicePlaylist browse change in v1. See [ADR-028](./decisions/028-personal-play-boost.md).

### Party Room

67. **Party Room (shared live queue)** — In-person collaborative queue: server-owned **Room Queue** + SSE, roles **Host / DJ / Listener** with Host-configurable **`defaultJoinRole`**, one **Room Speaker**, **RoomParticipant** seats (users or guests), **Room Code** + URL + QR with **smart join** (no display name), **Guest Shell** + **Audition**, catalog = any track with audio, Host **Add playlist to queue**, remove-own for every role. One open seat at a time. Return from the account, or from the joining browser’s guest cookie. Closing the last tab starts a ~45 minute empty clock once everyone is **Away**; the current Host’s exit ends the room after confirmation. **Become host** waits until the sound has been stopped ~30s. **Reclaim host** can interrupt playback and passes to whoever has the speaker if the creator Leaves. Room plays as **Room Play Event**s only (no personal **UsageEvent** inflation). Personal **PlayerState** suspended on the speaker device. Caps and UX details in [ADR-030](./decisions/030-party-room.md) (amended 2026-10-13). Tracking: [#284](https://github.com/mnlamart/music-library/issues/284).

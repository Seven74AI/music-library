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

yt-dlp errors are classified into one of six categories for retry decision-making:

| Category            | Description                                | Retriable? |
| ------------------- | ------------------------------------------ | ---------- |
| `AUTH`              | HTTP 403, login required                   | No         |
| `RATE_LIMITED`      | HTTP 429, too many requests                | Yes        |
| `GEO_BLOCKED`       | Video blocked in current country           | No         |
| `VIDEO_UNAVAILABLE` | Video removed, private, or unavailable     | No         |
| `NETWORK`           | DNS failures, timeouts, connection refused | Yes        |
| `COOKIE_EXPIRED`    | Sign-in required, cookie rejected          | No         |
| `UNKNOWN`           | Unclassified failure                       | Yes        |

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

### Audio Player & Queue

- **Queue Spine** — Ordered playable tracks for the active play context (library or playlist). Loaded in one request as lightweight `QueueTrack` rows (id, title, artist). The spine is the automatic continuation after **Up Next** is drained; shuffle permutes spine play order client-side.

- **Up Next** — Manual injection zone between now playing and the spine. User-added tracks via **Play next** or **Add to up next** live here in memory only (not persisted across sessions). **Play next** inserts at the front (FIFO among play-next items); **Add to up next** appends to the tail.

- **Hydration** — Lazy fetch of the full playback payload (`FullTrack`: audioFiles, cover, duration) for tracks about to play. The provider hydrates the current track plus a small lookahead (four upcoming tracks) via `GET /api/tracks/playback`. Until hydrated, the UI uses minimal spine stubs.

- **QueueNavigationState** — The in-memory state machine that drives queue positioning and next-track resolution. Contains five fields: `upNext` (the manual injection queue, held in memory only), `spine` (the full ordered list of `QueueTrack` rows for the active play context), `spineOrder` (a permutation of spine indices defining linear or shuffle play order), `spinePosition` (the current position within `spineOrder` — not the raw spine index), and `loopMode` (the current repeat mode). Created on play from a spine fetch and updated immutably by navigation functions — never mutated in place. See `app/features/queue/queue-navigation.ts`.

- **QueueZone** — One of the two zones in the queue architecture: `'upNext'` or `'spine'`. The upNext zone is the manual injection area between the now-playing track and the spine; the spine zone is the automatic continuation (library or playlist). Navigation always drains upNext before advancing the spine pointer.

- **QueueTarget** — A `{ zone, index }` pair that unambiguously identifies a specific track position in the queue. `zone` is a `QueueZone`; `index` is the position within that zone. For upNext targets, `index` is the array index into `upNext`. For spine targets, `index` is the position in `spineOrder` (not the raw spine index) — use `getTrackAtTarget()` to resolve a target to the actual `QueueTrack`.

- **LoopMode** — Controls playback repetition when the spine pointer reaches either end: `'off'` (playback stops when no next/previous track exists), `'all'` (wraps the spine — next from end goes to start, previous from start goes to end), `'one'` (repeats the current track indefinitely — both `resolveNextTrack` and `resolvePreviousTrack` return the current spine position). Up Next is never affected by loop mode; it drains independently.

### Generic

- **Epic Stack** — The full-stack framework this project is built on (React Router v7, Prisma, SQLite, Tailwind, Fly.io).

- **MOCKS** — Environment variable (`MOCKS=true`) enabling server-side mocking of all external services (YouTube API, yt-dlp, Tigris uploads, Telegram). Used in development and CI.

### PWA

- **Installed App** — Music Library added to the device home screen and opened in a standalone window (no browser chrome). Driven by the web app manifest and a registered service worker.

- **Archived Audio** — Audio stored server-side in Tigris after the archive worker downloads it (`TrackAudioFile`). Playable over the network via presigned URLs — **not** the same as device-local storage.

- **Cached Playback** — Audio files on the device (OPFS) plus track/playlist metadata (IndexedDB) so tracks play with no network. Shipped in the PWA Phase 2 rollout.

- **Offline Metadata Store** — IndexedDB records for downloaded tracks and playlists: title, artist, cover thumbnail (dedicated `covers` store), pinned vs queue-cached flag, playlist membership, and a pointer to the OPFS audio file path. Queried by Downloads, offline library, and offline playlist views.

- **Offline Audio Store** — OPFS files holding audio bytes, one file per track (`audio/{trackId}.mp3` or format-appropriate extension). Written via a dedicated Web Worker using `createSyncAccessHandle()` for iOS Safari compatibility.

- **Pinned Download** — A track or playlist the user explicitly downloaded. Persisted in device storage until the user removes it; never LRU-evicted automatically. **Offline `/library` shows pinned tracks only** — queue-cached tracks appear on `/downloads` but not in the offline library view.

- **Queue Cache** — Tracks auto-cached from the active queue for listening continuity. Stored in the same device storage as pinned downloads but eligible for LRU eviction when storage is tight. A track that is both pinned and queue-cached counts as pinned.

- **Offline Shell** — Cached HTML, JS, CSS, and static assets so the app loads and navigates without network. Service-worker precache plus a supplemental root shell cache (user, theme, ENV) for warm navigations when loader fetches fail.

- **Offline Live Route** — A route that serves real Cached Playback data from device storage when offline (library, playlists, downloads, home).

- **Offline Stub Route** — A route that loads offline with placeholder data or a blocker UI instead of network-backed content (YouTube sync, search, admin).

## Settled Decisions

These decisions emerged from the audio archiving implementation, architecture review, and subsequent feature work.

### Architecture

1. **Feature in `app/features/audio-archive/`** — Audio archiving is a self-contained feature module, not scattered across `app/utils/`. All 14 files (7 source + 7 test) live under one directory.

2. **yt-dlp as download tool** — Chosen over `youtube-dl` (unmaintained) and direct HTTP stream capture. yt-dlp is actively maintained, handles YouTube's anti-bot measures, and supports cookie-based authentication. Defense strategy: cookies (auth) + sleep intervals / long breaks (rate limit). User-agent rotation dropped as redundant.

3. **Background worker via setInterval** — The archive worker runs as an interval timer in the server process (configured by `AUDIO_ARCHIVE_INTERVAL_MS`, default 2 min) rather than a separate worker process. Simpler deployment, same process boundary as the app. Max 2 concurrent downloads.

4. **WorkerState as singleton DB record** — Worker lifecycle (running/paused/long_break) stored in a singleton `WorkerState` database record rather than in-memory or a separate control file. Survives server restarts and is inspectable via the admin UI. Long breaks: 1-2h every 6-8h, polling-based (30s DB checks, admin-interruptible).

5. **Error categorization before retry** — yt-dlp stderr is pattern-matched into error categories. Retry logic is category-aware: non-retriable errors (AUTH, GEO_BLOCKED, VIDEO_UNAVAILABLE, COOKIE_EXPIRED) fail permanently on first occurrence; retriable errors (RATE_LIMITED, NETWORK, UNKNOWN) retry up to 3 times. Exponential backoff: 1st retry 5min, 2nd 30min, 3rd 2h.

6. **Dockerfile** — Add `pip install yt-dlp` and `apt-get install -y ffmpeg` to the base Docker image.

### Authentication

7. **Cookie-based YouTube auth** — Cookies file (Netscape format) stored on the server filesystem at `/data/youtube-cookies.txt` and passed to yt-dlp via `--cookies`. Chosen over OAuth token passing (yt-dlp's built-in OAuth has intermittent breakage) and headless browser cookie extraction (too complex for a background worker). DB for audit metadata (uploadedBy, updatedAt, valid flag).

8. **Cookie invalidation on AUTH/COOKIE_EXPIRED** — When yt-dlp returns an AUTH or COOKIE_EXPIRED error, all `YoutubeCookie` records are immediately invalidated. This prevents the worker from burning retries on expired cookies across all jobs.

9. **Cookie upload UI** — Both file upload (drag-drop `cookies.txt`) and textarea paste on the admin panel. Both write to `/data/youtube-cookies.txt` and update the `YoutubeCookie` audit record.

10. **Cookie refresh auto-reset** — When admin uploads new cookies, all `ArchiveJob`s whose latest error code is `AUTH_REQUIRED` are reset to `pending`. Jobs with `VIDEO_UNAVAILABLE` or other non-auth errors are left alone.

### Storage

11. **Tigris Object Storage** — S3-compatible storage on Fly.io. Chosen over local filesystem (not durable across deploys), AWS S3 directly (vendor lock-in, separate billing), and database BLOBs (performance, size limits).

12. **Unified audio object key format** — All server-side audio in Tigris: `audio/tracks/{serviceName}/{trackId}.{ext}`. Applies to archived (YouTube worker) and uploaded (admin/local) audio alike. Legacy keys (`audio/{trackId}/{filename}` and older upload paths) were migrated once via copy-and-update; new code never writes them. Device-side OPFS paths (`audio/{trackId}.{ext}`) are a separate namespace — not Tigris keys.

13. **Multipart upload for files > 5MB** — Using `@aws-sdk/lib-storage` Upload class. Files ≤ 5MB use single-part PutObjectCommand (Tigris multipart minimum is 5MB per part).

14. **No `uploadAudioFile` wrapper** — Call `uploadFile` directly with `contentType: 'audio/mpeg'`. The wrapper adds no value — call site already has context, and generic `uploadFile` already accepts `contentType` and `metadata` cleanly.

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

25. **Library track row → user playlist (Spotify-like)** — When `TrackListItem` receives a `playlists` prop (including an empty `[]`), show **Add to Playlist** on library and user-playlist pages. `AddToPlaylistMenu` lists existing playlists (searchable) and offers **+ New playlist** inline (name-only field, no page navigation). Inline create POSTs to `/resources/create-playlist-with-track`; adding to an existing playlist POSTs to `/resources/add-track-to-playlist` (duplicate track detection with confirm). Shared helpers live in `app/utils/user-playlist.server.ts` (`createUserPlaylistWithTrack`, `createUserPlaylist`, `userPlaylistTitleTaken`). **Per-user playlist titles are unique case-insensitively** — enforced on inline create, `/playlists/new`, and playlist rename. Standalone `/playlists/new` still redirects to `/playlists/{id}`. Do not gate the menu on `playlists.length > 0`.

26. **Admin links in UserDropdown** — Admin-only pages (audio queue, YouTube cookies) are linked from the user dropdown menu, gated by `userHasRole(user, 'admin')`. No separate admin sidebar or nav — the dropdown pattern scales until admin pages outgrow it.

### Home Page (`/`)

Home page redesign decisions (implemented). Route: `app/routes/_marketing+/index.tsx`.

33. **Auth-aware home** — `/` shows different content by auth state. Logged-out users see a marketing landing; logged-in users see the app home (not the Epic Stack placeholder). Logo in `root.tsx` continues to link to `/`.

34. **State-aware hybrid (logged-in)** — Logged-in `/` has two modes: **onboarding** (guide the user to add music) and **listening hub** (feed the audio player). Mode is chosen server-side in the route loader from library/connection data.

35. **Onboarding → listening hub threshold: any library track** — Switch to listening hub when the user has ≥1 active `UserTrack` (`isActive: true`, `deletedAt: null`). Do not wait for archived/playable audio.

36. **Gray zone: archiving banner** — When the user is in listening-hub mode but has **zero playable tracks** (no `TrackAudioFile`), keep the listening-hub layout and show a prominent top banner (e.g. "12 tracks · 3 ready · 9 archiving") with a link to `/library`. Disable play actions on tracks without audio; do not revert to full onboarding.

37. **Empty-state onboarding is context-aware** — When the user has **zero** library tracks, primary CTA depends on YouTube connection state: not connected → **Connect YouTube** (`/music/services/youtube/auth`); connected but no tracks → **Sync a playlist** (`/music/services/youtube/playlists` or synced-playlists flow). **Upload** (`/music/services/local/upload`) and **search** (global search bar) are always available as secondary paths below the primary CTA.

38. **Logged-out landing is a minimal gate** — No feature pitch or screenshot sections. Show logo/product name, a one-liner (e.g. "Your personal music library"), and **Log in** / **Sign up** CTAs in the page body. The global header does not show a login button when logged out (auth entry is via `/` or auth routes). Footer links to About · Privacy · Terms as today. Replace Epic Stack boilerplate entirely.

39. **Listening hub hero: Play library + recently added** — When in listening-hub mode, hero is a **Play library** CTA (starts queue from all playable tracks; disabled in gray zone per #36). Below the hero, a **recently added** row of latest `UserTrack`s with per-track play. Below that: recent playlists, then compact stats / YouTube status (content currently on Music Hub). v1 does **not** add play-history or "continue listening" — defer `localStorage`/DB resume to a follow-up.

40. **Remove Music Hub; no `/music` redirect** — Delete `music.index.tsx` (dashboard). Home is only `/`. Update internal links that pointed to `/music` (UserDropdown, `/music/services` back link) to `/`. Remove "Music Hub" from nav. **`/music/services/*` routes and `music.tsx` layout stay.** Bare `/music` may 404 — no redirect stub for bookmarks.

41. **Single route, split components** — One route at `/` (`_marketing+/index.tsx` or equivalent). Loader branches on auth + library state and returns a `mode`: `marketing` | `onboarding` | `listening` | `gray` plus mode-specific data. UI lives in `app/components/home/` (`MarketingHome`, `OnboardingHome`, `ListeningHome` with gray-zone banner). No `/home` route, no loader redirect to a second URL.

### Track Metadata

27. **Archive worker is the source of truth for track metadata** — When the worker downloads a track's audio, it extracts metadata from the file itself (`music-metadata`): duration, title, artist, album, genre, BPM, ISRC, label, track number, release date, lyrics, etc. Playlist sync does NOT hydrate metadata via `videos.list` — sync only creates tracks with the fields available in `playlistItems` responses, and duration stays `null` until the track is archived. One API call per track was rejected as wasteful; `--:--` in the meantime is acceptable. See [ADR-012](./decisions/012-track-metadata-from-audio-file.md).

28. **Metadata backfill is best-effort** — `updateTrackMetadataFromAudioFile` is wrapped in try/catch inside the worker. By the time it runs, the audio is uploaded and `TrackAudioFile` exists — failing the job would trigger a retry that re-downloads and creates a duplicate `TrackAudioFile`. A failed metadata update is logged and the job still completes.

29. **YouTube API field semantics** — Fields that look interchangeable are not:
    - `contentDetails.videoPublishedAt` = video publication date → use as `releaseDate`. `snippet.publishedAt` on a playlistItem = when the item was ADDED TO THE PLAYLIST — never use it as a release date.
    - `snippet.videoOwnerChannelTitle` = channel that uploaded the video → use as artist name. `snippet.channelTitle` on a playlistItem = the PLAYLIST owner's channel — never use it as the artist. Fallback is `'Unknown Artist'`.

### Images & Covers

30. **Cover thumbnail selection: maxres > medium > default** — `pickCoverThumbnailUrl()` (in `transformations.ts`) picks the cover source from YouTube thumbnails. `maxres` (1280x720) and `medium` (320x180) are true 16:9 renditions; `high` (480x360) and `standard` (640x480) are 4:3 with black letterbox bars and are deliberately skipped — cropping them to a square cover would include the bars. `maxres` only exists for some videos. Playlist thumbnails (display-only, hotlinked from `i.ytimg.com`) stay on `medium`.

31. **Covers are downloaded post-sync, deduplicated, and proxied** — After a playlist sync responds, a background job downloads each track's thumbnail, dedupes by SHA-256 content hash (`CoverImage.contentHash`), re-encodes via sharp (max 1000x1000 JPEG q85), and uploads to Tigris (`images/tracks/{trackId}/cover/…`). Covers are served through the `/resources/images` openimg proxy — its `allowlistedOrigins` must include BOTH storage origins (`getStorageOrigins()`: the raw endpoint and the virtual-hosted `{bucket}.` origin), because openimg matches presigned-URL origins exactly. Until a cover is processed, the UI hotlinks the YouTube thumbnail (CSP `img-src` allows `https://i.ytimg.com` and `https://img.youtube.com`). **Large playlists:** cover processing paginates by `playlistId` (cursor, 100 rows/page) — do not pass 1000+ IDs in a single Prisma `IN` clause; SQLite limits bind parameters to 999. Use `chunkArray()` from `app/utils/chunk-array.ts` (500 IDs/chunk) for any remaining bulk `IN` queries; prefer relational filters (`some: { playlistId }`) when possible.

32. **CSP is configured in two places — keep them in sync** — HTML documents get an enforcing policy from `createCSP()` in `app/entry.server.tsx` (`app/utils/csp.server.ts`). Express also sets Helmet CSP in `server/index.ts` (report-only in dev, enforced in prod). **When adding a host** (e.g. a new image CDN), update **both** files or the stricter/mismatched policy will still block resources. Processed covers use `'self'` (`/resources/images`); hotlinked YouTube art needs `img-src`; presigned audio needs `media-src` for `https://*.fly.storage.tigris.dev`.

33. **Display sizes are proxied, not stored** — Only one cover file exists per unique image (see #31). UI components request on-the-fly square resizes via `/resources/images?w=&h=&fit=cover&format=webp`, built by `coverImageUrl()` in `app/utils/cover-image-url.ts`. `TrackThumbnail` and `PlaylistCover` use default pixel maps at **2× CSS size** for retina (`trackThumbnailPixelSizes`, `playlistCoverPixelSizes`). When a component displays larger than its `size` variant (e.g. a full-width card), pass `pixelSize` on `TrackThumbnail` or extend the shared maps — do not reuse a small `size` with a large `className` without bumping the requested pixels.

### PWA

42. **PWA rollout order: Installed App → Offline Playback** — Phase 1 (installable standalone app: manifest + service worker + install prompts) and Phase 2 (cached audio on device + full offline app shell) are **shipped**. The original C-then-B split was dropped; both ship together because offline playback without cold start is too weak for an installed music app.

43. **PWA target platforms: iOS Safari and Android Chrome equally** — Mobile-first; desktop install is out of scope. Design for platform parity in UX copy and testing, accepting technical gaps (e.g. iOS has no install prompt, stricter service-worker limits, weaker background audio).

44. **Install prompt: smart, dual placement** — Platform-aware install UX (Android `beforeinstallprompt` button; iOS Share → Add to Home Screen coach mark). Shown when not already in standalone mode; dismissible with `localStorage` so it does not nag. **Two surfaces:** (1) global bottom banner above the audio player, (2) contextual block on the logged-in home page. Hide both once installed or permanently dismissed.

45. **Cached Playback: manual downloads + queue auto-cache** — Device storage (not presigned URLs). Users can explicitly download tracks or playlists for planned offline listening; the app also auto-caches the current queue track plus the next three while online. **Hybrid storage:** track/playlist metadata in IndexedDB, audio bytes in OPFS (via a Web Worker on iOS). Request `navigator.storage.persist()` where supported. Do not store audio in the service-worker Cache API.

46. **Manual offline downloads: per-track and per-playlist** — Download action on individual track rows plus bulk "Download playlist" on user playlists and synced YouTube playlists. No "download entire library" in v1.

47. **Offline UX: player + downloads + read-only library & playlists** — When offline, users can open the installed app (cold start via SW precache in production), play cached audio, browse `/downloads`, browse `/library` filtered to **pinned** downloads, and open user playlist pages (read-only). `/` shows a dedicated offline home. YouTube sync, upload, search, settings, and admin routes show a friendly offline blocker via `OfflineRouteBlocker`. An offline status banner appears on supported pages.

48. **Offline cold start: SW precache + localStorage root shell** — Production builds precache the app shell via `@serwist/build` `injectManifest` into `app/pwa/sw.ts`. `app/features/offline-app/offline-root-shell.client.ts` additionally caches user, theme, and ENV in `localStorage` for warm navigations when loader fetches fail. Dev mode has a minimal SW precache only; full cold-start offline requires a production build.

49. **Offline auth: device-trusted cached playback** — Cached downloads remain playable offline even if the session cookie has expired. Server auth gates new content and network-backed features; already-cached bytes on the device do not require live session validation. Re-authenticate when back online for sync, upload, and non-cached browsing.

50. **Service worker via manual esbuild + Serwist injectManifest** — React Router 7 framework mode is incompatible with `vite-plugin-pwa`'s build order, so the worker is hand-written at `app/pwa/sw.ts`, bundled with esbuild, and precached via `@serwist/build` in `scripts/build-sw.ts` after `react-router build`. Offline audio bytes live in OPFS; metadata in IndexedDB (both separate from SW cache). `navigateFallback` denylist includes `/resources/*` and `*.data`. Do not cache presigned Tigris URLs in the SW.

51. **Unified offline storage; manual downloads win** — Pinned downloads and queue auto-cache share one logical offline library. IndexedDB holds metadata and pin/cache flags; OPFS holds audio files. Pinned tracks persist until the user removes them. Queue-cached tracks are LRU-evicted under storage pressure (delete OPFS file + metadata row). A track that is both pinned and queue-cached is treated as pinned.

52. **Hybrid IndexedDB + OPFS for offline audio** — IndexedDB for queryable metadata (Downloads list, offline library/playlist views). OPFS for audio bytes (streamed download while online). OPFS writes go through a dedicated Web Worker with `createSyncAccessHandle()` because Safari/iOS does not reliably support `createWritable()` on the main thread.

53. **Offline library shows pinned downloads only** — `/library` offline fallback uses `listPinned()`, not all cached tracks. Queue-cached-only tracks remain visible on `/downloads` and are playable offline but do not appear in the offline library browse view.

54. **Cover art cached during download** — `cover-cache.client.ts` stores resized cover blobs in IndexedDB (`covers` store) when a track is downloaded. `useOfflineCoverUrl` serves cached covers when offline. Tracks downloaded before cover-cache shipped may show placeholders until re-downloaded.

55. **iOS download via same-origin stream + Web Share** — Browser "save file" downloads use `/resources/audio/:trackId?stream=1` (same-origin proxy in production) fetched as a blob. iOS falls back to `navigator.share({ files })` when `canShare` supports files (`app/utils/download.ts`). Do not use presigned cross-origin URLs for mobile download triggers.

56. **Offline route loaders fall back on network errors** — `createOfflineClientLoader` (from `app/features/offline-app/offline-loader.client.ts`) wraps `loadWithOfflineFallback`, which checks `navigator.onLine` first, then catches fetch failures (`TypeError`, network message patterns) and runs route-specific offline loaders from `OFFLINE_ROUTE_POLICIES`. Used by root, home, library, playlists, and downloads routes.

57. **Offline integrity: prune stale metadata** — If IndexedDB references an OPFS file that no longer exists, metadata is pruned on read so Downloads and playback do not surface ghost tracks.

58. **Mobile player sheet — "…" overflow for secondary actions** — The `PlayerNowPlayingSheet` (mobile bottom sheet) gains a "…" overflow button that opens a secondary sheet containing: Download, Play Next, Add to Up Next, Add to Queue, and Track Details. Download is moved from the bottom action row into this overflow sheet. Add to Playlist remains on the bottom row alongside Loop, Shuffle, and Sleep Timer.

59. **Mobile player sheet — Add to Playlist self-fetching** — `AddToPlaylistMenu`'s `playlists` prop becomes optional. When omitted, the component self-fetches the user's playlists from a new `GET /resources/playlists` route on mount. This avoids passing playlist data through the audio player component tree.

60. **Mobile player sheet — Track details dialog with lazy fetch** — Tapping "Track Details" in the overflow sheet opens a dialog modal. Track detail data (service name, source URL, added date) is fetched on-demand from a new `GET /resources/track-details?trackId=...` route. `FullTrack` is not enriched — the player stays lightweight.

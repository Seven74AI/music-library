# Architecture Deepening — Six Module Refactors

Status: **ready-for-agent** (parent spec)  
Source: architecture review + grilling session (Jul 2026)

Child implementation issues: see [issues/](./issues/) in this folder.

---

## Problem Statement

The Music Library codebase grew feature-by-feature (YouTube **Playlist Sync**, **Archived Audio**, **Cached Playback**, admin upload) with logic spread across many shallow modules. Understanding one domain concept — for example, what happens during **Playlist Sync** — requires reading eight or more files. Related rules (**Preferred Audio Format**, **Service Connection** token refresh, Tigris object keys) are duplicated at call sites, so bugs hide where modules meet rather than inside any one module. Tests exist for some slices but not at consolidated interfaces, and documentation had drifted from implementation.

Contributors and agents pay a high navigation cost; changes to sync, offline, or storage require touching many files with no single test surface to verify correctness.

## Solution

Deepen six clusters into **deep modules**: small public interfaces, complex implementations behind clean seams, testable through those interfaces. Consolidate domain vocabulary in `docs/CONTEXT.md`. Migrate big-bang per cluster in dependency order. Unify Tigris **TrackAudioFile** object keys under one format with a one-time migration script.

This is refactoring for **locality** and **leverage**, not new user-facing features — behavior should remain equivalent except where bugs are fixed (e.g. OAuth refresh on sync paths).

## User Stories

### Playlist sync & Personal Library

1. As a user with YouTube connected, I want **Playlist Sync** to import my **ServicePlaylist** tracks reliably, so that my synced catalog stays current with YouTube.
2. As a user, I want deleted YouTube videos to preserve original titles where possible, so that I still recognize removed content.
3. As a user, I want to confirm **Orphaned Track** matches when sync cannot auto-resolve deleted videos, so that I control ambiguous cases.
4. As a user, I want to add synced tracks to my **Personal Library** explicitly, so that my listening collection reflects what I chose — sync never creates **UserTrack** rows automatically.
5. As a user browsing a synced playlist, I want to see which tracks are already in my Personal Library, so that I know what I have curated.
6. As a developer, I want one **syncServicePlaylist** entry point, so that I do not trace eight modules to understand sync.
7. As a developer, I want **confirmOrphanedMatches** separate from automatic sync, so that user-driven confirmation stays a distinct act.
8. As a developer, I want cover images processed after sync without blocking the sync response, so that large playlists sync in reasonable time.
9. As a developer, I want **ArchiveJob** auto-enqueue injected via an adapter, so that sync tests do not wake the archive worker.
10. As a developer, I want **UserTrack** writes in a separate user-library module, so that Personal Library membership is not conflated with ServicePlaylist sync.

### Offline / PWA

11. As a user with **Cached Playback**, I want the app to load offline on **Offline Live Routes** (library, playlists, downloads, home), so that I can listen without network.
12. As a user offline, I want **Offline Stub Routes** (YouTube, search, admin) to show placeholders or blockers, so that I am not stuck on loader errors.
13. As a developer, I want one route policy registry driving both middleware stubs and clientLoader offline data, so that adding an offline-aware route is one registration.
14. As a developer, I want offline device I/O to stay on the **OfflineStorage** interface, so that route policy does not wrap storage in a shallow pass-through.
15. As a user, I want warm offline navigations to use the **Offline Shell** cache, so that the app feels responsive without network.

### Storage & audio files

16. As a user, I want **Archived Audio** and uploaded audio playable via presigned URLs, so that streaming works from Tigris.
17. As a developer, I want all **TrackAudioFile** keys under `audio/tracks/{serviceName}/{trackId}.{ext}`, so that bucket layout is predictable.
18. As an operator, I want a one-time migration script for legacy keys, so that existing library content keeps working after unification.
19. As a developer, I want one storage module owning S3 client, multipart upload, and key building, so that archive and upload do not duplicate adapters.
20. As a user, I want the **Preferred Audio Format** (FLAC → WAV → MP3 → …) applied consistently when streaming, downloading, and caching offline.

### Service Connection

21. As a user with YouTube connected, I want expired OAuth tokens refreshed automatically during sync and browsing, so that sync does not fail while the UI shows connected.
22. As a developer, I want **resolveServiceAccessToken(serviceName, userId)** returning null when invalid, so that UI and sync share one token seam.
23. As a developer, I want **hasServiceConnection** for boolean checks, so that routes do not duplicate OAuth validation logic.

### Track Audio Persist

24. As a user, I want admin-uploaded tracks stored with correct metadata and **TrackAudioFile** records, so that they appear in my library.
25. As a user, I want the archive worker to persist downloaded audio and backfill track metadata best-effort, so that archived tracks become playable.
26. As a developer, I want **persistTrackAudio** shared by worker and upload routes, so that storage + DB + backfill policy live in one place.
27. As a developer, I want upload flows to pass an optional DB transaction into persist, so that Track + TrackAudioFile stay atomic.

### Agents & maintainers

28. As an agent implementing a ticket, I want modules in feature folders with clear interfaces, so that I can test through one seam per module.
29. As a maintainer, I want `docs/CONTEXT.md` as the domain glossary, so that terms like ServicePlaylist, UserTrack, and Playlist Sync are unambiguous.

## Implementation Decisions

### Cross-cutting

- **Migration style:** big-bang per cluster (no long-lived shims).
- **Implementation order:** service-connection → storage + key migration → track-audio-ingest → audio-format domain → service-playlist + user-library → offline-app.
- **Domain docs:** `docs/CONTEXT.md` is glossary source of truth.
- **ADR:** record storage key unification + migration (supersedes ADR-010 settled decision on key format; revisit shallow-wrapper rejection — deepen with key builder + persist, not pass-through).

### 1. Service playlist module

- **Modules:** service-playlist feature, user-library feature.
- **Interface:**
  - `syncServicePlaylist(serviceName, playlistId, userId)` — merges first-time registration and re-sync internally.
  - `confirmOrphanedMatches(...)` — separate from automatic sync.
  - Listing/queries: getAllPlaylistsWithSyncStatus, getPlaylistTracksWithUserStatus (includes isInUserLibrary read join).
  - User library: add/remove UserTrack (explicit user actions only).
- **Provider seam:** fetch + normalize only. Drop validateConnection from provider.
- **Dependencies:** direct resolveServiceAccessToken(); injected ArchiveEnqueueAdapter.
- **Cover images:** fire-and-forget post-sync inside module; delete unused preDownloadImages path.
- **Collapse:** BatchProcessorProvider / ImageProcessorProvider slices into service-playlist implementation.

### 2. Offline app module

- **Modules:** offline-app (new); offline-storage unchanged as device I/O seam.
- **Interface:** OFFLINE_ROUTE_POLICIES per route: `{ mode: 'live' | 'stub', offlineLoader?, stub? }`.
- **Behavior:** middleware applies stubs; shared createOfflineClientLoader for live routes.
- **Root shell:** move into offline-app; SW precache stays in PWA build.
- **getOfflineStorage():** remains public.

### 3. Storage module

- **Module:** deepen server storage utils; merge archive Tigris upload.
- **Key format:** `audio/tracks/{serviceName}/{trackId}.{ext}` — service **name**, not internal ID.
- **Migration:** pause worker → idempotent copy/update/delete script → deploy → resume.

### 4. Audio format domain

- **Module:** isomorphic audio-format domain module (no Prisma).
- **Interface:** selectBestAudioFile using Preferred Audio Format priority.
- **Delete:** duplicate priority arrays and old server-only selection module.

### 5. Service connection module

- **Module:** service-connection feature.
- **Interface:**
  - resolveServiceAccessToken(serviceName, userId) → `{ access_token } | null`
  - hasServiceConnection(serviceName, userId)
  - disconnectServiceConnection(serviceName, userId)
- **Delete:** validateYouTubeOAuth / getUserConnection / parseConnectionTokens split paths.

### 6. Track audio ingest module

- **Module:** track-audio-ingest feature.
- **Interface:** persistTrackAudio({ trackId, serviceName, buffer, metadata, uploadedBy?, tx? }).
- **Order:** build key → upload Tigris → create TrackAudioFile (in tx if provided) → best-effort metadata backfill.
- **Scope:** narrow — not Track/Artist/Album/UserTrack orchestration.
- **Idempotency:** existing TrackAudioFile on archive retry.

## Testing Decisions

**Good tests** exercise external behavior through the **module interface** — inputs at the seam, outcomes callers care about (return values, DB state, adapter side effects). Do not test private helpers. Use MOCKS and adapter no-ops to isolate side effects.

| Module | Test seam | Prior art |
|--------|-----------|-----------|
| Service playlist | syncServicePlaylist, confirmOrphanedMatches, listing | service-playlist server tests |
| User library | add/remove UserTrack | same + track-library route tests |
| Offline app | OFFLINE_ROUTE_POLICIES, middleware, clientLoader helper | offline-route-loader, offline-root-shell tests |
| Storage | buildAudioObjectKey, upload mock path | tigris-upload tests |
| Audio format | selectBestAudioFile | offline-track-summary tests |
| Service connection | resolve, hasServiceConnection, refresh | OAuth mocks in sync tests |
| Track audio ingest | persistTrackAudio, tx vs standalone, idempotent retry | worker server tests |

## Out of Scope

- New service providers beyond YouTube.
- UI redesign of offline blockers or playlist pages.
- OPFS device path migration (separate from Tigris).
- Automatic UserTrack creation during Playlist Sync.
- Re-downloading all tracks for format change — key path migration only.

## Further Notes

- **Correctness fix in service-connection:** sync paths currently skip OAuth refresh; unified module fixes this.
- **Worker pause** required for storage key migration.
- **Child issues:** [issues/](./issues/) — one ticket per cluster with blocking edges.

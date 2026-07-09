# ADR-012: Track Metadata Extracted from the Archived Audio File

## Status

Accepted

## Context

Tracks created during YouTube playlist sync were missing most metadata — notably `duration`, which was `NULL` for every synced track (players showed `0:00 / 0:00` or `--:--`). The YouTube `playlistItems.list` response used by sync simply does not include duration; it only exists in `videos.list` (`contentDetails.duration`).

Two approaches were considered for filling the gap:

1. **Hydrate during sync** — call `videos.list` for every synced track (batched) and upsert duration and other metadata into `Track`.
2. **Extract from the downloaded audio file** — the archive worker (ADR-011) already downloads the full audio; parse the file itself for metadata.

An initial implementation of option 1 was built and then removed: it added an extra YouTube API call per sync batch, more quota consumption, more code in the sync path, and duplicated data that the audio file already carries more accurately.

Separately, an audit of the YouTube API fields consumed during sync found two semantic bugs (fields that look interchangeable but are not).

## Decision

### 1. The archive worker is the single source of metadata backfill

When a job downloads a track's audio, the worker reads the file with `music-metadata` (`extractAudioMetadata`) and backfills the `Track` record: duration, title, artist, album, genre, BPM, ISRC, label, track/disc numbers, release/original dates, lyrics, and year. It also enriches `TrackAudioFile` with real format, MIME type, file size, bitrate, and sample rate.

Playlist sync does **not** hydrate metadata via `videos.list`. Synced tracks keep `duration: null` (displayed as `--:--`) until they are archived. This is an accepted trade-off: no extra API quota, simpler sync, and the audio file is the more accurate source anyway.

### 2. Metadata backfill is best-effort

`updateTrackMetadataFromAudioFile` is wrapped in try/catch. By the time it runs, the audio is already uploaded to Tigris and the `TrackAudioFile` record exists. If the metadata update threw, the job would be retried, re-download the audio, and create a **duplicate `TrackAudioFile`**. Instead, a failure is logged and the job completes normally — the track just keeps its sync-time metadata.

### 3. YouTube API field semantics (from the sync-field audit)

- `releaseDate` comes only from `contentDetails.videoPublishedAt` (video publication date). `snippet.publishedAt` on a playlistItem is the date the item was **added to the playlist** and must never be used as a release date. No fallback — `null` if absent.
- Artist name comes only from `snippet.videoOwnerChannelTitle` (the uploading channel). `snippet.channelTitle` on a playlistItem is the **playlist owner's** channel and must never be used as the artist. Fallback is `'Unknown Artist'`.

## Alternatives Considered

### videos.list hydration during sync
**Pros**: Duration available immediately after sync, no dependency on the archive worker
**Cons**: One extra API call per 50 tracks per sync, quota cost, duplicated metadata source, more sync code
**Decision**: Rejected — implemented, then removed in favor of worker extraction

### videos.list call during queue download
**Pros**: Richer YouTube-side metadata (view counts, etc.) at download time
**Cons**: API quota cost per track; the audio file already carries the fields the app uses
**Decision**: Rejected — the file itself is sufficient

### Failing the job when metadata update fails
**Pros**: Guarantees metadata is eventually written
**Cons**: Retry re-downloads audio and creates duplicate `TrackAudioFile` records
**Decision**: Rejected — best-effort with logging

## Consequences

### Positive
- ✅ Durations and rich metadata (BPM, ISRC, lyrics…) appear automatically once a track is archived
- ✅ No additional YouTube API quota consumed by sync
- ✅ `TrackAudioFile` records carry real bitrate/sample-rate/file-size instead of hardcoded values

### Negative
- ⚠️ Synced-but-not-yet-archived tracks show `--:--` durations (accepted; see CONTEXT.md decision 23)
- ⚠️ Tracks whose archive job fails permanently never get metadata backfilled

## References

- [ADR-011: Audio Archive Worker](./011-audio-archive-worker.md) — the worker this extends
- [CONTEXT.md](../CONTEXT.md) — settled decisions 26-28
- [YouTube Data API: playlistItems](https://developers.google.com/youtube/v3/docs/playlistItems) — field semantics
- [music-metadata](https://github.com/Borewit/music-metadata)

## Revision History

- **2026-07-09**: Initial version

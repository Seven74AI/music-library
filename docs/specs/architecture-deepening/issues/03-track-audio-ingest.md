# Issue 3: Track audio ingest module

**Labels:** `ready-for-agent`  
**Blocks:** none (service-playlist archive adapter independent)  
**Blocked by:** #48  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Create **track-audio-ingest** feature with `persistTrackAudio` — shared by archive worker and admin upload for Tigris upload + TrackAudioFile + metadata backfill.

## Acceptance criteria

- [ ] `persistTrackAudio({ trackId, serviceName, buffer, metadata, uploadedBy?, tx? })`
- [ ] Order: build key → upload Tigris (always first) → create TrackAudioFile (in tx if provided) → best-effort metadata backfill
- [ ] Archive worker calls persist without tx; upload routes pass tx inside existing transaction
- [ ] Idempotent on archive retry when TrackAudioFile already exists
- [ ] Upload routes shed inline key generation and duplicate TrackAudioFile creation
- [ ] Unit/integration tests at persist interface

## Implementation notes

Depends on unified storage key builder from issue #2. Narrow scope — does not own Track/Artist/Album/UserTrack creation.

## Testing

Prior art: worker server tests. Verify storage-first ordering and backfill failure does not fail persist.

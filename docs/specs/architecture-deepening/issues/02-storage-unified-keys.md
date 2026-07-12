# Issue 2: Storage merge + unified audio object keys

**Labels:** `ready-for-agent`  
**Blocks:** track-audio-ingest issue  
**Blocked by:** none  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Deepen server **storage** module: merge archive Tigris upload adapter, centralize `buildAudioObjectKey`, unify all **TrackAudioFile** keys to `audio/tracks/{serviceName}/{trackId}.{ext}`, run one-time migration.

## Acceptance criteria

- [ ] Single storage module owns S3 client, multipart upload, presigned URLs, audio key builder
- [ ] Archive worker and admin upload use same key format (service **name**, not internal ID)
- [ ] Migration script: pause worker → copy objects → update DB objectKey → delete old keys → idempotent
- [ ] `tigris-upload` duplicate removed; archive worker uses storage module
- [ ] Tests for key builder and upload mock path
- [ ] ADR for key unification + migration (supersedes ADR-010 §12)
- [ ] `docs/CONTEXT.md` settled decision #12 matches implementation

## Implementation notes

Run migration **before** resuming worker on new code. Operator runbook in ticket comment or ADR.

## Testing

Prior art: tigris-upload server tests. Test key builder for youtube/local provenances.

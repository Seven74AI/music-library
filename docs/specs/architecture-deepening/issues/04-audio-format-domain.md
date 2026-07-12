# Issue 4: Audio format domain module

**Labels:** `ready-for-agent`  
**Blocks:** none  
**Blocked by:** none  
**Spec:** [architecture-deepening.md](../architecture-deepening.md)

## Summary

Create isomorphic **audio-format** domain module with `selectBestAudioFile`; delete triplicated FORMAT_PRIORITY (server, player, offline).

## Acceptance criteria

- [ ] `app/domain/audio-format.ts` with selectBestAudioFile on `{ format: string | null }[]`
- [ ] Implements **Preferred Audio Format** order from CONTEXT.md
- [ ] Server audio routes, audio player, offline storage import domain module
- [ ] Old audio-file-selection server module deleted (big bang)
- [ ] Unit tests for priority, empty list, fallback to first file

## Implementation notes

Independent ticket — can run in parallel with #1–#3. No Prisma in domain module.

## Testing

Prior art: offline-track-summary client tests.

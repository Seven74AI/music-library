# ADR-014: Unified Audio Object Keys in Tigris

## Status

Accepted (supersedes ADR-010 §12 key layout)

## Context

Server-side audio lived under two incompatible Tigris key layouts:

1. **Archive worker** — `audio/{trackId}/{filename}` (yt-dlp output basename)
2. **Admin upload** — `audio/tracks/{trackId}/{serviceId}/{format}/{timestamp}-{fileId}.{ext}`

The general-purpose storage module (`app/utils/storage.server.ts`) already owned S3 client setup, multipart upload, and presigned URLs, while the archive feature duplicated that in `tigris-upload.server.ts`. Predictable bucket layout matters for operators, migration scripts, and the upcoming **Track Audio Persist** module (issue #51).

Domain vocabulary in `docs/CONTEXT.md` settled decision #12 specifies:

`audio/tracks/{serviceName}/{trackId}.{ext}`

where `serviceName` is the track's service **name** (`youtube`, `local`, …), not the internal `Service.id` cuid.

## Decision

### 1. Single storage module owns audio key building and uploads

- Add `buildAudioObjectKey(serviceName, trackId, extension)` and `isUnifiedAudioObjectKey(objectKey)` to `app/utils/storage.server.ts`.
- Archive worker and admin upload routes call `uploadFile()` from the same module (no separate Tigris adapter).
- Delete `app/features/audio-archive/tigris-upload.server.ts`.

### 2. Unified key format for all new writes

```
audio/tracks/{serviceName}/{trackId}.{ext}
```

Examples:

- `audio/tracks/youtube/clxyz123.mp3`
- `audio/tracks/local/clabc456.flac`

Device-side OPFS paths (`audio/{trackId}.{ext}`) are unchanged — a separate namespace.

### 3. One-time migration script

`scripts/migrate-audio-object-keys.ts` (npm script `migrate-audio-keys`):

1. **Pause worker** before running (operator step — not automated).
2. For each `TrackAudioFile` whose `objectKey` is not already unified:
   - Compute new key from `track.service.name`, `trackId`, and file extension.
   - **Copy** object in Tigris (`CopyObject`) if destination missing and source exists.
   - **Update** DB `objectKey` (and `fileName`).
   - **Delete** old object key.
3. **Idempotent** — unified keys and existing destinations are skipped; safe to re-run.
4. Supports `--dry-run` for inspection.

### 4. Operator runbook

```
1. Pause archive worker (admin UI → WorkerState paused)
2. Deploy this change (new code writes unified keys only)
3. npm run migrate-audio-keys -- --dry-run   # inspect
4. npm run migrate-audio-keys                # execute
5. Spot-check playback for youtube + local tracks
6. Resume archive worker
```

Run migration **before** resuming the worker on new code so in-flight jobs do not write legacy keys after migration completes.

## Consequences

### Positive

- One module seam for storage I/O and key format — tests and Track Audio Persist can target `storage.server.ts` only.
- Bucket layout matches domain glossary and architecture spec.
- Archive worker no longer maintains a parallel S3 client.

### Negative

- Production requires a coordinated worker pause + migration window.
- Legacy keys in local dev fixtures/tests must use the new format going forward.

## References

- Spec: `docs/specs/architecture-deepening/issues/02-storage-unified-keys.md`
- Supersedes key layout in ADR-010 §12 (upload strategies and multipart rules unchanged)
- Glossary: `docs/CONTEXT.md` settled decision #12
- Implementation: `app/utils/storage.server.ts`, `scripts/migrate-audio-object-keys.ts`

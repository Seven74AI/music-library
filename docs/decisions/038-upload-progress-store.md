# ADR-038: Upload Progress Store (Shared, Multi-Instance)

## Status

Accepted

## Context

Upload progress was tracked in a module-level `Map` in
`app/routes/api+/upload-progress.$uploadId.tsx`. The async upload
(`upload-audio-batch.tsx` → `processFilesAsync`) mutates that Map on whatever
instance serves the upload, while the SSE progress poll
(`upload-progress.$uploadId.tsx`) reads the Map on whatever instance serves the
poll. On a multi-instance (Fly.io) deployment those two requests can land on
different instances, so progress is invisible/stuck and the poll sees no state.

The code itself flagged "in production, use Redis". The same Map also held
`StoredFileData.buffer` for "retry" — up to ~1 GB per ZIP of audio bytes held in
process memory, and entirely write-only (see below).

## Decision

Introduce a `ProgressStore` abstraction with two backends, selected by
environment variables:

- **Memory backend** (default; single-instance / tests): the existing in-memory
  Map, bounded by a TTL sweeper (`startUploadProgressSweeper`, 1 h idle TTL +
  100-entry least-recently-updated cap). This preserves the single-instance
  behaviour without requiring Redis in dev/CI.
- **Redis backend** (Upstash, via `@upstash/redis`): each session is a JSON
  string under `upload-progress:{uploadId}` with `EXPIRE` refreshed on every
  write, so idle sessions disappear without an in-process sweeper. A sorted-set
  LRU index (`upload-progress:lru`) enforces the 100-entry cap on write.

The backend is chosen at module load: when `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` are both set, Redis is used; otherwise memory.

### Retry-buffer strategy

`StoredFileData.buffer` was write-only: the completion screen's "Retry" action
re-sends the failed files from the browser (`upload.tsx` →
`handleRetryFailed`), and the SSE payload already strips `fileData` before
serialising. Audio buffers (up to ~1 GB per ZIP) cannot live in Redis verbatim,
and spilling them to Tigris/S3 would add a read path no caller needs. We
therefore **drop the server-side retry buffer entirely** — `addFailedFile` now
records only `{ fileId, fileName, error }` — and rely on client-side re-upload.
This keeps the shared store small, JSON-only, and Redis-safe, and removes a
latent unbounded-memory hazard.

### SSE visibility across instances

Active SSE connections remain instance-local (they wrap in-process
`ReadableStream` controllers and cannot cross instances without pub/sub). Two
mechanisms make progress visible:

1. An immediate, instance-local push via a store subscription (same-instance
   upload + poll — the common single-instance case today).
2. The SSE loader's 1 s heartbeat, which now polls the shared store every tick
   and pushes a full snapshot. On a multi-instance deploy this is the mechanism
   that makes progress visible at 1 s granularity even when upload and poll land
   on different instances.

### Concurrency

File processors for one upload run in parallel (MAX_CONCURRENCY = 5). The
read-modify-write mutations are serialised with a per-`uploadId` async mutex,
which the synchronous Map previously hid but the async Redis round-trip exposes.

## Consequences

- Progress state is shared and correct across instances when Redis is
  configured.
- No unbounded memory retention: Redis `EXPIRE` (1 h) bounds entries; the
  memory backend keeps the TTL sweep + cap.
- Failed-file retry buffers are no longer held server-side; retry re-uploads
  from the browser. (This is the existing client behaviour — no UX change.)
- `fly.toml` remains single-instance today; this ADR is forward-looking and the
  Redis backend only activates when the Upstash env vars are provided.

## References

- Implementation: `app/features/upload-progress/progress-store.server.ts`
- SSE loader: `app/routes/api+/upload-progress.$uploadId.tsx`
- Upload action: `app/routes/api+/upload-audio-batch.tsx`
- Prior store semantics (TTL + cap): parent task t_2a2679d1

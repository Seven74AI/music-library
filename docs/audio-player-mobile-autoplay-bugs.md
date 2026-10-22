# Audio Player — Mobile Auto-Advance Bugs

Findings from investigating "next song does not auto-play on Android/iOS".

Scope: `app/components/audio-player.tsx`, `app/components/audio-player-provider.tsx`,
`app/features/offline-storage/resolve-playback-url.client.ts`.

Status legend:

- **Confirmed** — reproduced with a test.
- **Verified in code** — mechanism read directly from source, not device-tested.
- **Unproven** — plausible mechanism, needs a real device to confirm impact.

---

## 1. Silent permanent stall when next track fails to hydrate

**Status:** Fixed (integration tests cover non-OK and omitted-track hydration)
**Severity:** High — queue dies with no error shown, user must manually restart playback

### Symptom

Auto-advance moves the queue pointer forward, then playback never starts. No toast,
no error banner, no console output. `hasNext` becomes `false`, so the Next button
cannot recover either. Playback is permanently stuck.

### Repro result

Drove `playNext()` with the hydration request failing:

```
current track after failed advance: "track-1"   (playback never moved)
hasNext after failed advance:       "false"     (pointer already past track-2)
```

Same dead end reproduced for both failure shapes:

- hydration request returns non-OK (flaky network)
- hydration returns 200 but omits the track (access revoked / stale spine)

### Cause

Queue state is committed _before_ playback is attempted:

```847:864:app/components/audio-player-provider.tsx
  const advanceToTarget = useCallback(
    (target: QueueTarget) => {
      const queueTrack = getTrackAtTarget(navigationState, target);
      if (!queueTrack) return;

      const nextState = advanceAfterPlay(navigationState, target);
      setUpNext(nextState.upNext);
      // ...
      setSpinePosition(nextState.spinePosition);
      void playResolvedTrack(queueTrack);
    },
```

Two independent silent-failure paths inside `playResolvedTrack`:

```454:462:app/components/audio-player-provider.tsx
  const playResolvedTrack = useCallback(
    async (queueTrack: QueueTrack) => {
      await hydrateAround(queueTrack.id);
      const fullTrack = resolveFullTrack(playbackCacheRef.current, queueTrack);
      if (!isPlayableTrack(fullTrack)) return;

      beginPlayback();
      setCurrentTrack(fullTrack);
    },
```

1. `hydrateAround` → `hydrateMissing` → `fetchPlaybackBatch` throws on non-OK
   response. No `try`/`catch` anywhere in the chain. Called as
   `void playResolvedTrack(...)` → unhandled rejection, swallowed.
2. Unhydrated track resolves to a stub (`fullTrackStubFromQueueTrack` →
   `audioFiles: []`) → `isPlayableTrack` false → bare `return`.

Because `setSpinePosition` already ran, the skipped track is gone from the queue.

### Why it hits mobile hardest

Backgrounded tab on a flaky mobile connection is exactly when this fetch fails.

### Fix direction

- Attempt playback before committing the pointer, or roll back on failure.
- `try`/`catch` around `hydrateAround`; surface a toast and retry.
- Do not leave `void`-called async playback paths without a rejection handler.

---

## 2. Presigned URLs cached forever, expire after 1 hour

**Status:** Fixed (TTL + invalidate; handleError recovers on codes 2 and 4)
**Severity:** High — breaks playback after ~1h of continuous listening

### Cause

Server signs for 3600 seconds:

```159:159:app/routes/resources+/audio.$trackId.tsx
  const { url: signedUrl } = await getFileUrl(audioFile.objectKey, 3600);
```

Client cache has no TTL and no eviction:

```8:9:app/features/offline-storage/resolve-playback-url.client.ts
const remoteUrlCache = new Map<string, string>();
const pendingRemoteFetches = new Set<string>();
```

`clearBlobUrlCache()` only clears `blobUrlCache`, never `remoteUrlCache`. Every URL
resolved or prefetched during a session is retained indefinitely.

### Symptom

In a session longer than an hour (normal on mobile, especially with loop-all on a
small playlist), a cached URL goes stale → CDN returns 403.

If that surfaces as `MEDIA_ERR_SRC_NOT_SUPPORTED` (code 4), `handleError` has no
recovery path — it sets an error and clears `src`. No `ended` fires, so nothing
auto-advances. Playback stops dead.

Only `MEDIA_ERR_NETWORK` (code 2) attempts offline-blob recovery.

### Fix direction

- Store expiry alongside the URL; treat as a miss past TTL (with a safety margin).
- Add 403/404 to the `handleError` recovery path: re-resolve a fresh URL, then retry.

---

## 3. Media Session flips to `paused` during auto-advance

**Status:** Fixed (ignore pause while keepPlayingRef is set)
**Severity:** Medium — lock-screen flicker; stated design intent not achieved

### Cause

Per the HTML spec, reaching end of media fires `pause` **before** `ended`. So
`handlePause` runs first:

```1287:1287:app/components/audio-player.tsx
    const handlePause = () => setIsPlaying(false);
```

By the time `handleEnded` runs, `isPlaying` is already `false`. This defeats the
guard that was written to preserve it:

```1001:1006:app/components/audio-player.tsx
      // Only clear the "playing" flag when NOT auto-advancing. Keeping it set
      // through gapless transitions keeps navigator.mediaSession in "playing",
      // so background audio isn't dropped on lock screens.
      if (!shouldAutoPlay) {
        setIsPlaying(false);
      }
```

`isPlaying` drives Media Session state:

```1140:1140:app/components/audio-player.tsx
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
```

### Important qualification

`mediaSession.playbackState` is a UI hint to the OS. It does **not** gate `play()`.
This is not itself an autoplay blocker. Consequences are lock-screen UI showing
"paused" mid-transition, a flickering play/pause button, and the documented
continuity goal silently not holding.

`keepPlayingRef` is maintained separately and does survive the transition.

### Fix direction

Ignore `pause` events while `keepPlayingRef.current` is true, so `isPlaying` stays
continuous through the handoff.

---

## 4. Async gap between `ended` and `play()`

**Status:** Fixed (sync peek of prefetched URL; skip OPFS wait when cache is warm)
**Severity:** Medium-high — best remaining candidate for true lock-screen autoplay failure

### Cause

`play()` runs many tasks after `ended`, behind multiple async hops:

1. `ended` → `onNext()` → `playNext` → `advanceToTarget`
2. `await hydrateAround(...)` (network if not already cached)
3. `setCurrentTrack` → effect → `resolveTrackPlaybackSource(trackId)`
4. `resolvePlaybackAudioUrl` — **always** awaits OPFS/IndexedDB first, even when
   the remote URL is already prefetched
5. `setAudioSrc(url)` → autoplay effect → `play()`

Prefetch (`prefetchPlaybackAudioUrl`) removes the presigned-URL fetch but not the
storage hop.

### Why it may break mobile

iOS suspends a backgrounded page once audio output stops. Android Chrome throttles
background timers and fetches. If the page is suspended during the gap, the promise
callback that sets `src` never runs, so `play()` never happens.

### Fix direction

Shorten the gap. Resolve the next track's playable source ahead of time so the
handoff after `ended` is synchronous.

---

## 5. Contributing factors (minor on their own)

### `src` blanked between tracks — mitigated

Cold resolve still blanks briefly; prefetched handoff applies the cached URL
synchronously and skips blanking (see bug 4).

### Next track not buffered — mitigated

`<audio preload="auto">` so the current source buffers beyond metadata once set.
A second element for true cross-track buffering was not added.

### Gesture unlock calls `play()`, not only `load()`

Unlock now uses muted `play()` (+ `pause()`), with `load()` as a jsdom fallback.
Effective for Chromium and stronger on iOS than `load()` alone.

---

## Investigated and ruled out

Recorded so these are not re-raised.

| Claim                                                                                      | Verdict                                                                                                                                                    |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currentTime = 0` throws `InvalidStateError` in Safari when `readyState` is `HAVE_NOTHING` | **Not a bug.** Current spec sets the default playback start position and returns. Throwing was legacy Safari/IE behaviour. Line is redundant but harmless. |
| Media Session action handlers torn down on every track change                              | **Not a bug.** React runs effect cleanup and re-run synchronously in the same commit. No window where handlers are absent.                                 |

---

## Suggested order of work

1. Bug 1 — confirmed, clean test seam at the provider, contained fix.
2. Bug 2 — clear cause, clear fix, no device needed.
3. Bug 3 — one-line-ish fix, restores documented intent.
4. Bug 4 — largest change; do after 1–3 and validate on a real device.

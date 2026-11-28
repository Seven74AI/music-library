# PRD: Now-playing source indicator (admin-only)

Status: plan only. No code written. All citations are `file:line` against `main` @ `c9f12068`.

## Goal

In the mobile "Now playing" bottom sheet, show one small icon to the **right of the "Now playing" title**. The icon says where the current track is being played from:

- **stream**: remote URL
- **cache**: local blob, auto-cached (queue cache)
- **downloaded**: local blob, user-pinned

The icon is **admin-only**. Non-admins see nothing, and the DOM is unchanged for them.

## Verified facts

| Fact                                                                                                                                                                                                                                                                                       | Evidence                                                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| The title is plain text in `SheetHeader`. The sheet is `data-testid="player-now-playing-sheet"`.                                                                                                                                                                                           | `app/components/player-chrome.tsx:238-243`, `:230`                                                                              |
| `SheetHeader` is `flex flex-col space-y-2`. The sheet's Close button is `absolute right-4 top-4`, so a left-aligned icon next to the title cannot collide with it.                                                                                                                         | `app/components/ui/sheet.tsx:65-67`, `:56`                                                                                      |
| `PlayerChromeProps` has no source, user, or pinned info. It has `isDownloading` and `track`.                                                                                                                                                                                               | `player-chrome.tsx:33-61`                                                                                                       |
| `isDownloading` is a **browser file save-to-disk** (`useTrackAudioFileDownload`), "not offline/PWA pinning". It must **not** be used as the "downloaded" signal.                                                                                                                           | `app/hooks/use-track-audio-file-download.ts:5-9`, `audio-player.tsx:209-211`                                                    |
| The source of truth is `audioSrc` state, `string \| undefined`. It is `undefined` while loading and while resolving a new track.                                                                                                                                                           | `audio-player.tsx:386`, `app/components/audio-player-offline-source.ts:74,126`                                                  |
| A `blob:` URL means local. `resolvePlaybackAudioUrl` calls `URL.createObjectURL`, and `peekCachedPlaybackUrl` returns the blob URL first. The existing code already tests `audioSrc.startsWith("blob:")`.                                                                                  | `resolve-playback-url.client.ts:66,45`, `audio-player-offline-source.ts:195`                                                    |
| A remote URL is a presigned URL from `/resources/audio/:id`. A room-speaker `audioSrcOverride` is also remote.                                                                                                                                                                             | `resolve-playback-url.client.ts:90-95,127-134`, `audio-player-offline-source.ts:98`                                             |
| `chromeProps` is assembled in one place and does not pass `audioSrc`.                                                                                                                                                                                                                      | `audio-player.tsx:966-994`                                                                                                      |
| `PlayerNowPlayingSheet` is rendered unconditionally.                                                                                                                                                                                                                                       | `audio-player.tsx:1026-1030`                                                                                                    |
| `OfflineTrackRecord` has `isPinned` and `isQueueCached`. "Queue-only" is `isQueueCached && !isPinned`. A pinned download is explicitly distinct from the queue cache.                                                                                                                      | `offline-storage/types.ts:18-20`, `pin-policy.ts:3-6`                                                                           |
| **Downloaded predicate precedent**: `isDownloaded && isPinned`. It drives the "Remove offline download" label and the `check` icon. `isDownloaded` is `hasTrack` (bytes exist in OPFS) and `isPinned` is `record.isPinned`.                                                                | `app/hooks/use-offline-track-download.ts:17-22`, `app/hooks/use-offline-track-status.ts:16-20`                                  |
| `useOfflineTrackStatus(trackId \| null)` already exists. It refreshes **only when `trackId` changes** and does not subscribe to storage changes.                                                                                                                                           | `use-offline-track-status.ts:9-29`                                                                                              |
| Queue auto-cache calls `cacheQueueTrack` for tracks around the current one. It never pins.                                                                                                                                                                                                 | `audio-player-provider.tsx:1631-1657`, `offline-storage.client.ts:309-330`                                                      |
| `isAdmin(user)` is exported from `permissions.ts` but **not** re-exported from `user.ts`. `user.ts` re-exports only `hasRole as userHasRole`, `isCuratorOrAdmin as userIsCuratorOrAdmin`, `userHasPermission`, and `parsePermissionString`. Accepted shapes include `{ roles: {name}[] }`. | `permissions.ts:30-41`, `user.ts:27-33`                                                                                         |
| The root loader user includes `roles { name, permissions }`, so `isAdmin(useOptionalUser())` type-checks.                                                                                                                                                                                  | `app/root.tsx:145-152`                                                                                                          |
| **Admin-only precedent** exists: `isAdmin = user.roles.some(name === "admin")` for the LOCAL service, and an `isAdmin` prop on `OnboardingHome`. **Curator+admin** precedent uses `userIsCuratorOrAdmin` for curation features.                                                            | `app/routes/music+/services+/index.tsx:32-35`, `app/routes/_marketing+/index.tsx:26`; `track-list-item.tsx:238`, `root.tsx:422` |
| **Mobile-only already holds.** The sheet is opened only by `setIsNowPlayingOpen(true)` from the mini-bar's "Open now playing" button. The mini-bar root is `md:hidden`. `PlayerDesktopBar` has no open trigger.                                                                            | `audio-player.tsx:1025` (only call site), `player-chrome.tsx:92,113-118,412-529`                                                |
| Sprite icons available: `arrow-path`, `check`, `check-circled`, `download`, `globe`, `laptop`, `link-2`. There is **no** cloud, wifi, or signal icon.                                                                                                                                      | `app/components/ui/icons/types.ts:6,18,19,29,37,39,40`                                                                          |
| `Icon` supports a `title` prop that renders an SVG `<title>` for accessibility.                                                                                                                                                                                                            | `app/components/ui/icon.tsx:38-40,48-56`                                                                                        |

## Open Questions & Assumptions

1. **Admin means `isAdmin`, not `userIsCuratorOrAdmin`.** The request says "admins". This is a diagnostic aid, not a curation feature, and admin-only precedent exists (`services+/index.tsx:32`). Assumption: use `isAdmin` from `permissions.ts`. It is a one-line swap to `isCuratorOrAdmin` if the product owner wants curators included.
2. **Pinned but streaming.** This happens after a media-error recovery to a fresh remote URL (`audio-player-offline-source.ts:271-277`), or for a room-speaker override. Assumption: **source wins**, so the icon shows `stream`. The title appends "(downloaded copy available)" so no information is lost. Downloaded requires a local blob and a pin.
3. **Media-error recovery must be signalled.** The user's requirement: when a downloaded track is streaming, and that stream is the RESULT of a media-error recovery (not a normal stream), the tooltip must say so. There is currently NO state recording that a recovery happened — `handleError` (`audio-player.tsx:822-863`) calls `recoverPlaybackSourceAfterMediaError(...).then(result => …)` and the swap happens in the recovery function (`audio-player-offline-source.ts:217-292`), but the result is only used to call `stopFailedPlayback` on failure. **Add** a `recoveredFromMediaError` boolean state in `audio-player.tsx`, set true when the recovery resolves `"recovered"`, reset to false when `trackId` changes (and cleared on a normal source resolve). Pass it into `getPlaybackSource` so `stream` + `recoveredFromMediaError` renders a distinct tooltip/aria-label: e.g. label "Streaming", title "Playback recovered to streaming after a media error (downloaded copy failed)". When recovered to a blob instead of a remote URL, the source is already `cache`/`downloaded`, so the flag only affects the `stream` case.
4. **Cached means queue-cache only.** A blob that is not pinned is shown as `cache`. We do not read `isQueueCached`, because a non-pinned blob can only come from the queue cache or from `downloadTrack({pin:false})`, and both are non-pinned local copies (`offline-storage.client.ts:295-300`).
5. **Icons: no new sprite assets.** Adding one needs a new SVG under `other/svg-icons` and a sprite rebuild (ADR-008 is referenced in `icon.tsx`; I did not read the ADR). Assumption: reuse existing icons.
   - stream: `globe`
   - cache: `laptop`
   - downloaded: `check-circled`
   - `check` is the alternative if the team prefers consistency with `use-offline-track-download.ts:20`.
6. **Loading.** When `audioSrc` is `undefined`, render nothing. The same applies when `playbackError` is set and there is no source.
7. **Live refresh of pinned state.** The hook does not subscribe to storage. Assumption: refresh on sheet open, which is cheap and sufficient for a diagnostic aid. No event bus is added.

## Success Criteria (testable)

1. Admin, `audioSrc = "https://cdn.example/track-1.mp3"`, not pinned: sheet shows an indicator with `data-source="stream"`, `aria-label` "Streaming", and the `globe` icon.
2. Admin, `audioSrc = "blob:…"`, not pinned: `data-source="cache"`, `aria-label` "Playing from cache", and the `laptop` icon.
3. Admin, `audioSrc = "blob:…"`, `isDownloaded && isPinned`: `data-source="downloaded"`, `aria-label` "Playing downloaded copy", and the `check-circled` icon.
4. Admin, remote src, pinned: `data-source="stream"` with a title that mentions the downloaded copy.
5. Admin, remote src, `recoveredFromMediaError`: `data-source="stream"` with a title that says the stream is a media-error recovery.
6. Non-admin (roles `[]` or `user`) or signed out (`undefined`): **no** `player-source-indicator` element in the sheet.
7. Admin, `audioSrc` undefined (loading): no indicator.
8. The indicator is a sibling **after** `SheetTitle` inside one flex row, so it is visually to the right of the title. The "Now playing" heading still resolves via `getByText("Now playing")`. Existing assertions at `audio-player-queue.integration.test.tsx:354,511` still pass.
9. Non-admins trigger no offline-storage reads for this feature, because the hook is called with `null`.
10. The mini-bar and desktop bar are unchanged.
11. `npm run typecheck`, `lint`, and the touched vitest files pass.

## What's NOT in scope

- New sprite icons or SVG assets.
- Desktop UI. The desktop bar has no now-playing sheet.
- Showing the indicator to curators or regular users.
- A storage-change event bus or live subscription. Refresh on sheet open only.
- Changing `useOfflineTrackStatus` semantics, or `isDownloading` (browser save).
- Mini-bar, queue sheet, and track-list indicators.
- Server or loader changes.
- Persisting any state.

## Step-by-step plan (TDD)

### Step 1: pure derivation and presentational component (red, then green)

New files: `app/components/player-playback-source.tsx` and `app/components/player-playback-source.test.tsx`.

Tests first, with no mocks:

- `getPlaybackSource({ audioSrc, isPinnedDownload, recoveredFromMediaError })` returns `null` for `undefined` or `""`.
- It returns `"stream"` for `https://…` and `/resources/audio/x`.
- It returns `"cache"` for `blob:a` without a pin.
- It returns `"downloaded"` for `blob:a` with a pin.
- It returns `"stream"` for remote plus pinned.
- The component also takes a `recoveredFromMediaError: boolean` and, when `source === "stream"`, uses title `"Playback recovered to streaming after a media error (downloaded copy failed)"` instead of the normal stream title.
- Component `PlaybackSourceIndicator({ source, downloadedCopyAvailable })` renders a `span`:
  - attributes: `role="img"`, `data-testid="player-source-indicator"`, `data-source`, `aria-label`, `title`
  - children: `<Icon name=… className="h-4 w-4 shrink-0 text-muted-foreground" />`
  - icon map: stream `globe`, cache `laptop`, downloaded `check-circled`
  - label map: stream "Streaming", cache "Playing from cache", downloaded "Playing downloaded copy"
  - test with `render`, in the jsdom environment like `audio-player.test.tsx:1`
  - the `Icon` sprite `href` comes from `icon.tsx:4`, which vitest already handles in other component tests

Export the type `PlaybackSource = "stream" | "cache" | "downloaded"`.

### Step 2: wire the chrome (red, then green)

Edit `app/components/player-chrome.tsx`:

- Add `playbackSource: PlaybackSource | null` to `PlayerChromeProps` (`:33-61`). It is required, and `audio-player.tsx:966` is the only constructor.
- Destructure `playbackSource` in `PlayerNowPlayingSheet` (`:167-192`).
- Replace `:239` with `<div className="flex items-center gap-2"><SheetTitle>Now playing</SheetTitle>{playbackSource ? <PlaybackSourceIndicator … /> : null}</div>`. `SheetDescription` stays below it in `SheetHeader`.
- `PlayerMiniBar` and `PlayerDesktopBar` receive the prop via the spread but ignore it.
- The chrome stays presentational. It adds no hook calls and no storage reads.
- Pass `downloadedCopyAvailable` through as a second field. Either make the prop `{ source; downloadedCopyAvailable }` or fold it into the label upstream. Prefer the object form `playbackSource: { source; hasDownloadedCopy } | null`.

### Step 3: derive in `audio-player.tsx` (red, then green)

Edit `app/components/audio-player.tsx`:

- Add imports: `useOptionalUser` from `#app/utils/user.ts`, `isAdmin` from `#app/utils/permissions.ts`, `useOfflineTrackStatus` from `#app/hooks/use-offline-track-status.ts`, and `getPlaybackSource` from `./player-playback-source`.
- Next to `isNowPlayingOpen` (`:212`), add:
  - `const user = useOptionalUser();`
  - `const canSeePlaybackSource = isAdmin(user);`
  - `const { isDownloaded, isPinned, refresh } = useOfflineTrackStatus(canSeePlaybackSource && track ? track.id : null);`
- Passing `null` for non-admins makes `refresh` a cheap no-op that touches no storage (`use-offline-track-status.ts:10-14`).
- Add `useEffect(() => { if (isNowPlayingOpen && canSeePlaybackSource) void refresh(); }, [isNowPlayingOpen, canSeePlaybackSource, refresh])`. This picks up pin changes made elsewhere since the track last changed.
- Before `chromeProps` (`:966`), compute:
  - `const playbackSource = canSeePlaybackSource ? getPlaybackSource({ audioSrc, isPinnedDownload: isDownloaded && isPinned }) : null;`
  - Add `playbackSource` to `chromeProps` (`:966-994`).
- Hook placement: all hooks must run **before** the early return near `:950-957`. Put them next to `:209-213`.

Tests: extend `app/components/audio-player.test.tsx`. Follow the existing pattern of `renderPlayer()` and `user.click(screen.getByLabelText("Open now playing"))` (`:1358-1370`).

- Add a hoisted `userState` and a `#app/utils/user.ts` mock, copying `track-list-item.test.tsx:36-42`. **This is required** (see Risks #1).
- Mock `#app/hooks/use-offline-track-status.ts` with a hoisted state `{ isDownloaded, isPinned, refresh: vi.fn() }`.
- Cases (matching the Success Criteria):
  - admin and stream (the default mock `resolveTrackPlaybackSource` returns `https://cdn.example/track-1.mp3`, `:67-70`)
  - admin and cache (`vi.mocked(resolveTrackPlaybackSource).mockResolvedValue("blob:cached-track-1")`, pattern at `:431-432`)
  - admin and downloaded
  - non-admin
  - signed out
  - loading (a never-resolving `resolveTrackPlaybackSource`)
  - refresh called on open
- Default `userState.current` to a **non-admin** user so existing tests are unaffected.

### Step 4: verify

- `npx vitest run app/components/player-playback-source.test.tsx app/components/audio-player.test.tsx app/components/audio-player-queue.integration.test.tsx app/components/audio-player-provider.test.tsx app/hooks/use-offline-track-status.test.ts`
- `npm run typecheck && npm run lint`
- Manual, via `npm run dev:youtube-mocks` (login `kody` / `kodylovesyou` per `CLAUDE.md`). Check whether that user has the admin role in the seed. Use a mobile viewport, open the sheet, and play a track. Stream shows first. After the queue cache fills, a later track shows cache. After a pinned download from the library, reopening the sheet shows downloaded.
- Optional e2e is not needed for a diagnostic icon.

## Files likely to change

| File                                                     | Change                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `app/components/player-playback-source.tsx` (new)        | `PlaybackSource` type, `getPlaybackSource`, `PlaybackSourceIndicator`                             |
| `app/components/player-playback-source.test.tsx` (new)   | pure and presentational tests                                                                     |
| `app/components/player-chrome.tsx`                       | prop plus title row (`:33-61`, `:167-192`, `:239`)                                                |
| `app/components/audio-player.tsx`                        | admin gate, status hook, derive and pass prop (`:209-213`, `:966-994`)                            |
| `app/components/audio-player.test.tsx`                   | `user.ts` and status-hook mocks, new cases                                                        |
| `app/components/audio-player-queue.integration.test.tsx` | only if a typecheck or mock gap appears. It already mocks `useOptionalUser` (`:19-23`, `:43-47`). |

## Tradeoffs

- **Derived prop vs. reading in chrome.** The chrome today takes props in and does no storage reads or routing hooks, apart from `useAudioPlayer`. Deriving in `audio-player.tsx` keeps the chrome dumb and keeps the logic in one pure, unit-testable function. The cost is a new prop on `PlayerChromeProps`, which is spread into mini and desktop bars that ignore it.
- **Gate in `audio-player.tsx` vs. in the chrome.** Putting the admin check upstream turns "admin and ready" into a single nullable prop, so the chrome has no branching. It also stops non-admins from reading IndexedDB or OPFS through the status hook.
- **Reuse `useOfflineTrackStatus` vs. a new `getRecord` call.** Reuse gives the same `isDownloaded && isPinned` predicate as the download button (`use-offline-track-download.ts:17`). The cost is that it only refreshes on `trackId` change, so we add a refresh on sheet open.
- **Source from `audioSrc` vs. `hasTrack`.** `audioSrc` shows what is _actually playing_. `hasTrack` only says a copy exists. A pinned track can still be streaming, so we combine both, with source winning.
- **Existing icons vs. new ones.** Reusing `globe`, `laptop`, and `check-circled` avoids a sprite rebuild. `laptop` for local cache is a mild metaphor stretch, but `title` and `aria-label` make it unambiguous.

## Risks

1. **Existing tests will throw without a mock.** `useOptionalUser` calls `useRouteLoaderData`, which hits `invariant` outside a data router (`node_modules/react-router/dist/development/lib/hooks.js:834-838`, `:1023-1025`). `audio-player.test.tsx` renders under plain `MemoryRouter` (`:140-145`) and has **no** `#app/utils/user.ts` mock. Adding the hook to `AudioPlayer` breaks the whole file until the mock is added. `audio-player-queue.integration.test.tsx` already mocks it. `audio-player-provider.test.tsx` mocks `./audio-player` (`:47`), so it is unaffected. Any other test that renders the real `AudioPlayer` outside a data router needs the same mock. Run the full vitest suite to catch these.
2. **Stale pinned state.** `useOfflineTrackStatus` keeps the previous track's `isPinned` until its async refresh resolves (`use-offline-track-status.ts:9-29`), so a one-tick wrong `downloaded` or `cache` after a track change is possible. Mitigation: it is admin-only and diagnostic. If it proves visible, key the hook or reset state on `trackId` change, which would be a small separate change.
3. **Stale `audioSrc` for one render on track change.** `audioSrc` is reset in an effect (`audio-player-offline-source.ts:126`), so the first render after a track change can still show the previous track's source. The same mitigation applies.
4. **Hook ordering.** `audio-player.tsx` has an early return near `:950-957`. The new hooks must sit above it (placed at `:209-213`).
5. **Title layout.** Wrapping `SheetTitle` in a div changes the DOM structure. Existing text lookups for "Now playing" should be unaffected, but confirm there is no snapshot test.
6. **No admin in the dev seed.** The dev login `kody` may lack the admin role. The manual check could then show nothing, which would look like a bug.

## Recommended approach (single path)

1. Add `app/components/player-playback-source.tsx` with a pure `getPlaybackSource({ audioSrc, isPinnedDownload })` and a presentational `PlaybackSourceIndicator`, using the existing `globe`, `laptop`, and `check-circled` icons. Unit-test both first.
2. In `audio-player.tsx`, gate with `isAdmin(useOptionalUser())`. Call `useOfflineTrackStatus(isAdmin ? track.id : null)` and refresh it when the sheet opens. Compute `playbackSource` from `audioSrc`, `isDownloaded && isPinned`, and a new `recoveredFromMediaError` state (set when `recoverPlaybackSourceAfterMediaError` resolves `"recovered"`, reset on `trackId` change), with `null` for non-admins or while loading. Pass it through `chromeProps`.
3. In `player-chrome.tsx`, add the nullable `playbackSource` prop and render it as a sibling after `SheetTitle` in a flex row in the `PlayerNowPlayingSheet` header. No new hooks go into the chrome.
4. Extend `audio-player.test.tsx` with the `user.ts` and status-hook mocks and the six scenarios, defaulting to a non-admin so existing tests stay green. Then run the five test files, typecheck, and lint.

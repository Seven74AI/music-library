# Downloads page polish: badge, checkbox, bulk "download all", rename "pinned"

Status: plan only, nothing implemented. All `file:line` references were read on `main` at `c9f12068`.

## 1. Goal

The Downloads page (`app/routes/downloads.tsx`) mixes two kinds of offline tracks in one list. The user can't tell which is which, can't tell whether auto-cache is on, and sees the internal word "pinned". Four changes:

1. Each row says whether the track is an explicit **download** or an **auto-cached** queue track.
2. The "Auto-cache queue tracks" checkbox shows its state unmistakably.
3. A bulk action turns all auto-cached tracks into downloads ("download them all").
4. User-facing "pinned" copy is replaced. Internal `isPinned` / `pinnedCount` / `pin:` stay as they are.

Background facts, verified:

- Both kinds live in the same IndexedDB + OPFS store, told apart by `isPinned` (explicit download) and `isQueueCached` (auto-cache); a track can have both (`types.ts:17-20`).
- `downloadTrack` defaults `pin = true` and sets `queue: !pin` (`offline-storage.client.ts:295-300`). `cacheQueueTrack` writes `pin:false, queue:true`, except when it re-fetches missing bytes for a record that was already pinned, where it keeps `pin` (`:318-326`).
- `isQueueOnlyOfflineTrack = isQueueCached && !isPinned` is the single definition of "evictable / purgeable" (`pin-policy.ts:4-6`). `downloads.tsx:55` re-implements it inline.
- The Downloads loader lists ALL records via `listDownloaded()` (`downloads.tsx:30`, `metadata-store.client.ts:93-95`). Offline `/library` lists pinned only (`offline-route-policies.client.ts:168`).

## 2. Open questions and assumptions

| #   | Question                                                                                                                                                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                       | Recommended default (what this plan builds)                                                                                                                    |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | **What does "download them all" mean?** (i) promote every auto-cached track to a permanent download, or (ii) download the whole library offline.                                  | The user's confusion was cache vs download, and the Downloads page already shows exactly the auto-cached set. (ii) has no code at all: `downloadTrack` needs a `FullTrack` and fetches one full audio file serially (`offline-storage.client.ts:294-307`); nothing enumerates the whole library client-side. The only bulk precedent is the per-playlist loop (`offline-playlist-download-button.tsx:54-105`). | **(i)**: a "Download all auto-cached" button on the Downloads page. (ii) is a separate follow-up issue (section 5). **Ask the user to confirm before step 6.** |
| Q2  | Is "download them all" a selection thing ("select several, download")?                                                                                                            | The repo has selection-mode checkboxes in `track-list-item.tsx:479-492`, but the offline list doesn't use them.                                                                                                                                                                                                                                                                                                | No. Not built. If yes, it is a different design.                                                                                                               |
| Q3  | Checkbox: keep a checkbox or switch to `Switch`? The user said "check icon", so the default is to keep the checkbox and fix the glyph.                                            | `switch.tsx` shows state by thumb position and track colour, with no glyph at all (`switch.tsx:11,19`).                                                                                                                                                                                                                                                                                                        | Keep the checkbox; mention `Switch` as an alternative (Tradeoffs T3).                                                                                          |
| Q4  | Do the glossary terms change? `docs/CONTEXT.md:205` ("Pinned Download") and `:207` ("Queue Cache") are domain vocabulary, and `docs/agents/domain.md` says to use glossary terms. |                                                                                                                                                                                                                                                                                                                                                                                                                | Keep the domain terms. Add the UI labels to the glossary entries ("shown to users as _Downloaded_ / _Auto-cached_"). No ADR renames.                           |
| Q5  | Badge on offline `/library` too?                                                                                                                                                  | `OfflineLibraryView` is shared (`library.index.tsx:461`), but that list is pinned-only, so every row would read "Downloaded".                                                                                                                                                                                                                                                                                  | Opt-in prop; only the Downloads page turns it on.                                                                                                              |
| Q6  | Does the checkbox bug reproduce? **It could not be confirmed statically** (see 4.A).                                                                                              | The component is unchanged since the first commit (`9b7ddc53`; `953c33d7` only reformatted it) and is the stock Epic Stack checkbox.                                                                                                                                                                                                                                                                           | Step 0 is a real-browser repro. The planned fix is robust whichever way the repro comes out.                                                                   |

Assumption: the user is on the dev/prod PWA in a normal browser. I could not run a browser here (the sandbox blocks the Playwright cache dir), so everything about rendered pixels is unverified.

## 3. Success criteria (testable)

Storage

- S1. `getOfflineStorageKind({isPinned, isQueueCached})` returns `"downloaded"` when `isPinned` (even if also queue-cached), `"auto-cached"` when `isQueueCached && !isPinned`, otherwise `null`.
- S2. `storage.pinQueueCachedTracks()` flips `isPinned=true` and sets `pinnedAt` on every queue-only record whose OPFS bytes exist, and returns `{ promotedCount }`. It makes **zero** calls to `fetchAudioBytes`. Pinned records are untouched. Records with missing bytes are not promoted (and are cleaned up the same way `hasTrack` does). A second call returns `promotedCount: 0`.
- S3. After promotion, `purgeQueueCache()` removes 0 of those tracks and `getStorageStats().pinnedCount` has grown by `promotedCount`.
- S4. After promotion, `ensureCapacity` no longer treats those tracks as evictable (a tight-quota `downloadTrack` throws `OfflineStorageQuotaError` where it would previously have evicted).

UI

- U1. With `showStorageBadge`, each row shows "Downloaded" (pinned, including pinned+queue-cached) or "Auto-cached" (queue-only). Without the prop (offline `/library`) no badge renders.
- U2. The header reads `N downloaded · M auto-cached · X MB [of ~Q MB] on this device.` Neither "pinned" nor "total cached" appears. N and M are derived from the same `tracks` array as the rows.
- U3. No user-visible "pinned"/"Pinned" remains anywhere in `app/` (the grep in 4.D is the checklist).
- U4. A "Download all auto-cached" button sits next to "Clear auto-cached tracks", disabled when `queueOnlyCount === 0`. It opens a confirm dialog that states the count and size and says the tracks will no longer be cleared automatically. Confirming calls `pinQueueCachedTracks`, shows a toast ("Downloaded N tracks"), and revalidates, so the badges flip to "Downloaded" and the header counts move.
- U5. Toggling "Download for offline" / "Remove offline download" from a row menu refreshes the list and badge without pressing Refresh (see 4.B).
- U6. The checkbox's checked state is visible: in a real browser the indicator svg has a non-zero box (>= 10px) and the path stroke resolves to the primary-foreground colour, in both light and dark themes.

Quality gates: `npm run typecheck`, `npx vitest run` for the touched test files, `npm run lint`, and the new e2e spec all pass.

## 4. Findings

### A. Missing check icon on the "Auto-cache queue tracks" checkbox

Code under test: `app/components/ui/checkbox.tsx:13-31`. Root classes include `data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground size-4` (`:17`). The Indicator is `flex items-center justify-center text-current` (`:24`). It wraps `<svg viewBox="0 0 8 8"><path d="M1,4 L3,6 L7,2" stroke="currentcolor" strokeWidth="1" fill="none"/></svg>` (`:26-28`).

Hypothesis verdicts, from reading the code, the CSS and Tailwind's preflight:

| Hypothesis                                               | Verdict                    | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) `stroke="currentcolor"` lowercase doesn't resolve    | **Rejected.**              | CSS keywords are case-insensitive. The attribute is valid in every engine. I'd still normalise it to `currentColor` for consistency (the sprite uses `fill="currentColor"`, `sprite.svg:43`).                                                                                                                                                                                                                                                                                                                                                                                            |
| (b) `text-primary-foreground` doesn't cascade to the svg | **Rejected.**              | Root gets `color: primary-foreground` when checked. Indicator's `text-current` is `color: currentColor`, a no-op that inherits. The svg and path inherit that colour and resolve `currentcolor` against it. Tailwind preflight sets `button { color: inherit }` (`preflight.css:253`), which doesn't interfere because the utility wins in the utilities layer.                                                                                                                                                                                                                          |
| (c) The path is clipped by the small viewBox             | **Rejected for clipping.** | All points lie inside 0..8 (x 1-7, y 2-6; with a 0.5 half-stroke the extents are still inside). **But**: the svg has no `width`/`height`/size class. It is a flex item inside a ~14px flex container (16px root minus a 1px border each side). Preflight makes `svg { display:block }` (`preflight.css:214-224`) and applies `max-width:100%; height:auto` only to `img, video` (`:230-234`), not to svg. The rendered size therefore depends on replaced-element sizing in a flex context. This is the one genuinely under-specified thing in the component, and I couldn't measure it. |
| (d) Low contrast of the token pair                       | **Rejected.**              | Light: `--primary` oklch(20.79%) on `--primary-foreground` oklch(98.38%). Dark: swapped (`tailwind.css:49-50`, `:83-84`). That is high contrast either way.                                                                                                                                                                                                                                                                                                                                                                                                                              |

Controlled-state check (`downloads.tsx:42-49,57-61,103-107`): `checked={queueCacheEnabled}` is always a boolean, and `handleQueueCacheToggle` writes localStorage then sets state, so the state can't go stale. Two things are real but cosmetic: the initial `useState(true)` flashes "checked" before the effect reads a stored `false`, and nothing but the box tells the user the state.

Honest status: this is verbatim upstream Epic Stack code, unchanged in this repo (`git log -- app/components/ui/checkbox.tsx` shows only `9b7ddc53` and the `953c33d7` reformat), and the same component powers the library "Only tracks with audio" filter (`library.index.tsx:521`), history (`history.tsx:187`) and the selection checkboxes. If the check really is invisible, it is likely invisible in all of them, and the leading suspect is the unsized, hairline (≈1.75px at 14px) glyph. I can't rule out a perceptual cause (a thin tick on a filled box).

Planned fix (it covers both outcomes of the Step 0 repro):

- Keep the inline svg, but make it explicit: `className="size-3.5"` (14px, fits the 14px inner box), `viewBox="0 0 8 8"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`, `strokeLinejoin="round"`, `aria-hidden="true"`.
- **Do not switch to `<Icon name="check">`**, even though `select.tsx:120` does. `Icon` renders an external-sprite `<use href="sprite.svg#check">` (`icon.tsx:63-69`), and ADR-008 records that external-sprite references have inconsistent caching across browsers. An inline svg has no network dependency, which matters on a page that is an offline route. The tradeoff is spelled out in T2.
- In `downloads.tsx`, add a short visible status hint to the label description ("On" / "Off") so the state never depends on a 14px glyph alone. This is optional if Q3 says to use `Switch`.

### B. Per-row badge

- `TrackListItem` has no generic adornment slot. The per-row precedent is hard-coded pills beside the title: "Archiving" at `track-list-item.tsx:541-545` (`shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground`) and `NotesBadge` at `:540`. `itemActionsContent` (`:868-875`) renders at the far right, after the ⋯ menu, which is a poor spot for a status tag and costs width on mobile.
- `TrackListItem` is `memo`'d (`:185`). Passing a fresh JSX element as a prop would defeat the memo. Pass a **primitive** prop instead.
- Decision: add `offlineStorageKind?: "downloaded" | "auto-cached"` to `TrackListItem` and render a pill next to the Archiving pill, with the same shape and typography. There is precedent for offline props on this component (`offlineDownloadTrack`, `:126`).
- Text and styling:
  - "Downloaded": `bg-primary/10 text-primary`.
  - "Auto-cached": `bg-muted text-muted-foreground`.
  - Meaning is carried by the text, never by colour alone. Add a `title` tooltip: "Saved on this device until you remove it" / "Saved automatically while you listened; may be cleared when space is low".
- A track with both flags shows **"Downloaded"** (matches `isQueueOnlyOfflineTrack`, `docs/CONTEXT.md:207`, "counts as pinned").
- `OfflineLibraryView` gets an opt-in `showStorageBadge?: boolean` (default false). `OfflineLibraryTrackItem` passes `offlineStorageKind={showStorageBadge ? getOfflineStorageKind(track) : undefined}`. Only `downloads.tsx` passes `showStorageBadge`.
- Staleness bug that the badge would expose: the row menu's "Download for offline" / "Remove offline download" (`use-offline-track-download.ts:17,35-41`) updates only the hook's local state (`refresh()` in `use-offline-track-status.ts:9-25`), not the page loader data. Today, removing a download leaves the row on screen until Refresh. With a badge, promoting a row would leave it labelled "Auto-cached" while its menu says "Remove offline download". Fix: add an optional stable `onOfflineDownloadChange?: () => void` to `TrackListItem`, threaded to `OfflineDownloadDropdownItem` / `OfflineDownloadSheetButton` (`:1250-1302`), called after a successful toggle. `OfflineLibraryView` forwards it; `downloads.tsx` passes `() => void revalidator.revalidate()` (a `useCallback`).

### C. "Download them all"

Existing pieces:

- Per-track: `useOfflineTrackDownload` (`:39`) calls `downloadTrack(track, {pin:true})`, which re-fetches the audio.
- Per-playlist bulk: serial loop with progress and failure counting (`offline-playlist-download-button.tsx:54-105`).
- `purgeQueueCache` (`offline-storage.client.ts:332-347`) is the structural mirror of what we need.

Recommendation: **option (i)**, implemented as a metadata-only promotion, **not** a loop over `downloadTrack`:

- The bytes are already in OPFS, so promotion is a flag flip (`mergeOfflineTrackRecord(existing, {isPinned:true})` already sets `pinnedAt`; `types.ts:96-97`). That costs no network, works offline, and is atomic per record.
- Looping `downloadTrack` from the Downloads page would be worse for two reasons. It needs a `FullTrack`, and the page only has `OfflineTrackSummary` mapped through `toOfflineTrackListItemTrack`, which hard-codes `format: "mp3"` (`to-offline-track-list-item-track.ts:16`). `downloadTrack` then derives the stored format from that fabricated list (`getOfflineAudioFormat`, `offline-track-summary.client.ts:6-9`; `storeTrack` writes it at `offline-storage.client.ts:194,208-214`). A queue-cached non-mp3 track would be re-fetched and recorded as `mp3`. I read this from the code; I haven't reproduced it. The same latent issue already affects the existing per-row "Download for offline" action on these rows. It is out of scope to fix, but it is flagged in the risks (R5).
- Implementation: new `OfflineStorage.pinQueueCachedTracks(): Promise<{promotedCount: number}>`. For each summary in `metadataStore.list()`: `get` the record, skip if not queue-only, skip (and `delete` the record, like `hasTrack` at `:366-369`) if `audioStore.has` is false, then `put(mergeOfflineTrackRecord(record, {isPinned:true}))`. Keep `isQueueCached` as is; "both flags" is already a supported state (`purge` test at `offline-storage.client.test.ts:606-619`).
- Concurrency: `storeTrack` serialises per track id through `trackLocks` (`:161-178`). A metadata-only `get -> put` outside that lock could overwrite a concurrent re-download's record (the player auto-caches continuously). Extract `withTrackLock(trackId, fn)` from `storeTrack` and run the promotion for each track inside it.
- Storage implication: zero new bytes now. But the promoted tracks leave the evictable set. `ensureCapacity` only counts queue-only bytes as reclaimable (`:129-134`) and the eviction candidates are queue-only (`pin-policy.ts:8-26`), so later downloads and auto-cache writes will hit `OfflineStorageQuotaError` sooner. The confirm dialog must show the total size being locked in (sum of `fileSizeBytes` over the queue-only summaries, which are already on the page).
- Side effects the user should know about: pinned tracks appear in offline `/library` (`listPinned`, `offline-route-policies.client.ts:168`) and satisfy the offline-play ownership gate (`audio-player-provider.tsx:104-110`, `isPinned -> true`). That is already true of every single-track download and playlist download, so it isn't a new class of exposure, only a larger set.
- UI: `AlertDialog`, mirroring the purge dialog (`downloads.tsx:120-153`). Button label "Download all auto-cached"; dialog title "Download N auto-cached tracks?"; description "This keeps N tracks (X MB) on this device. They won't be cleared automatically — remove them from the list when you no longer need them."; action "Download all". Toast on success. Place it beside "Clear auto-cached tracks", inside the same bordered card (`downloads.tsx:100-155`). That card is rendered only when `userId` is set (`:100`); keep it, and note the pre-existing consequence that both buttons are hidden when there is no user.

Option (ii), library-wide download: **out of scope**. It needs client-side enumeration of the whole library (paged, server-side), `FullTrack` payloads, a serial or limited-concurrency fetch of every file, a quota policy (the current eviction would thrash the queue cache), progress and cancel UI, and resume after reload. Cut it as a follow-up issue and reuse the loop in `offline-playlist-download-button.tsx:54-105` as its template.

### D. Rename "pinned" (user-visible copy only)

Enumeration. A grep of `app/**/*.{ts,tsx}` for `\bpin(ned|s|ning)?\b` finds user-visible copy in **only three places, all in `app/routes/downloads.tsx`**. Everything else is internals, comments, test names, or unrelated uses ("pinned to a trusted origin", karaoke "pin the video version"):

| Location                                | Before                                                                                                                                                                                   | After                                                                                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `downloads.tsx:90-91` (header)          | `{stats.pinnedCount} pinned · {stats.trackCount} total cached · {usedMb} MB{quota} on this device.`                                                                                      | `{downloadedCount} downloaded · {queueOnlyCount} auto-cached · {usedMb} MB{quota} on this device.` Both counts come from `tracks`, not `stats` (see below).                                                                                                         |
| `downloads.tsx:113-115` (checkbox help) | `While listening online, cache the current track and upcoming queue tracks on this device for continuity. Turning this off stops new auto-cache writes; pinned downloads are unchanged.` | `While you listen online, save the current track and the upcoming queue on this device so playback keeps going. Turning this off stops new auto-caching. Your downloads are never removed automatically, and tracks already auto-cached stay until you clear them.` |
| `downloads.tsx:135-137` (purge dialog)  | `This removes N auto-cached track(s) from this device. Pinned offline downloads are kept.`                                                                                               | `This removes N auto-cached track(s) from this device. Your downloaded tracks are kept.`                                                                                                                                                                            |

Why derive counts from `tracks` and not `stats`: `clientLoader` runs `listDownloaded()` and `getStorageStats()` in parallel (`downloads.tsx:30`). `listDownloaded` prunes records whose OPFS bytes vanished (`offline-storage.client.ts:275-291`), while `getStorageStats` counts raw metadata (`:385-395`). The header could then disagree with the rows and the new badges. Keep `usedMb` from `stats`. `stats.pinnedCount` stays in the API unchanged.

Other strings, checked and left alone:

- Hook labels are already on-brand: "Download for offline", "Remove offline download", toasts "Downloaded for offline" / "Removed download" (`use-offline-track-download.ts:17,37,40`).
- `offline-library-view.tsx:49` copy ("No downloaded tracks available offline...") needs no change.
- Code comments mentioning "pin" (`track-list-item.tsx:125`, `use-track-audio-file-download.ts:7`, `offline-playlist-download-button.tsx:76`) are internal. Optionally reword the first (it is next to a prop I'm editing); don't churn the rest.
- `tests/e2e/offline.test.ts:135,188` only mention "pin" in comments. Docs: `docs/CONTEXT.md:199-209` and `docs/AUDIO_PLAYER_AND_QUEUE.md:414` keep the domain terms (Q4) and gain the UI-label note.

## 5. Not in scope

- Renaming `isPinned`, `pinnedCount`, `pinnedAt`, `pin:`, `listPinned`, `pin-policy.ts`, or any test names.
- Library-wide "download everything offline" (Q1 option ii) and any selection-mode bulk download (Q2).
- Fixing the `mp3` hard-coding in `toOfflineTrackListItemTrack` (R5).
- Changing eviction policy, quota headroom, the queue-cache preference storage, or the purge behaviour.
- Redesigning the Downloads layout beyond the card and the pill.
- A new ADR (this is a UI/copy change plus one small storage method).

## 6. Step-by-step plan (TDD: failing test first, then code)

Each step ends green. Format with the repo formatter (oxfmt, per `953c33d7`).

0. **Reproduce the checkbox (no code change).** Start the dev server (`npm run dev:youtube-mocks`, Node 24, login `kody` / `kodylovesyou`) and, in Playwright or a headed browser on `/downloads`, record: `svg.getBoundingClientRect()` inside `[data-slot="checkbox-indicator"]`, `getComputedStyle(path).stroke`, and a screenshot in light and dark. Note the result in the PR description. If the check is clearly visible, the fix below is still applied (hairline glyph), and U6 becomes a regression guard.

1. **`getOfflineStorageKind` helper.**
   - Test first: `app/features/offline-storage/pin-policy.test.ts`. Cases: pinned only, pinned + queue-cached (-> `"downloaded"`), queue-only (-> `"auto-cached"`), neither (-> `null`). Also assert `isQueueOnlyOfflineTrack` accepts an `OfflineTrackSummary`.
   - Code: `pin-policy.ts`. Widen both functions' parameter to `Pick<OfflineTrackRecord, "isPinned" | "isQueueCached">` and add `getOfflineStorageKind`.

2. **`pinQueueCachedTracks`.**
   - Tests first, in `app/features/offline-storage/offline-storage.client.test.ts` (reuse the `createOfflineStorage({audioStore, metadataStore, fetchAudioBytes, ...})` harness at `:44-60`, `:592-621`):
     - promotes only queue-only records (`isPinned` true, `pinnedAt` set, `isQueueCached` unchanged);
     - `fetchAudioBytes` is never called;
     - pinned and pinned+queued records are untouched;
     - a record whose bytes are missing from the audio store is not promoted and is removed;
     - second call returns 0;
     - `purgeQueueCache()` afterwards removes 0 of the promoted tracks, and `getStorageStats().pinnedCount` grew;
     - tight-quota case, using `tightEstimate` at `:30-35`, as in the existing eviction test at `:271-300`: a download that previously evicted a queue-only track now throws `OfflineStorageQuotaError` after promotion;
     - a concurrent `downloadTrack` for the same id and the promotion serialise (final record is pinned with the new `fileSizeBytes`).
   - Code: `offline-storage.client.ts`. Extract `withTrackLock`, reuse it in `storeTrack`, add the method to the `OfflineStorage` type (`:37-57`) and implementation. Update the mock shapes in tests that build a partial `OfflineStorage` only if the type forces it.

3. **Checkbox glyph.**
   - Test first (new): `app/components/ui/checkbox.test.tsx`, jsdom. Checked: the indicator contains an `svg` with class `size-3.5` whose path has `stroke="currentColor"`, a stroke width >= 1.5 and `aria-hidden`. Unchecked: no indicator. jsdom can't prove pixels, so U6 is covered by step 8.
   - Code: `checkbox.tsx:26-28`.

4. **`TrackListItem` props.**
   - Tests first, in `app/components/track-list-item.test.tsx` (model on the "Archiving" tests at `:242-254`): `offlineStorageKind="downloaded"` renders "Downloaded"; `"auto-cached"` renders "Auto-cached"; undefined renders neither; the badge is a sibling of the title and does not start playback when clicked. Plus: with `offlineDownloadTrack` set and `onOfflineDownloadChange` provided, a successful toggle from the desktop menu calls it once (mock `getOfflineStorage` as the existing file does); a failed toggle does not.
   - Code: `track-list-item.tsx`. Add both props, render the pill at `:541`, thread the callback into `OfflineDownloadDropdownItem` and `OfflineDownloadSheetButton`, and call it from `useOfflineTrackDownload` after the `refresh()` at `use-offline-track-download.ts:42` (add an optional third argument; keep it out of the `useCallback` deps churn by wrapping with `useRef` or documenting that the caller must pass a stable callback).

5. **`OfflineLibraryView`.**
   - Tests first (new): `app/components/offline/offline-library-view.test.tsx`. Mock `@tanstack/react-virtual` (fixed virtual items; jsdom has no layout, see how `library.index.ui.test.tsx:196` handles the virtual spacer) and mock `TrackListItem` to capture props. Assert: `showStorageBadge` off -> `offlineStorageKind` undefined; on -> correct kind per track; `onOfflineDownloadChange` is forwarded.
   - Code: `offline-library-view.tsx:15-31`.

6. **Downloads route.** (Needs Q1 confirmed.)
   - Tests first (new): `app/routes/downloads.test.tsx`, jsdom, `createMemoryRouter` like `track-list-item.test.tsx:1-80`; mock `getOfflineStorage`, `useOptionalUser` (a user id), and `OfflineLibraryView` as a stub that records props. Assert:
     - header copy matches U2 and the text "pinned" is absent from the whole document;
     - help text and purge dialog text match section 4.D;
     - "Download all auto-cached" is disabled when there are no queue-only tracks;
     - enabled: it opens the dialog showing the count and a formatted size;
     - confirming calls `pinQueueCachedTracks` once, toasts, and calls `revalidate`;
     - an error from `pinQueueCachedTracks` toasts the destructive variant and keeps the dialog usable;
     - toggling the checkbox calls `setQueueCacheEnabled(userId, false)` and the box reports `aria-checked="false"`.
   - Code: `downloads.tsx`.
     - copy changes (section 4.D);
     - `downloadedCount`; replace the inline queue-only filter at `:55` with `isQueueOnlyOfflineTrack`;
     - the bulk button, dialog and handler (copy the purge handler's shape, `:63-82`);
     - pass `showStorageBadge` and a stable `onOfflineDownloadChange` to `OfflineLibraryView`;
     - optional "On"/"Off" status text beside the checkbox.

7. **Docs.** `docs/CONTEXT.md` Pinned Download (`:205`) and Queue Cache (`:207`): add "shown to users as _Downloaded_ / _Auto-cached_", and add a line for the new "promote auto-cached tracks" action. Add the same note to `docs/AUDIO_PLAYER_AND_QUEUE.md:414`. `docs/decisions/013-pwa.md:135` ("pinned + queue-cached tracks") needs no change.

8. **E2E and validation.**
   - New `tests/e2e/downloads.test.ts` (model on `tests/e2e/offline.test.ts`; the only existing coverage is the `/downloads` smoke in `tests/e2e/ssr-hydration.test.ts:58`): log in, open `/downloads`, assert the checkbox indicator svg's bounding box is >= 10px wide and tall when checked, and that no text matches `/pinned/i`. Seed one auto-cached and one downloaded track through the page's own IndexedDB if feasible; if not, keep this spec to the checkbox and copy checks and rely on the unit tests for badges.
   - Run `npm run typecheck`, `npx vitest run` on the files above, `npm run lint`, `npm run test:e2e:run -- tests/e2e/downloads.test.ts`.

## 7. Files likely to change

- `app/routes/downloads.tsx`
- `app/components/offline/offline-library-view.tsx`
- `app/components/track-list-item.tsx`
- `app/hooks/use-offline-track-download.ts`
- `app/components/ui/checkbox.tsx`
- `app/features/offline-storage/pin-policy.ts`
- `app/features/offline-storage/offline-storage.client.ts`
- Tests: `app/features/offline-storage/pin-policy.test.ts`, `app/features/offline-storage/offline-storage.client.test.ts`, `app/components/track-list-item.test.tsx`, plus new `app/components/ui/checkbox.test.tsx`, `app/components/offline/offline-library-view.test.tsx`, `app/routes/downloads.test.tsx`, `tests/e2e/downloads.test.ts`
- Docs: `docs/CONTEXT.md`, `docs/AUDIO_PLAYER_AND_QUEUE.md`

Untouched on purpose: `types.ts`, `metadata-store.client.ts`, `queue-cache-preference.client.ts`, `offline-route-policies.client.ts`, `library.index.tsx`.

## 8. Tradeoffs

- **T1. Badge as a primitive prop vs `itemActionsContent`.** `itemActionsContent` needs no change to `TrackListItem` but lands after the ⋯ menu and costs mobile width. A primitive prop keeps `memo` effective and puts the tag by the title, at the price of one more offline-aware prop on a large component.
- **T2. Inline svg vs `Icon name="check"`.** `Icon` matches `select.tsx:120` and the app's sprite convention, but depends on the external sprite resolving (ADR-008); the inline svg works offline and during hydration recovery. Cost: a hand-drawn path that must be sized explicitly.
- **T3. Checkbox vs `Switch`.** `Switch` shows state with no glyph and is semantically right for an instant on/off preference, but the user asked about the check icon and the checkbox is the shared component other screens also benefit from fixing. Decide with Q3.
- **T4. Metadata-only promotion vs looping `downloadTrack`.** Promotion is instant, offline-capable and byte-neutral, and avoids the mp3-format hazard, but it adds a method plus a lock refactor to the storage layer. It also keeps `isQueueCached` true, so "both flags" records multiply (already a supported state).
- **T5. Counts from `tracks` vs `stats`.** `tracks` agrees with what the user sees; `stats.pinnedCount` is cheaper but can disagree after OPFS pruning.
- **T6. Extra `onOfflineDownloadChange` plumbing.** It fixes a real staleness bug and keeps badges honest, but touches a hook and a memoised component; the callback must be stable.

## 9. Risks and mitigations

- **R1. Checkbox cause not confirmed.** _Mitigation:_ Step 0 repro; the fix removes the only under-specified property (svg size) and thickens the glyph; the e2e measures the real box.
- **R2. Pinning N tracks permanently removes them from the evictable pool** and can make future downloads fail with `OfflineStorageQuotaError`. _Mitigation:_ confirm dialog states count and MB; test S4 documents the behaviour; no change to eviction policy.
- **R3. Promotion races with the player's auto-cache.** _Mitigation:_ `withTrackLock` extraction and a concurrency test; note that `purgeQueueCache` and `removeTrack` already run without the lock (pre-existing, not changed).
- **R4. Promoted tracks become visible in offline `/library` and pass the offline-play ownership gate** (`audio-player-provider.tsx:109`). Queue-cached tracks may come from sources outside the user's library. _Mitigation:_ identical to existing playlist-download behaviour; the dialog says the tracks are kept as downloads; call it out in the PR description.
- **R5. Latent `mp3` hard-coding on re-download** (`to-offline-track-list-item-track.ts:16`) affects the existing per-row "Download for offline" action on auto-cached rows and was read from code, not reproduced. _Mitigation:_ the bulk action deliberately avoids `downloadTrack`; file a follow-up issue rather than expanding this change.
- **R6. Virtualised list tests in jsdom.** There is no layout, so `useWindowVirtualizer` returns no items. _Mitigation:_ mock the virtualizer as in step 5.
- **R7. Header and badge disagreement.** _Mitigation:_ derive all counts from `tracks`; covered by U2.
- **R8. Copy drift.** A future "pinned" in UI copy. _Mitigation:_ the step-6 test asserts the document contains no `/pinned/i`.

## 10. Recommended approach

Build it in this order: (1) `getOfflineStorageKind`, (2) `pinQueueCachedTracks` as a locked, metadata-only promotion, (3) an explicit-size, thicker inline-svg checkbox glyph (after a real-browser repro, because static analysis could not prove the invisibility), (4) a primitive `offlineStorageKind` prop on `TrackListItem` that renders a "Downloaded" / "Auto-cached" pill, opt-in from `OfflineLibraryView` and enabled only on `/downloads`, plus the `onOfflineDownloadChange` revalidation hook, (5) the Downloads page: three copy replacements in `downloads.tsx` only (header `N downloaded · M auto-cached · X MB`, two help strings), and a "Download all auto-cached" button with a confirm dialog that shows the size being locked in. Interpret "download them all" as promoting auto-cached tracks (Q1, confirmed with the user); defer a library-wide download to a separate issue. Leave every internal `pin*` identifier alone and record the UI labels in the glossary.

## 11. Play button on Downloads page does nothing (separate root cause, same PR)

### Root cause (verified)

Clicking play on a Downloads-page row calls `playTrack(track, { type: "library" }, index)` (`offline-library-view.tsx:27` → `track-list-item.tsx:377-394` → `audio-player-provider.tsx:878-886`). `startSpinePlayback` builds the spine via `loadSpineForContext`; when the spine is empty it falls to `buildOwnedSingleTrackSpine`, whose `library` branch returns null unless `userOwnsLibraryTrack(track.id, isOnline)` is true (`:621-633`).

- **Pinned track:** plays (spine contains it, or `userOwnsLibraryTrack` accepts `isPinned` at `:109`).
- **Auto-cached (queue-only) track:** offline — never plays: `buildOfflineSpine` lists `listPinned()` only (`:563`), and the library fallback fails. Online — usually plays _if_ the server's `/api/tracks/playback` gate (`buildUserTrackAccessWhere`, `queue-playback.server.ts:53-86`) passes; fails silently (no toast — `playTrack` drops the boolean at `:883`) when the server denies access or is unreachable.

Two existing tests block the naive fixes: `audio-player-provider.test.tsx:3768` (queue-cache-only row must NOT be library-owned) and `:3630` (offline library spine uses `listPinned`, never `listDownloaded`). Relaxing the library gate or switching the library spine to `listDownloaded` breaks them.

### Fix: a dedicated `downloads` play context

- Add `{ type: "downloads" }` to `PlaylistContext` (`audio-player-play-context.ts:32-49`) + `case "downloads": return true` in `isSamePlayContext`.
- `toQueueSpineContext` / `playContextToJson` already return null for unknown types → online play skips the server spine and goes to `buildOfflineSpine` with no `loadSpineForContext` change.
- In `fetchOfflineTracks` (`:558-566`), use `listDownloaded()` for the `downloads` context (listDownloaded already prunes records with missing OPFS bytes, `offline-storage.client.ts:275-291`).
- The existing non-library fallback `offlineHasTrack` (`:629`) covers a row that disappears mid-session.
- Add a `"downloads"` label in `queue-sheet-ui.ts`; widen the `type` union at `track-list-item.tsx:90`; add a `playContextType` prop to `OfflineLibraryView`; set `playContextType="downloads"` in `downloads.tsx:167`.
- Bonus fix: `currentIndex` is a spine index (`:329-350`) but the row compares it to its list index (`track-list-item.tsx:372-374`), so a playing Downloads row never shows as current and re-clicking restarts. A downloads spine in list order fixes it.

### Tests (TDD)

In `audio-player-provider.test.tsx` (pattern `:3492-3555`): offline `downloads` context plays a queue-only track (spineTotal 2, `listDownloaded` called); online `downloads` context makes no `/api/queue-spine` or `/api/tracks/playback` call; explicit index → `currentIndex` matches row; track with no local bytes doesn't start; existing `:3484`, `:3630`, `:3692`, `:3768` stay green. Plus small additions to `audio-player-play-context.test.ts`, `queue-sheet-ui.test.ts`, `offline-library-view.test.tsx`, `downloads.test.tsx`.

### Known limits

- A `downloads` queue isn't restored after reload (no `PlayContextJson` entry) — acceptable for now.
- A track removed from the library stays playable from Downloads until removed locally.

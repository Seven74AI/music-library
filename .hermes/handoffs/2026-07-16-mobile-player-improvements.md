# Handoff: Mobile Player UI Improvements

**Date:** 2026-07-16
**Repo:** `~/projects/music-library` (Seven74AI/music-library fork → mnlamart/music-library upstream)

## Status

| # | Feature | Status | PR |
|---|---------|--------|-----|
| 1 | Marquee scrolling text (title/artist) | ✅ **MERGED** | #203 |
| 2 | Remove search auto-focus (add-to-playlist) | ✅ **MERGED** | #202 |
| 3 | Swipe-to-skip (next/prev on mobile) | ✅ **MERGED (fork)** → **upstream PR #89** | #204 |

## Completed

### #1 — Marquee Text (#200)
- New `<MarqueeText>` component with `ResizeObserver` overflow detection
- CSS `@keyframes marquee-scroll` animation (1s delay → 3s scroll → snap back)
- Wired into all 3 player surfaces: mini-bar, now-playing sheet, desktop bar
- Unit tests in `app/components/marquee-text.test.tsx`
- Global `ResizeObserver` mock in `tests/setup/setup-test-env.ts`
- Branch: `feat/marquee-text` → PR #203 → merged

### #2 — Remove Auto-focus (#201)
- Removed `autoFocus={!isCreating}` from search input in `add-to-playlist-menu.tsx:181`
- Prevents mobile keyboard from opening when sheet appears
- Branch: `feat/remove-search-autofocus` → PR #202 → merged

## Next: Swipe-to-skip (#199)

Design decisions from earlier discussion:
- Mini-bar only (49px threshold)
- Drag-to-reveal visual feedback
- No response when no track loaded
- No direction lock — natural swipe feel
- `<SwipeGesture>` hook as test seam

### Proposed approach
1. Create `app/hooks/use-swipe-gesture.ts` — touch event handler with threshold
2. Wire into mini-bar in `app/components/audio-player.tsx`
3. Unit tests for the hook + integration tests for the player

### Key files to modify
- `app/components/audio-player.tsx` — add swipe to mini-bar div
- `app/hooks/use-swipe-gesture.ts` — new hook (create)
- Tests mirroring the existing `audio-player.test.tsx` patterns

### Branch naming
`feat/swipe-to-skip` on fork, PR to main

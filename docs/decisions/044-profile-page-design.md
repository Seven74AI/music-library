# ADR-044: Profile Page Design Refresh

## Status

Accepted

**Date:** 2026-11-19

**Supersedes (in part):** [ADR-043](./043-profile-stats-privacy.md) — its non-goal "recently played … on the profile", and its definition of `ProfilePrivacy` as exactly three fields.

## Context

The public profile (`/users/:username`) was a single centered column of flat text lists, and `/settings/profile` was one undifferentiated column with three bare checkboxes. Heavy Rotation (ADR-026) and Recently Played (ADR-025) already exist as modules but were absent from the profile.

## Decision

### Public profile layout

- **Header card** (`bg-muted rounded-3xl`): avatar, display name, "Joined" date, and a compact totals stat row (completed plays, library size, listening time). Totals semantics are unchanged from ADR-043: rendered only when `totals` is present and at least one metric is non-zero; the owner sees a "Totals: hidden from visitors" placeholder when the block is off. Edit profile and logout stay in the header.
- **Sections grid** below: `grid grid-cols-1 gap-8 md:grid-cols-2` with Top tracks, Top artists, Heavy rotation, Recently played. Top tracks/artists remain static rows, restyled as cards.

### Module choice

- Heavy rotation: `getHeavyRotationTracks({ window: "month", limit: 10 })`. Recently played: `getRecentlyPlayedTracks({ limit: 10 })`. No new server helpers.
- Rendered with a profile-specific grid of `HomeRecentTrackCard`, **not** `HeavyRotationStrip` / `RecentlyPlayedStrip`: those bake in "View all" / "View history" links, and `/history` is owner-gated. Each card sits in a grid cell that forces `w-full` because the card hardcodes the strip width.
- **Window and cap**: the month window matches the listening-hub default; the cap of 10 (hub: 50 / 20) keeps the profile scannable. No time-range control on the profile.
- **Playback** remains owner-gated (`/resources/audio.$trackId` requires auth and track access). Visitors see the same cards but cannot play them; this is accepted and not claimed otherwise.
- Empty data hides a section entirely; a disabled block shows the existing owner-only placeholder.

### Privacy extension (3 → 5 fields)

- `ProfilePrivacy` gains `showHeavyRotation` and `showRecentlyPlayed` (`Boolean @default(true)`), added by an additive hand-written migration (`20261119000000_add_profile_privacy_show_blocks`). Public by default; a missing row still means all public.
- The loader skips the query and omits the key for a disabled block (data-time enforcement, as in ADR-043); `hiddenBlocks` (owner only) gains both keys.

### Settings

- Grouped into carded sections: Profile photo / Account / Privacy / Security / Data.
- Privacy checkboxes become Radix `Switch` toggles (five). A Radix switch is a `<button role="switch">` and submits nothing, so each is paired with a hidden input carrying the existing `"on"`/absent contract (`z.preprocess(v => v === "on", z.boolean())`). Without it every toggle would silently persist `false`. A round-trip test guards this.

## Supersession of ADR-043

- ADR-043 listed recently played on the profile as a non-goal; that is reversed.
- ADR-043 defined `ProfilePrivacy` with three fields; it has five.

## Non-goals

- Weekly wrap, full history, on-repeat on the profile.
- Time-range controls; playable or card-tiled top tracks/artists.
- Privacy finer than per-block.

## Consequences

- Profiles expose two more blocks by default (owners can opt out per block).
- Two more queries per profile view, each capped at 10.

# ADR-045: User playlist visibility (Public / Private / Unlisted)

## Status

Accepted

## Context

User playlists were owner-only: `playlists.$playlistId` required login and filtered by `ownerId`, and
`UserPlaylist` had no sharing concept. Users could not share a curated playlist, and the public
profile ([ADR-043](./043-profile-stats-privacy.md), [ADR-044](./044-profile-page-design.md)) showed
stats but no playlists.

## Decision

### Visibility

`UserPlaylist.visibility` is a Prisma enum `Visibility { PRIVATE PUBLIC UNLISTED }`, default
`PRIVATE` (SQLite TEXT, additive hand-written migration).

- **PRIVATE** — owner only. Everyone else, including logged-out visitors, gets a **404** (no
  existence leak).
- **PUBLIC** — listed on the owner's profile "Playlists" block; viewable by anyone; playable and
  downloadable by any logged-in user.
- **UNLISTED** — never listed; viewable by anyone with the link; playable and downloadable by any
  logged-in user.

**Default private** so a user's taste is never exposed before they choose to share. New playlists
rely on the schema default; create helpers carry no visibility wiring.

### Playback / download grant

A track that appears in **any** PUBLIC or UNLISTED playlist is streamable and downloadable by
**every logged-in user**, regardless of which playlist they navigated from (the YouTube model). This
keeps the access check stateless. Consequence, stated plainly: **UNLISTED protects discovery, not
access** — a track in an unlisted playlist is reachable by any logged-in user who knows the track
id, with or without the link. Download is intentionally in scope (owner confirmed).

The rule lives in one module, `app/utils/shared-playlist-access.server.ts`, reused by the three
seams that enforce playback access:

1. `track-ownership.server.ts` (stream + download routes). Prisma allows one include per relation,
   so the shared clause is an `OR` inside the existing `playlists` fragment rather than a separate
   `sharedPlaylists` key.
2. `queue-playback.server.ts` `buildUserTrackAccessWhere`.
3. `queue-spine.server.ts` whole-playlist play: the `playlist: { ownerId }` filter becomes
   owned-or-shared; the track access predicate still applies.

The audio routes stay `requireUserId`-gated, so anonymous callers never get audio.

### Detail route

`playlists.$playlistId` loader is auth-optional (`getUserIdOrNull`), fetches without an owner
filter, then branches: not found → 404; owner → editor payload + `visibility`; non-owner PRIVATE →
404; non-owner PUBLIC/UNLISTED → read-only payload. The read-only payload keeps `playlist.title`
(breadcrumb), **omits `audioFiles.objectKey`** (no S3 keys for visitors), has **no `playlists`
list** (owner-scoped), and carries owner display info. Mutations remain owner-only
(`requireUserId` in the action; `update-visibility` is scoped by `{ id, ownerId }` and treats
Prisma P2025 as a no-op). The read-only UI is a separate `ReadOnlyPlaylistTrackList` rather than
read-only props threaded through `SortableTrackList`/`TrackListItem`, which hardcode mutation
affordances.

### Profile block

`ProfilePrivacy.showPlaylists` (default `true`) gates a "Playlists" block listing the owner's
**PUBLIC** playlists (title + track count). The query is skipped when off (privacy at data time).
The profile never lists UNLISTED/PRIVATE playlists, even for the owner.

**Wrinkle:** `showPlaylists = false` with a `PUBLIC` playlist makes that playlist link-only — it
behaves like unlisted while still labelled Public.

## Non-goals

- Global `/search` over public playlists (playlist search stays owner-scoped).
- Collaborative editing or "add to my library" from a shared playlist.
- Anonymous playback/download (view only).
- Link rotation/expiry for unlisted links (the `cuid` id is the link).
- Playlist cover thumbnails on the profile block.

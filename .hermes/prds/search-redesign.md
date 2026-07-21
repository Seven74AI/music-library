# PRD: Search Redesign

## Problem Statement

The search functionality is incomplete. A dedicated `/search` page exists with FTS5 indexes covering tracks, albums, and artists, but:

- Search is not scoped to the user's library — it searches the entire database globally
- Playlists are not searchable
- The search experience is a page navigation, not an inline overlay
- The nav header has a misplaced search bar
- There is no persistent bottom navigation
- Artist renames leave stale data in track/album FTS indexes

## Solution

Redesign search to be a Spotify-like experience: library-scoped, inline overlay results as you type, user playlists included, persistent bottom navigation bar, and fixed FTS maintenance.

## User Stories

1. As a user, I want search results to only include tracks, albums, and artists that are in my personal library, so I don't see other users' content
2. As a user, I want to find tracks by typing all or part of the track title in the search bar
3. As a user, I want to find albums in my library by typing the album name
4. As a user, I want to find artists in my library by typing the artist name
5. As a user, I want to find my user playlists by typing the playlist name
6. As a user, I want to see all result types (tracks, albums, artists, playlists) in a single unified list sorted by relevance
7. As a user, I want to filter results by type — All, Tracks, Albums, Artists, or Playlists — using a type selector
8. As a user, I want search results to appear automatically as I type, without pressing Enter
9. As a user, I want search results to display in a full-screen overlay that covers the page content while searching
10. As a user, I want a cancel button on the right side of the search bar to dismiss the overlay and return to the previous view
11. As a user, I want to see my recent searches displayed when I open the search page before typing anything
12. As a user, I want my recent searches to persist across sessions via local device storage (localStorage)
13. As a user, I want a persistent bottom navigation bar with four buttons: Home, Search, My Library, My Playlists
14. As a user, I want each bottom nav button to show an icon and a label underneath
15. As a user, I want the currently active tab in the bottom nav to be visually highlighted
16. As a user, I want to click a search result and navigate to the corresponding page (track/artist/playlist)
17. As a user, I want each search result to display Spotify-style metadata: artist + album name for tracks, artist for albums, genre for artists, track count for playlists
18. As a user, when I haven't typed a query, I want to see an empty/ready state without results
19. As a user, when no results match my query, I want to see a "no results found" message
20. As a user, I want to load more results when available (pagination)
21. As a user, I want results to support prefix matching so "met" matches "Metallica" or "Metal"
22. As a user, I want the search to handle special characters safely without breaking
23. When an artist renames, the track and album FTS indexes should automatically update to reflect the new name

## Implementation Decisions

### Library scoping

Search queries join through the `UserTrack` table to filter results to the current user's library. Tracks join directly on `UserTrack.trackId`. Albums and artists are filtered indirectly — only albums/artists that have at least one track in the user's library appear. No new FTS tables are created.

### Playlist search

Playlists are searched with a plain SQL `LIKE '%query%'` on `UserPlaylist.name`, filtered by `userId`. No FTS table is created for playlists — the dataset is small enough that LIKE is sufficient.

### Artist rename cascade

A new `AFTER UPDATE ON Artist` trigger updates `tracks_fts` and `albums_fts` rows when an artist's name changes, ensuring search results stay consistent.

### Search page UX

- New component replaces the existing `SearchBar` component (old one deleted)
- Full-screen overlay appears when user types in the search input
- Results update on debounced input (400ms)
- Cancel button on the right of the search bar dismisses the overlay
- Type filter selector (All / Tracks / Albums / Artists / Playlists)
- Recent searches loaded from localStorage, displayed before user types
- Unified mixed-result feed sorted by relevance, Spotify-style metadata per result type
- Pagination support (load more)

### Bottom navigation bar

- New persistent component with four tabs: Home, Search, My Library, My Playlists
- Each tab shows an icon + label
- Active tab visually highlighted
- Appears on every page
- Search bar removed from the header nav

### Data flow

- `searchAll(query, userId, limit, type)` — library-scoped via JOIN
- `searchPlaylists(name, userId)` — LIKE query
- `searchTracks/searchAlbums/searchArtists` — updated with userId parameter
- Cache layer (5-min TTL via cachified) retained
- FTS5 prefix matching retained
- Input validation via Zod retained

### Schema changes

- New trigger: `AFTER UPDATE ON Artist` → refresh `tracks_fts` + `albums_fts`

## Testing Decisions

### What makes a good test

Test external behavior only — what the user sees and what the API returns. Do not test FTS internals, trigger implementation details, or component state.

### Test seams

**Unit tests (vitest):** Search engine functions

- `searchAll` returns only library-scoped results for a given userId
- `searchPlaylists` returns matching user playlists
- `searchTracks/searchAlbums/searchArtists` respect userId scoping
- Artist rename propagates to FTS results
- Empty query returns empty results
- Prior art: `app/utils/search.test.ts`

**API integration tests (vitest + supertest):** Search endpoint

- Authenticated user gets scoped results via `/api/search`
- `?type=playlists` filter returns only playlists
- Empty query returns empty results
- Invalid parameters return 400
- Prior art: `app/routes/api+/search.test.ts`

**E2E tests (Playwright):** Search page + bottom nav

- Overlay opens on typing, dismisses on cancel button
- Results update as user types (debounced)
- Type filter selects/deselects categories
- Clicking result navigates to correct page
- Recent searches appear from localStorage
- Bottom nav bar visible on all pages
- Active tab highlighted correctly
- Prior art: `tests/e2e/search.test.ts`

## Out of Scope

- YouTube/external service content search
- Playlist track title indexing (searching for a track inside a playlist by that track's title)
- Server-side recent searches or search history sync
- Global search bar in the header/nav
- Non-library-scoped search (admin "search all users" mode)

## Further Notes

- The existing `SearchBar` component at `app/components/search-bar.tsx` will be deleted and replaced
- The nav header search bar (in `app/root.tsx`) will be removed
- The bottom nav bar replaces the header search bar as the primary navigation
- FTS5 triggers and migration are already in place; only the artist rename cascade trigger needs to be added
- The search cache (`search-cache.server.ts`) may need its cache key updated to include userId for proper scoping

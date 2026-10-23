# PR #324 consolidation — review feedback addressed

Source branch: `feat/t_a733486f`  
Consolidation branch: `consolidate/p3-debt-324-a11y`  
Reviewer: `hermes-sevenai-reviewer` (CHANGES_REQUESTED on commit `c450205`)

Most of PR #324’s component-level a11y changes are already on `main` (merged ahead of this consolidation branch). This branch carries the remaining deltas from `feat/t_a733486f` plus the documentation below.

## Review item 1 — TrackListItem `listitem` vs parent containers

| Concern                                                                    | Resolution                                                                                                                              |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Album/artist/related pages used `role="grid"` while rows became `listitem` | `albums.$albumId.tsx`, `artists.$artistId.tsx`, `library.$trackId.tsx` now use `role="list"` with matching `aria-label`.                |
| `library.index.tsx` lacked `role="list"` on the virtual list wrapper       | Virtual list wrapper uses `role="list"`; spacers use `role="presentation"`.                                                             |
| Nested `listitem` in sortable playlists (outer + inner TrackListItem)      | `SortableTrackItem` passes `listRole="presentation"` to inner `TrackListItem`; outer row keeps `role="listitem"`.                       |
| Search results: track rows without `role="list"` parent                    | Mixed feed wrapped in `role="list"`; non-track entity rows use `role="listitem"`; track section uses presentation spacers where needed. |
| Discover virtual list alignment                                            | `discover.index.tsx`: `role="list"`, presentation spacers, `aria-hidden` header.                                                        |
| E2E selectors updated to match tree                                        | E2E tests use `getByRole("listitem", …)` instead of `gridcell` where track rows are list items.                                         |
| Presentation rows must not expose redundant `aria-label`                   | `TrackListItem` omits `aria-label` when `listRole="presentation"` (nested under sortable / on-repeat rows).                             |

## Review item 2 — Unrelated refactors bundled in diff

| Concern                                     | Resolution                                                                                                                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server/API/test refactors beyond a11y scope | Removed in commit `cb1b9d9` (`refactor: split non-a11y conformance/type-safety/test refactors out of a11y PR`). Consolidation diff is component-level a11y/HTML validity only (36 files). |

## Changes confirmed correct (reviewer reference — preserved)

- ToastClose sr-only "Close"
- Dropdown submenu/radio indicators via Icon/SVG + `aria-hidden`
- Contextual `aria-label`s on queue claim/unclaim/resolve and room-queue remove
- AlertDialog replaces `confirm` in curator-notes (reply delete → `handleDeleteReply`)
- Finite `UNKNOWN_DURATION_MAX` on audio range `max` (not `Infinity`; lives in `player-controls.tsx` after audio-player module split)
- Reports-charts decorative SVG + sr-only data lists
- Autocomplete/genre combobox: `listbox`/`option`, `aria-expanded`/`aria-controls`/`aria-activedescendant`, keyboard nav, `useId` ids (including genre-selector listbox id on this branch)

# PR #324 a11y consolidation (`consolidate/p3-debt-324-a11y`)

Base: `origin/main` at `2721c79` (2026-10-23).

Source branch: `feat/t_a733486f` (PR #324 — fix(a11y): accessibility issues P3 sweep).

## Approach

- Reset consolidation branch from latest `origin/main` (replacing an earlier consolidation attempt that incorrectly included audio-player refactor reversions).
- Cherry-picked a11y-only commits from `feat/t_a733486f` where they still applied cleanly.
- Did **not** merge `feat/t_a733486f` into `main` or any other integration branch.

## Commits applied

| Commit    | Subject                                                                 | Result                                                                                                                                                                                                                |
| --------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b16c80a` | fix(a11y): resolve accessibility + conformance issues across UI and API | **Not applied** — conflicts in `audio-player.tsx`, `track-list-item.tsx`, test/db-utils, `admin-users.server.ts`, `artists.duplicates.tsx`, and several server test files; bulk of hunk content is already on `main`. |
| `005af36` | align TrackListItem parents with listitem role                          | **Empty** on `main` (already present).                                                                                                                                                                                |
| `85ab034` | queue-table contextual aria-label test selectors                        | **Empty** on `main`.                                                                                                                                                                                                  |
| `cb1b9d9` | split non-a11y refactors out of a11y PR                                 | **Skipped** — revert of changes not present on current `main`.                                                                                                                                                        |
| `61247f5` | drop aria-label on presentation TrackListItem rows                      | **Applied** → `300443b`                                                                                                                                                                                               |
| `c68910f` | combobox/option selectors + useId listbox ids                           | **Applied** (genre-selector only; test files already matched `main`) → `390d0e8`                                                                                                                                      |

## Files changed on this branch (vs `main`)

- `app/components/genre-selector.tsx` — `useId()` for listbox id (duplicate-id fix).
- `app/components/track-list-item.tsx` — omit `aria-label` when `listRole="presentation"`.

## PR #324 scope already on `main`

The remaining 34 files from PR #324 (combobox/listbox patterns, toast/dropdown a11y, curator AlertDialog, queue labels, reports sr-only lists, track list roles, e2e selector updates, `chevron-right.svg`, etc.) are already aligned with PR intent on `main`; no additional checkout was required.

## Intentional diffs vs `feat/t_a733486f` (not brought over)

These differ from the feature branch but are **not** part of PR #324 a11y intent on current `main`:

- `app/components/audio-player.tsx` — monolithic player on feat branch vs modular player on `main`; unknown-duration range fix lives in `player-controls.tsx` on `main`.
- `app/components/dashboard/queue-table.tsx` — label maps imported from feature module on `main`.
- Offline views — shared `to-offline-track-list-item-track` helper on `main`.
- `app/components/ui/dropdown-menu.tsx` — `stroke="currentColor"` on `main` (preferred over hardcoded black on feat).

## Conflicts requiring manual resolution

None remain on this branch. Cherry-pick of `b16c80a` was aborted in favor of the approach above; if future commits from that changeset are needed, resolve conflicts file-by-file against current `main` architecture.

## Tests

- `npm test -- app/components/genre-selector app/components/track-list-item app/components/album-edit-dialog.submit.test.tsx app/components/track-details-dialog/basic-metadata-tab.test.tsx` — 53 passed.

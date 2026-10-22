# Curator guide

Curators and admins edit library metadata, clean up duplicates, and work the review queue. Open the tools from the user menu.

## Edit a track

1. Open a track’s overflow menu and choose **View track details**.
2. Update the basic or extended fields and save. A comment is stored with the edit.
3. Use the History tab to restore an earlier snapshot.

The dialog keeps an edit lock while it is open so two curators do not overwrite each other.

## Bulk edit

1. Turn on selection mode from the curator tools.
2. Select the tracks you want to change.
3. Choose **Bulk edit**, pick the fields to update, and confirm.

## Merge duplicates

1. Open **Duplicates**.
2. Review exact and fuzzy artist or album groups.
3. Merge the duplicate into the record you want to keep. Tracks move to the target, and the merge is recorded in edit history.

## Review queue

1. Open **Review queue** or the dashboard Queue tab.
2. Filter by status, entity, or source (user reports, system checks, curator flags).
3. Claim an item. It leaves the open list and appears under **My claims**, with the matter and the track, artist, or album name. Unclaim puts it back on **Open**. Resolve moves it to **Resolved** and restates the decision.
4. Listeners find the reports they filed under **My reports** in the user menu.

Resolved user reports count toward the Community Helper badge.

## Session recovery

Curator workflow state is saved in this browser only: selected tracks, open edit dialogs (including unsaved field drafts), filters, the dashboard tab, and scroll position. Selection and filters last 24 hours. Unsaved dialog drafts last 2 hours.

After a refresh, the app asks **Restore previous session?** Choose **Restore** to put that work back, or **Discard** to clear it. **Clear saved session** in the user menu does the same thing. Nothing in the saved session is sent to the server.

## Metadata clipboard

On a track’s overflow menu:

1. **Copy Metadata** stores artist, album, genre, year, album artist, BPM, and label in memory for this tab. A toast confirms the copy. It is not written to browser storage.
2. **Paste Metadata** on another track opens a dialog. Uncheck any fields you do not want, then apply.

Paste uses the same track edit endpoint as the track editor.

## Badges

The dashboard leaderboard and activity feed show badges earned from existing curator work:

- First Edit (1 edit), Getting Started (10), Regular Contributor (50), Power Curator (200), Master Curator (500), Elite Curator (1000)
- Duplicate Hunter (10 merges)
- Quality Guardian (50 review-queue resolutions)
- Genre Specialist (100 genre edits)
- Community Helper (10 resolved user reports)

Badges are recalculated when the dashboard or badge API loads and are stored once. `GET /api/curator/badges` returns them, with an optional `userId` filter.

-- Enforce per-user case-insensitive unique playlist titles at the database level.
--
-- Previously this invariant was only enforced by a check-then-create in
-- app code (app/utils/user-playlist.server.ts), which races: two concurrent
-- create/rename calls can interleave their "title taken?" check with their
-- write and both succeed, producing duplicate titles for the same owner.
--
-- SQLite has no Prisma-native way to express an expression unique constraint,
-- so we use a functional unique index on lower(trim(title)). Note: SQLite's
-- lower() only folds ASCII; non-ASCII case differences are still caught by the
-- Unicode-aware normalizeUserPlaylistTitle() check in application code.
CREATE UNIQUE INDEX "UserPlaylist_ownerId_lower_title_key"
  ON "UserPlaylist"("ownerId", lower(trim("title")));

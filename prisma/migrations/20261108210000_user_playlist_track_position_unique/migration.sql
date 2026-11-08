-- Enforce unique (playlistId, position) so concurrent playlist appends cannot
-- assign the same slot. Renumber existing rows in stable order first so the
-- unique index can be created on live data.
WITH "ranked" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "playlistId"
      ORDER BY "position", "createdAt", "id"
    ) - 1 AS "new_position"
  FROM "UserPlaylistTrack"
)
UPDATE "UserPlaylistTrack"
SET "position" = (
  SELECT "new_position" FROM "ranked" WHERE "ranked"."id" = "UserPlaylistTrack"."id"
);

DROP INDEX "UserPlaylistTrack_playlistId_position_idx";
CREATE UNIQUE INDEX "UserPlaylistTrack_playlistId_position_key"
  ON "UserPlaylistTrack"("playlistId", "position");

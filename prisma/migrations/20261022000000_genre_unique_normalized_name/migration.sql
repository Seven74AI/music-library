-- Genre dedup now keys on normalizedName (case-insensitive) at the DB level.
-- The application guard already dedups on normalizedName; adding a unique
-- constraint on the same field closes the race where two case-variant genres
-- ('Rock' vs 'rock') slip past the guard and insert as duplicates, and backs
-- concurrent identical-name creates/renames that previously threw an unhandled
-- P2002. The raw `name` unique stays (subsumed by normalizedName) to avoid a
-- table redefine that would drop/recreate the FTS5 triggers referencing Genre.

-- 1) Dedup track links FIRST. Keep one link per (normalizedName, track) so the
--    relink in step 2 can never map two rows to the same (A, B) pair and trip
--    the _TrackGenres_AB_unique index on ("A", "B").
DELETE FROM "_TrackGenres"
WHERE "rowid" NOT IN (
    SELECT MIN("tg"."rowid")
    FROM "_TrackGenres" AS "tg"
    JOIN "Genre" AS "g" ON "g"."id" = "tg"."A"
    GROUP BY "g"."normalizedName", "tg"."B"
);

-- 2) Relink every surviving track link to the canonical (lowest-id) genre for
--    its normalizedName, so deleting the duplicates does not drop track links.
UPDATE "_TrackGenres"
SET "A" = (
    SELECT MIN("g2"."id")
    FROM "Genre" AS "g1"
    JOIN "Genre" AS "g2" ON "g2"."normalizedName" = "g1"."normalizedName"
    WHERE "g1"."id" = "_TrackGenres"."A"
);

-- 3) Drop every genre except the canonical row per normalizedName. Surviving
--    links already point at canonical genres, so the ON DELETE CASCADE FK on
--    _TrackGenres.A has nothing left to cascade here.
DELETE FROM "Genre"
WHERE "id" NOT IN (
    SELECT MIN("id") FROM "Genre" GROUP BY "normalizedName"
);

-- 4) Enforce uniqueness on normalizedName, then drop the now-redundant
--    non-unique index (the unique index serves the same lookups).
CREATE UNIQUE INDEX "Genre_normalizedName_key" ON "Genre"("normalizedName");
DROP INDEX "Genre_normalizedName_idx";

-- 5) Rebuild tracks_fts. The relink above used UPDATE, but _TrackGenres has
--    only AFTER INSERT (track_genres_ai) and AFTER DELETE (track_genres_ad)
--    triggers — no AFTER UPDATE — so relinked tracks' genre tokens would go
--    stale (e.g. "Björk" vs "Bjork" sharing normalizedName "bjork" leave the
--    old diacritic token unsearchable under unicode61). A full rebuild
--    refreshes every track's genre column.
DELETE FROM tracks_fts;

INSERT INTO tracks_fts(track_id, title, artist_name, album_name, genres)
SELECT
  t.id,
  t.title,
  a.name,
  COALESCE(alb.name, ''),
  COALESCE(
    (SELECT GROUP_CONCAT(g.name, ' ')
     FROM _TrackGenres tg
     JOIN Genre g ON tg.A = g.id
     WHERE tg.B = t.id),
    ''
  )
FROM Track t
JOIN Artist a ON t.artistId = a.id
LEFT JOIN Album alb ON t.albumId = alb.id;

-- Genre dedup now keys on normalizedName (case-insensitive) at the DB level.
-- The application guard already dedups on normalizedName; adding a unique
-- constraint on the same field closes the race where two case-variant genres
-- ('Rock' vs 'rock') slip past the guard and insert as duplicates, and backs
-- concurrent identical-name creates/renames that previously threw an unhandled
-- P2002. The raw `name` unique stays (subsumed by normalizedName) to avoid a
-- table redefine that would drop/recreate the FTS5 triggers referencing Genre.

-- 1) Relink every track link to the canonical (lowest-id) genre for its
--    normalizedName, so deleting the duplicates does not drop track links.
UPDATE "_TrackGenres"
SET "A" = (
    SELECT MIN("g2"."id")
    FROM "Genre" AS "g1"
    JOIN "Genre" AS "g2" ON "g2"."normalizedName" = "g1"."normalizedName"
    WHERE "g1"."id" = "_TrackGenres"."A"
);

-- 2) Remove (canonical, track) duplicates introduced by the relink above.
DELETE FROM "_TrackGenres"
WHERE "rowid" NOT IN (
    SELECT MIN("rowid") FROM "_TrackGenres" GROUP BY "A", "B"
);

-- 3) Drop every genre except the canonical row per normalizedName.
DELETE FROM "Genre"
WHERE "id" NOT IN (
    SELECT MIN("id") FROM "Genre" GROUP BY "normalizedName"
);

-- 4) Enforce uniqueness on normalizedName, then drop the now-redundant
--    non-unique index (the unique index serves the same lookups).
CREATE UNIQUE INDEX "Genre_normalizedName_key" ON "Genre"("normalizedName");
DROP INDEX "Genre_normalizedName_idx";

-- ADR-037: backfill _TrackGenres from legacy Track.genre, then drop the column.
-- Mirrors parseGenreString (comma, semicolon, slash) + normalizeGenreName (approximate in SQL).
-- Per-link INSERT OR IGNORE: tracks with partial M2M still receive missing legacy genres.

CREATE TEMP TABLE "_legacy_genre_backfill" AS
WITH RECURSIVE
source AS (
  SELECT t.id AS track_id, trim(t.genre) AS raw
  FROM "Track" t
  WHERE t.genre IS NOT NULL AND trim(t.genre) != ''
),
prep AS (
  SELECT
    track_id,
    replace(replace(replace(raw, ';', ','), '/', ','), ',', ',') AS list
  FROM source
),
split(track_id, token, rest) AS (
  SELECT track_id, '', list || ',' FROM prep
  UNION ALL
  SELECT
    track_id,
    trim(substr(rest, 1, CASE WHEN instr(rest, ',') = 0 THEN length(rest) ELSE instr(rest, ',') - 1 END)),
    CASE WHEN instr(rest, ',') = 0 THEN '' ELSE substr(rest, instr(rest, ',') + 1) END
  FROM split
  WHERE rest != ''
),
tokens AS (
  SELECT track_id, trim(token) AS raw_token
  FROM split
  WHERE trim(token) != ''
),
normalized AS (
  SELECT
    track_id,
    raw_token AS display_name,
    trim(
      lower(
        replace(
          replace(
            replace(
              replace(
                replace(
                  replace(replace(replace(raw_token, '&', ''), '''', ''), '.', ''), '(', ''), ')', ''),
                  '-',
                  '-'
                ),
                '  ',
                ' '
              ),
              '  ',
              ' '
            ),
            '  ',
            ' '
          )
        )
      )
    ) AS normalized_name
  FROM tokens
)
SELECT track_id, MIN(display_name) AS display_name, normalized_name
FROM normalized
WHERE normalized_name != ''
GROUP BY track_id, normalized_name;

INSERT OR IGNORE INTO "Genre" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT
  lower(hex(randomblob(16))),
  need.display_name,
  need.normalized_name,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM (
  SELECT b.normalized_name, MIN(b.display_name) AS display_name
  FROM "_legacy_genre_backfill" b
  WHERE NOT EXISTS (SELECT 1 FROM "Genre" g WHERE g."normalizedName" = b.normalized_name)
  GROUP BY b.normalized_name
) AS need;

INSERT OR IGNORE INTO "_TrackGenres" ("A", "B")
SELECT g.id, b.track_id
FROM "_legacy_genre_backfill" b
INNER JOIN "Genre" g ON g."normalizedName" = b.normalized_name;

DROP TABLE "_legacy_genre_backfill";

-- Drop FTS sync triggers before Track table rebuild (SQLite recompiles triggers on rename).
DROP TRIGGER IF EXISTS tracks_fts_ai;
DROP TRIGGER IF EXISTS tracks_fts_au;
DROP TRIGGER IF EXISTS tracks_fts_ad;
DROP TRIGGER IF EXISTS track_genres_ai;
DROP TRIGGER IF EXISTS track_genres_ad;
DROP TRIGGER IF EXISTS artist_rename_fts_cascade;

-- Drop legacy column (SQLite table rebuild).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "serviceUrl" TEXT,
    "duration" INTEGER,
    "albumId" TEXT,
    "coverImageId" TEXT,
    "releaseDate" DATETIME,
    "year" INTEGER,
    "trackNumber" INTEGER,
    "albumArtist" TEXT,
    "bpm" INTEGER,
    "label" TEXT,
    "isrc" TEXT,
    "originalDate" DATETIME,
    "originalYear" INTEGER,
    "totalTracks" INTEGER,
    "totalDiscs" INTEGER,
    "lyrics" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Track_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Track_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Track" (
    "id", "title", "artistId", "serviceId", "externalId", "serviceUrl", "duration",
    "albumId", "coverImageId", "releaseDate", "year", "trackNumber", "albumArtist",
    "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs",
    "lyrics", "createdAt", "updatedAt"
)
SELECT
    "id", "title", "artistId", "serviceId", "externalId", "serviceUrl", "duration",
    "albumId", "coverImageId", "releaseDate", "year", "trackNumber", "albumArtist",
    "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs",
    "lyrics", "createdAt", "updatedAt"
FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
CREATE INDEX "Track_updatedAt_idx" ON "Track"("updatedAt");
CREATE INDEX "Track_createdAt_idx" ON "Track"("createdAt");
CREATE INDEX "Track_albumId_idx" ON "Track"("albumId");
CREATE INDEX "Track_coverImageId_idx" ON "Track"("coverImageId");
CREATE INDEX "Track_artistId_idx" ON "Track"("artistId");
CREATE UNIQUE INDEX "Track_serviceId_externalId_key" ON "Track"("serviceId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE TRIGGER tracks_fts_ai AFTER INSERT ON Track BEGIN
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
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = NEW.id;
END;

CREATE TRIGGER tracks_fts_au AFTER UPDATE ON Track BEGIN
  DELETE FROM tracks_fts WHERE track_id = OLD.id;
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
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = NEW.id;
END;

CREATE TRIGGER tracks_fts_ad AFTER DELETE ON Track BEGIN
  DELETE FROM tracks_fts WHERE track_id = OLD.id;
END;

CREATE TRIGGER track_genres_ai AFTER INSERT ON _TrackGenres BEGIN
  DELETE FROM tracks_fts WHERE track_id = NEW.B;
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
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = NEW.B;
END;

CREATE TRIGGER track_genres_ad AFTER DELETE ON _TrackGenres BEGIN
  DELETE FROM tracks_fts WHERE track_id = OLD.B;
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
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = OLD.B;
END;

CREATE TRIGGER artist_rename_fts_cascade AFTER UPDATE ON Artist
WHEN OLD.name != NEW.name
BEGIN
  DELETE FROM tracks_fts WHERE track_id IN (
    SELECT id FROM Track WHERE artistId = NEW.id
  );

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
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.artistId = NEW.id;

  DELETE FROM albums_fts WHERE album_id IN (
    SELECT id FROM Album WHERE artistId = NEW.id
  );

  INSERT INTO albums_fts(album_id, name, artist_name)
  SELECT
    alb.id,
    alb.name,
    a.name
  FROM Album alb
  JOIN Artist a ON alb.artistId = a.id
  WHERE alb.artistId = NEW.id;
END;

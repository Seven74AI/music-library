-- Add the self-referential foreign keys for merge tracking.
--
-- schema.prisma declares Artist.mergedArtist @relation("ArtistMerge", onDelete: SetNull)
-- and Album.mergedAlbum @relation("AlbumMerge", onDelete: SetNull), but the
-- 20260927000000_add_edit_history_and_merge_tracking migration only added the
-- mergedIntoId/mergedAt/mergedBy COLUMNS — it never added the FOREIGN KEY
-- constraint (SQLite cannot add a FK via ALTER TABLE, so a table redefinition is
-- required). As a result, onDelete: SetNull was never enforced: hard-deleting a
-- merge-target artist/album left dangling mergedIntoId references.
--
-- SQLite's ALTER TABLE RENAME recompiles triggers on other tables that reference
-- the renamed table, so we first drop every FTS sync trigger that references
-- Artist/Album, redefine both tables (adding the FK), then recreate the triggers.
-- The redefinition also drops orphan indexes (Artist_normalizedName_idx2,
-- Artist_mergedIntoId_fkey_idx, Album_artistId_name_idx2,
-- Album_mergedIntoId_fkey_idx) that are not declared in schema.prisma, recreating
-- only the canonical indexes so the database matches the schema.

-- Drop FTS sync triggers (recreated at the end of this migration)
DROP TRIGGER IF EXISTS albums_fts_ai;
DROP TRIGGER IF EXISTS albums_fts_au;
DROP TRIGGER IF EXISTS albums_fts_ad;
DROP TRIGGER IF EXISTS artists_fts_ai;
DROP TRIGGER IF EXISTS artists_fts_au;
DROP TRIGGER IF EXISTS artists_fts_ad;
DROP TRIGGER IF EXISTS tracks_fts_ai;
DROP TRIGGER IF EXISTS tracks_fts_au;
DROP TRIGGER IF EXISTS tracks_fts_ad;
DROP TRIGGER IF EXISTS track_genres_ai;
DROP TRIGGER IF EXISTS track_genres_ad;
DROP TRIGGER IF EXISTS artist_rename_fts_cascade;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Artist: add mergedIntoId -> Artist.id FK
CREATE TABLE "new_Artist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "website" TEXT,
    "genre" TEXT,
    "country" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mergedIntoId" TEXT,
    "mergedAt" DATETIME,
    "mergedBy" TEXT,
    CONSTRAINT "Artist_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Artist" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Artist" ("id", "name", "normalizedName", "bio", "imageUrl", "website", "genre", "country", "createdAt", "updatedAt", "mergedIntoId", "mergedAt", "mergedBy")
SELECT "id", "name", "normalizedName", "bio", "imageUrl", "website", "genre", "country", "createdAt", "updatedAt", "mergedIntoId", "mergedAt", "mergedBy" FROM "Artist";
DROP TABLE "Artist";
ALTER TABLE "new_Artist" RENAME TO "Artist";

-- Album: add mergedIntoId -> Album.id FK (preserving artistId/coverImageId FKs)
CREATE TABLE "new_Album" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "year" INTEGER,
    "coverImageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "mergedIntoId" TEXT,
    "mergedAt" DATETIME,
    "mergedBy" TEXT,
    CONSTRAINT "Album_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Album_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Album" ("id", "name", "artistId", "year", "coverImageId", "createdAt", "updatedAt", "mergedIntoId", "mergedAt", "mergedBy")
SELECT "id", "name", "artistId", "year", "coverImageId", "createdAt", "updatedAt", "mergedIntoId", "mergedAt", "mergedBy" FROM "Album";
DROP TABLE "Album";
ALTER TABLE "new_Album" RENAME TO "Album";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE INDEX "Artist_normalizedName_idx" ON "Artist"("normalizedName");
CREATE INDEX "Artist_name_idx" ON "Artist"("name");
CREATE INDEX "Artist_mergedIntoId_idx" ON "Artist"("mergedIntoId");
CREATE INDEX "Album_artistId_name_idx" ON "Album"("artistId", "name");
CREATE INDEX "Album_artistId_idx" ON "Album"("artistId");
CREATE INDEX "Album_mergedIntoId_idx" ON "Album"("mergedIntoId");

-- Recreate FTS sync triggers
CREATE TRIGGER albums_fts_ai AFTER INSERT ON Album BEGIN
  INSERT INTO albums_fts(album_id, name, artist_name)
  SELECT
    alb.id,
    alb.name,
    a.name
  FROM Album alb
  JOIN Artist a ON alb.artistId = a.id
  WHERE alb.id = NEW.id;
END;

CREATE TRIGGER albums_fts_au AFTER UPDATE ON Album BEGIN
  DELETE FROM albums_fts WHERE album_id = OLD.id;
  INSERT INTO albums_fts(album_id, name, artist_name)
  SELECT
    alb.id,
    alb.name,
    a.name
  FROM Album alb
  JOIN Artist a ON alb.artistId = a.id
  WHERE alb.id = NEW.id;
END;

CREATE TRIGGER albums_fts_ad AFTER DELETE ON Album BEGIN
  DELETE FROM albums_fts WHERE album_id = OLD.id;
END;

CREATE TRIGGER artists_fts_ai AFTER INSERT ON Artist BEGIN
  INSERT INTO artists_fts(artist_id, name, genre)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.genre, ''));
END;

CREATE TRIGGER artists_fts_au AFTER UPDATE ON Artist BEGIN
  DELETE FROM artists_fts WHERE artist_id = OLD.id;
  INSERT INTO artists_fts(artist_id, name, genre)
  VALUES (NEW.id, NEW.name, COALESCE(NEW.genre, ''));
END;

CREATE TRIGGER artists_fts_ad AFTER DELETE ON Artist BEGIN
  DELETE FROM artists_fts WHERE artist_id = OLD.id;
END;

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

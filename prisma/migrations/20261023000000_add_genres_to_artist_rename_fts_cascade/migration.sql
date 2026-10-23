-- The artist_rename_fts_cascade trigger (created in 20251203130000) re-inserts a
-- renamed artist's tracks into tracks_fts using only 4 columns. The later
-- 20261002100000_add_genres_to_fts5 migration added a 5th "genres" column to
-- tracks_fts and recreated tracks_fts_ai/au/ad with genre handling, but did NOT
-- update this trigger. As a result, renaming an artist DELETE'd then re-INSERT'd
-- all of that artist's tracks into tracks_fts without the genres column (FTS5
-- fills omitted columns with NULL), silently dropping every genre term from
-- search for those tracks.
--
-- Recreate the trigger to mirror the tracks_fts_au genre GROUP_CONCAT subquery.

DROP TRIGGER IF EXISTS artist_rename_fts_cascade;

CREATE TRIGGER artist_rename_fts_cascade AFTER UPDATE ON Artist
WHEN OLD.name != NEW.name
BEGIN
  -- Refresh tracks_fts for all tracks of the renamed artist (with genres)
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

  -- Refresh albums_fts for all albums of the renamed artist
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

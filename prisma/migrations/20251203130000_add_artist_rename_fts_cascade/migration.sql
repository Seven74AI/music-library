-- Add FTS5 cascade trigger for artist rename
-- When an artist's name is updated, refresh all tracks_fts and albums_fts
-- entries that reference that artist, so search results reflect the new name.

CREATE TRIGGER artist_rename_fts_cascade AFTER UPDATE ON Artist
WHEN OLD.name != NEW.name
BEGIN
  -- Refresh tracks_fts for all tracks of the renamed artist
  DELETE FROM tracks_fts WHERE track_id IN (
    SELECT id FROM Track WHERE artistId = NEW.id
  );

  INSERT INTO tracks_fts(track_id, title, artist_name, album_name)
  SELECT
    t.id,
    t.title,
    a.name,
    COALESCE(alb.name, '')
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

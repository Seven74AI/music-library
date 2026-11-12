-- When Album.name changes, albums_fts_au refreshes albums_fts but tracks_fts.album_name
-- is only updated on Track insert/update or artist_rename_fts_cascade — mirror artist cascade.
CREATE TRIGGER album_rename_fts_cascade AFTER UPDATE ON Album
WHEN OLD.name != NEW.name
BEGIN
  DELETE FROM tracks_fts WHERE track_id IN (
    SELECT id FROM Track WHERE albumId = NEW.id
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
  WHERE t.albumId = NEW.id;
END;

-- Genre.name changes do not fire _TrackGenres triggers; refresh linked tracks' genres column.
CREATE TRIGGER genre_rename_fts_cascade AFTER UPDATE ON Genre
WHEN OLD.name != NEW.name
BEGIN
  DELETE FROM tracks_fts WHERE track_id IN (
    SELECT B FROM _TrackGenres WHERE A = NEW.id
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
  WHERE t.id IN (SELECT B FROM _TrackGenres WHERE A = NEW.id);
END;

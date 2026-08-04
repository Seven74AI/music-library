-- Restore tracks_fts triggers removed when Track was redefined in
-- 20251202140000_make_serviceId_externalId_required (DROP TABLE removes triggers).
-- Also backfill tracks_fts so existing rows are searchable again.

DROP TRIGGER IF EXISTS tracks_fts_ai;
DROP TRIGGER IF EXISTS tracks_fts_au;
DROP TRIGGER IF EXISTS tracks_fts_ad;

CREATE TRIGGER tracks_fts_ai AFTER INSERT ON Track BEGIN
  INSERT INTO tracks_fts(track_id, title, artist_name, album_name)
  SELECT
    t.id,
    t.title,
    a.name,
    COALESCE(alb.name, '')
  FROM Track t
  JOIN Artist a ON t.artistId = a.id
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = NEW.id;
END;

CREATE TRIGGER tracks_fts_au AFTER UPDATE ON Track BEGIN
  DELETE FROM tracks_fts WHERE track_id = OLD.id;
  INSERT INTO tracks_fts(track_id, title, artist_name, album_name)
  SELECT
    t.id,
    t.title,
    a.name,
    COALESCE(alb.name, '')
  FROM Track t
  JOIN Artist a ON t.artistId = a.id
  LEFT JOIN Album alb ON t.albumId = alb.id
  WHERE t.id = NEW.id;
END;

CREATE TRIGGER tracks_fts_ad AFTER DELETE ON Track BEGIN
  DELETE FROM tracks_fts WHERE track_id = OLD.id;
END;

DELETE FROM tracks_fts;

INSERT INTO tracks_fts(track_id, title, artist_name, album_name)
SELECT t.id, t.title, a.name, COALESCE(alb.name, '')
FROM Track t
JOIN Artist a ON t.artistId = a.id
LEFT JOIN Album alb ON t.albumId = alb.id;

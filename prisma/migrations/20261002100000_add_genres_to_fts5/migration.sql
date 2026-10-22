-- Update FTS5 tracks table to include genres
-- First, drop the old tracks_fts virtual table and recreate with genre column

-- Drop existing triggers
DROP TRIGGER IF EXISTS tracks_fts_ai;
DROP TRIGGER IF EXISTS tracks_fts_au;
DROP TRIGGER IF EXISTS tracks_fts_ad;

-- Drop and recreate tracks_fts with genre column
DROP TABLE IF EXISTS tracks_fts;

CREATE VIRTUAL TABLE tracks_fts USING fts5(
  track_id,
  title,
  artist_name,
  album_name,
  genres,  -- New column for concatenated genres
  tokenize='unicode61'
);

-- Create helper function to get concatenated genres for a track
-- This is done via a subquery in the triggers

-- Track triggers for automatic FTS5 synchronization (with genres)
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

-- Triggers for _TrackGenres changes (to update FTS5 when genres change)
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

-- Backfill existing data into FTS5 table
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

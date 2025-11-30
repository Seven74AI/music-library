-- Create FTS5 virtual tables for full-text search
-- These tables use the content table pattern to reference actual database tables
-- and are automatically synchronized via triggers
-- Note: Since our IDs are TEXT (not INTEGER), we cannot use content_rowid directly
-- Instead, we'll use a mapping approach with triggers

-- Tracks FTS5 table (standalone, synchronized via triggers)
CREATE VIRTUAL TABLE tracks_fts USING fts5(
  track_id,
  title,
  artist_name,
  album_name,
  tokenize='unicode61'
);

-- Albums FTS5 table (standalone, synchronized via triggers)
CREATE VIRTUAL TABLE albums_fts USING fts5(
  album_id,
  name,
  artist_name,
  tokenize='unicode61'
);

-- Artists FTS5 table (standalone, synchronized via triggers)
CREATE VIRTUAL TABLE artists_fts USING fts5(
  artist_id,
  name,
  genre,
  tokenize='unicode61'
);

-- Track triggers for automatic FTS5 synchronization
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

-- Album triggers for automatic FTS5 synchronization
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

-- Artist triggers for automatic FTS5 synchronization
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

-- Backfill existing data into FTS5 tables
INSERT INTO tracks_fts(track_id, title, artist_name, album_name)
SELECT t.id, t.title, a.name, COALESCE(alb.name, '')
FROM Track t
JOIN Artist a ON t.artistId = a.id
LEFT JOIN Album alb ON t.albumId = alb.id;

INSERT INTO albums_fts(album_id, name, artist_name)
SELECT alb.id, alb.name, a.name
FROM Album alb
JOIN Artist a ON alb.artistId = a.id;

INSERT INTO artists_fts(artist_id, name, genre)
SELECT id, name, COALESCE(genre, '')
FROM Artist;


-- The edit-history migration that inserts the curator role failed on production
-- with "duplicate column name: mergedIntoId" and was then marked applied, so
-- the role and permission rows never landed. Later deploys skipped that SQL.
-- Insert them again. INSERT OR IGNORE is a no-op where the rows already exist.

INSERT OR IGNORE INTO "Role" ("id", "name", "description", "createdAt", "updatedAt")
VALUES (
  'curator_role_id_00000000000',
  'curator',
  'Trusted user who can edit track/artist/album metadata',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);

INSERT OR IGNORE INTO "Permission" ("id", "action", "entity", "access", "description", "createdAt", "updatedAt")
VALUES
  ('perm_metadata_update_any', 'update', 'metadata', 'any', 'Edit any track/artist/album metadata', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_metadata_history_read', 'read', 'metadata-history', 'any', 'Read edit history for tracks/artists/albums', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_metadata_restore_any', 'restore', 'metadata', 'any', 'Restore track/artist/album to previous versions', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_artist_update_any', 'update', 'artist', 'any', 'Edit any artist metadata', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_artist_merge_any', 'merge', 'artist', 'any', 'Merge duplicate artists', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_album_update_any', 'update', 'album', 'any', 'Edit any album metadata', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
  ('perm_album_merge_any', 'merge', 'album', 'any', 'Merge duplicate albums', CAST(strftime('%s', 'now') AS INTEGER) * 1000, CAST(strftime('%s', 'now') AS INTEGER) * 1000);

INSERT OR IGNORE INTO "_PermissionToRole" ("A", "B")
VALUES
  ('perm_metadata_update_any', 'curator_role_id_00000000000'),
  ('perm_metadata_history_read', 'curator_role_id_00000000000'),
  ('perm_metadata_restore_any', 'curator_role_id_00000000000'),
  ('perm_artist_update_any', 'curator_role_id_00000000000'),
  ('perm_artist_merge_any', 'curator_role_id_00000000000'),
  ('perm_album_update_any', 'curator_role_id_00000000000'),
  ('perm_album_merge_any', 'curator_role_id_00000000000'),
  ('perm_metadata_update_any', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_metadata_history_read', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_metadata_restore_any', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_artist_update_any', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_artist_merge_any', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_album_update_any', 'clnf2zvlw000gpcour6dyyuh6'),
  ('perm_album_merge_any', 'clnf2zvlw000gpcour6dyyuh6');

-- Drop indexes on TrackAudioFile
DROP INDEX IF EXISTS "TrackAudioFile_status_idx";
DROP INDEX IF EXISTS "TrackAudioFile_status_createdAt_idx";
DROP INDEX IF EXISTS "TrackAudioFile_status_lastAttemptAt_idx";

-- Drop the TrackAudioFile table
DROP TABLE IF EXISTS "TrackAudioFile";


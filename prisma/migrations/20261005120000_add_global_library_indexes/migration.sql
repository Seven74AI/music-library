-- For "Most Liked" counting (UserTrack count per track)
-- Supports: SELECT trackId, COUNT(*) FROM UserTrack WHERE isActive = true GROUP BY trackId
CREATE INDEX IF NOT EXISTS "UserTrack_trackId_isActive_idx"
  ON "UserTrack"("trackId", "isActive");

-- For "Most Played" aggregation (already partially indexed)
-- Verify this index exists, add if missing:
-- Supports: SELECT trackId, COUNT(*) FROM UsageEvent WHERE type = 'play_completed' GROUP BY trackId
CREATE INDEX IF NOT EXISTS "UsageEvent_type_trackId_idx"
  ON "UsageEvent"("type", "trackId");

-- Optional: Composite index for user-specific play counts
-- Supports: SELECT trackId, COUNT(*) FROM UsageEvent WHERE userId = ? AND type = 'play_completed' GROUP BY trackId
CREATE INDEX IF NOT EXISTS "UsageEvent_userId_type_trackId_idx"
  ON "UsageEvent"("userId", "type", "trackId");

-- Drop indexes that reference priority column
DROP INDEX "TrackAudioFile_status_priority_createdAt_idx";

-- AlterTable
ALTER TABLE "TrackAudioFile" DROP COLUMN "priority";
ALTER TABLE "TrackAudioFile" ADD COLUMN "downloadStartedBy" TEXT;

-- Recreate indexes without priority
CREATE INDEX "TrackAudioFile_status_createdAt_idx" ON "TrackAudioFile"("status", "createdAt");

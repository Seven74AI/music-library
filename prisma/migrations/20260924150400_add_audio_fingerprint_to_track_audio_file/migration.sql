-- AlterTable
ALTER TABLE "TrackAudioFile" ADD COLUMN "audioFingerprint" TEXT;

-- CreateIndex
CREATE INDEX "TrackAudioFile_audioFingerprint_idx" ON "TrackAudioFile"("audioFingerprint");

-- Add TrackAudioFile table back for local audio file uploads
-- This table was removed in 20251127180000_remove_track_audio_file for YouTube downloads,
-- but is still needed for local audio file uploads (see ADR-010: Audio Upload Storage System)

-- CreateTable
CREATE TABLE "TrackAudioFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "serviceId" TEXT,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "format" TEXT,
    "bitrate" INTEGER,
    "sampleRate" INTEGER,
    "uploadedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackAudioFile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackAudioFile_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackAudioFile_trackId_serviceId_format_key" ON "TrackAudioFile"("trackId", "serviceId", "format");

-- CreateIndex
CREATE INDEX "TrackAudioFile_trackId_idx" ON "TrackAudioFile"("trackId");

-- CreateIndex
CREATE INDEX "TrackAudioFile_serviceId_idx" ON "TrackAudioFile"("serviceId");

-- CreateIndex
CREATE INDEX "TrackAudioFile_format_idx" ON "TrackAudioFile"("format");

-- CreateIndex
CREATE INDEX "TrackAudioFile_trackId_format_idx" ON "TrackAudioFile"("trackId", "format");




-- Add contentHash column to TrackAudioFile for audio deduplication
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_TrackAudioFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "serviceId" TEXT,
    "objectKey" TEXT NOT NULL,
    "contentHash" TEXT,
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

INSERT INTO "new_TrackAudioFile" (
    "id", "trackId", "serviceId", "objectKey", "fileName", "fileSize", 
    "mimeType", "format", "bitrate", "sampleRate", "uploadedAt", 
    "uploadedBy", "createdAt", "updatedAt"
)
SELECT 
    "id", "trackId", "serviceId", "objectKey", "fileName", "fileSize",
    "mimeType", "format", "bitrate", "sampleRate", "uploadedAt",
    "uploadedBy", "createdAt", "updatedAt"
FROM "TrackAudioFile";

DROP TABLE "TrackAudioFile";
ALTER TABLE "new_TrackAudioFile" RENAME TO "TrackAudioFile";

CREATE UNIQUE INDEX "TrackAudioFile_trackId_serviceId_format_key" ON "TrackAudioFile"("trackId", "serviceId", "format");
CREATE INDEX "TrackAudioFile_contentHash_idx" ON "TrackAudioFile"("contentHash");
CREATE INDEX "TrackAudioFile_trackId_idx" ON "TrackAudioFile"("trackId");
CREATE INDEX "TrackAudioFile_serviceId_idx" ON "TrackAudioFile"("serviceId");
CREATE INDEX "TrackAudioFile_format_idx" ON "TrackAudioFile"("format");
CREATE INDEX "TrackAudioFile_trackId_format_idx" ON "TrackAudioFile"("trackId", "format");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

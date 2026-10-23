-- Make TrackAudioFile.serviceId required (NOT NULL).
--
-- schema.prisma declared serviceId as nullable with the comment "null = local
-- upload". A nullable column inside @@unique([trackId, serviceId, format])
-- weakens the dedup invariant: SQLite UNIQUE indexes treat NULL as distinct, so
-- rows sharing (trackId, NULL, format) were all allowed, breaking the documented
-- "one file per track/service/format" guarantee. The admin-upload path already
-- points local uploads at the seeded 'local' Service row, and the archive worker
-- resolves the track's serviceId in persistTrackAudio, so serviceId can now be
-- non-null. Backfill any legacy NULL serviceId from the track's service, then
-- redefine the table with a NOT NULL column and a RESTRICT foreign key.

-- Backfill legacy NULL serviceId from the owning track's service, falling back to
-- the seeded 'local' Service row for any track without a service (should not
-- happen given Track.serviceId is NOT NULL).
UPDATE "TrackAudioFile"
SET "serviceId" = COALESCE(
    (SELECT "serviceId" FROM "Track" WHERE "Track"."id" = "TrackAudioFile"."trackId"),
    (SELECT "id" FROM "Service" WHERE "name" = 'local' LIMIT 1)
)
WHERE "serviceId" IS NULL;

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_TrackAudioFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentHash" TEXT,
    "audioFingerprint" TEXT,
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
    CONSTRAINT "TrackAudioFile_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_TrackAudioFile" ("id", "trackId", "serviceId", "objectKey", "contentHash", "audioFingerprint", "fileName", "fileSize", "mimeType", "format", "bitrate", "sampleRate", "uploadedAt", "uploadedBy", "createdAt", "updatedAt")
SELECT "id", "trackId", "serviceId", "objectKey", "contentHash", "audioFingerprint", "fileName", "fileSize", "mimeType", "format", "bitrate", "sampleRate", "uploadedAt", "uploadedBy", "createdAt", "updatedAt" FROM "TrackAudioFile";
DROP TABLE "TrackAudioFile";
ALTER TABLE "new_TrackAudioFile" RENAME TO "TrackAudioFile";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

CREATE UNIQUE INDEX "TrackAudioFile_trackId_serviceId_format_key" ON "TrackAudioFile"("trackId", "serviceId", "format");
CREATE INDEX "TrackAudioFile_contentHash_idx" ON "TrackAudioFile"("contentHash");
CREATE INDEX "TrackAudioFile_audioFingerprint_idx" ON "TrackAudioFile"("audioFingerprint");
CREATE INDEX "TrackAudioFile_trackId_idx" ON "TrackAudioFile"("trackId");
CREATE INDEX "TrackAudioFile_serviceId_idx" ON "TrackAudioFile"("serviceId");
CREATE INDEX "TrackAudioFile_format_idx" ON "TrackAudioFile"("format");
CREATE INDEX "TrackAudioFile_trackId_format_idx" ON "TrackAudioFile"("trackId", "format");

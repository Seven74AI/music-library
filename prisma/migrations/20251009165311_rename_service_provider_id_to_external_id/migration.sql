/*
  Warnings:

  - You are about to drop the `Note` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `NoteImage` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `serviceProviderId` on the `Track` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Note_ownerId_updatedAt_idx";

-- DropIndex
DROP INDEX "Note_ownerId_idx";

-- DropIndex
DROP INDEX "NoteImage_noteId_idx";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "Note";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "NoteImage";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "WorkerState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "status" TEXT NOT NULL DEFAULT 'running',
    "lastStateChange" DATETIME NOT NULL,
    "lastQueueRun" DATETIME,
    "nextLongBreakAt" DATETIME,
    "currentlyProcessing" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "serviceId" TEXT,
    "externalId" TEXT,
    "serviceUrl" TEXT,
    "duration" INTEGER,
    "thumbnailUrl" TEXT,
    "album" TEXT,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Track_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("album", "artist", "createdAt", "duration", "id", "releaseDate", "serviceId", "externalId", "serviceUrl", "thumbnailUrl", "title", "updatedAt") SELECT "album", "artist", "createdAt", "duration", "id", "releaseDate", "serviceId", "serviceProviderId", "serviceUrl", "thumbnailUrl", "title", "updatedAt" FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
CREATE INDEX "Track_serviceId_externalId_idx" ON "Track"("serviceId", "externalId");
CREATE INDEX "Track_updatedAt_idx" ON "Track"("updatedAt");
CREATE INDEX "Track_createdAt_idx" ON "Track"("createdAt");
CREATE UNIQUE INDEX "Track_serviceId_externalId_key" ON "Track"("serviceId", "externalId");
CREATE TABLE "new_TrackAudioFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "objectKey" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "errorHistory" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "downloadedAt" DATETIME,
    "lastAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "trackId" TEXT NOT NULL,
    CONSTRAINT "TrackAudioFile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_TrackAudioFile" ("createdAt", "fileName", "fileSize", "id", "mimeType", "objectKey", "trackId", "updatedAt") SELECT "createdAt", "fileName", "fileSize", "id", "mimeType", "objectKey", "trackId", "updatedAt" FROM "TrackAudioFile";
DROP TABLE "TrackAudioFile";
ALTER TABLE "new_TrackAudioFile" RENAME TO "TrackAudioFile";
CREATE UNIQUE INDEX "TrackAudioFile_trackId_key" ON "TrackAudioFile"("trackId");
CREATE INDEX "TrackAudioFile_status_idx" ON "TrackAudioFile"("status");
CREATE INDEX "TrackAudioFile_status_priority_createdAt_idx" ON "TrackAudioFile"("status", "priority", "createdAt");
CREATE INDEX "TrackAudioFile_status_lastAttemptAt_idx" ON "TrackAudioFile"("status", "lastAttemptAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "UserTrack_userId_createdAt_idx" ON "UserTrack"("userId", "createdAt");

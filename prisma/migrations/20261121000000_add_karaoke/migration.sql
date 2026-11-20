-- Karaoke slice 1: additive only (CREATE TABLE / CREATE INDEX).

-- CreateTable
CREATE TABLE "TrackVideoFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "contentHash" TEXT,
    "fileName" TEXT,
    "fileSize" INTEGER,
    "mimeType" TEXT,
    "format" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackVideoFile_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackVideoFile_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackKaraoke" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "TrackKaraoke_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackKaraoke_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "TrackKaraokeVersion" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrackKaraokeVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "trackId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "lyricsText" TEXT NOT NULL,
    "lines" TEXT NOT NULL,
    "videoFileId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackKaraokeVersion_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TrackKaraokeVersion_videoFileId_fkey" FOREIGN KEY ("videoFileId") REFERENCES "TrackVideoFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TrackKaraokeVersion_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackVideoFile_trackId_key" ON "TrackVideoFile"("trackId");

-- CreateIndex
CREATE INDEX "TrackVideoFile_contentHash_idx" ON "TrackVideoFile"("contentHash");

-- CreateIndex
CREATE INDEX "TrackVideoFile_serviceId_idx" ON "TrackVideoFile"("serviceId");

-- CreateIndex
CREATE INDEX "TrackVideoFile_objectKey_idx" ON "TrackVideoFile"("objectKey");

-- CreateIndex
CREATE UNIQUE INDEX "TrackKaraoke_trackId_key" ON "TrackKaraoke"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "TrackKaraoke_currentVersionId_key" ON "TrackKaraoke"("currentVersionId");

-- CreateIndex
CREATE INDEX "TrackKaraokeVersion_trackId_idx" ON "TrackKaraokeVersion"("trackId");

-- CreateIndex
CREATE INDEX "TrackKaraokeVersion_videoFileId_idx" ON "TrackKaraokeVersion"("videoFileId");

-- CreateIndex
CREATE INDEX "TrackKaraokeVersion_createdBy_idx" ON "TrackKaraokeVersion"("createdBy");

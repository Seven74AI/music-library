-- Karaoke slice 3a: additive only (CREATE TABLE / CREATE INDEX).

-- CreateTable
CREATE TABLE "KaraokeGenerationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "providerJobId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorHistory" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "KaraokeGenerationJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "TrackKaraokeVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "KaraokeGenerationJob_versionId_key" ON "KaraokeGenerationJob"("versionId");

-- CreateIndex
CREATE INDEX "KaraokeGenerationJob_status_idx" ON "KaraokeGenerationJob"("status");

-- CreateIndex
CREATE INDEX "KaraokeGenerationJob_providerJobId_idx" ON "KaraokeGenerationJob"("providerJobId");

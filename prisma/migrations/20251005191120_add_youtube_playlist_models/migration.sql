-- CreateTable
CREATE TABLE "YouTubePlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "youtubeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "channelId" TEXT NOT NULL,
    "channelTitle" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "lastSyncedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "YouTubePlaylist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "YouTubePlaylist_youtubeId_key" ON "YouTubePlaylist"("youtubeId");

-- CreateIndex
CREATE INDEX "YouTubePlaylist_ownerId_idx" ON "YouTubePlaylist"("ownerId");

-- CreateIndex
CREATE INDEX "YouTubePlaylist_ownerId_updatedAt_idx" ON "YouTubePlaylist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "YouTubePlaylist_youtubeId_idx" ON "YouTubePlaylist"("youtubeId");

-- CreateTable
CREATE TABLE "ServicePlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "channelId" TEXT,
    "channelTitle" TEXT,
    "publishedAt" DATETIME,
    "itemCount" INTEGER NOT NULL,
    "lastSyncedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "ServicePlaylist_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServicePlaylist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SynchronisedPlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SynchronisedPlaylist_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ServicePlaylist" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "SynchronisedPlaylist_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "UserTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserTrack" ("createdAt", "id", "trackId", "updatedAt", "userId") SELECT "createdAt", "id", "trackId", "updatedAt", "userId" FROM "UserTrack";
DROP TABLE "UserTrack";
ALTER TABLE "new_UserTrack" RENAME TO "UserTrack";
CREATE INDEX "UserTrack_userId_idx" ON "UserTrack"("userId");
CREATE INDEX "UserTrack_trackId_idx" ON "UserTrack"("trackId");
CREATE INDEX "UserTrack_userId_isActive_idx" ON "UserTrack"("userId", "isActive");
CREATE UNIQUE INDEX "UserTrack_userId_trackId_key" ON "UserTrack"("userId", "trackId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ServicePlaylist_ownerId_idx" ON "ServicePlaylist"("ownerId");

-- CreateIndex
CREATE INDEX "ServicePlaylist_ownerId_updatedAt_idx" ON "ServicePlaylist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "ServicePlaylist_serviceId_externalId_idx" ON "ServicePlaylist"("serviceId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlaylist_serviceId_externalId_key" ON "ServicePlaylist"("serviceId", "externalId");

-- CreateIndex
CREATE INDEX "SynchronisedPlaylist_playlistId_idx" ON "SynchronisedPlaylist"("playlistId");

-- CreateIndex
CREATE INDEX "SynchronisedPlaylist_trackId_idx" ON "SynchronisedPlaylist"("trackId");

-- CreateIndex
CREATE UNIQUE INDEX "SynchronisedPlaylist_playlistId_trackId_key" ON "SynchronisedPlaylist"("playlistId", "trackId");

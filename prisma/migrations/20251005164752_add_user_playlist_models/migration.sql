-- CreateTable
CREATE TABLE "UserPlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "UserPlaylist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserPlaylistTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    CONSTRAINT "UserPlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "UserPlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserPlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UserPlaylist_ownerId_idx" ON "UserPlaylist"("ownerId");

-- CreateIndex
CREATE INDEX "UserPlaylist_ownerId_updatedAt_idx" ON "UserPlaylist"("ownerId", "updatedAt");

-- CreateIndex
CREATE INDEX "UserPlaylistTrack_playlistId_position_idx" ON "UserPlaylistTrack"("playlistId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "UserPlaylistTrack_playlistId_trackId_key" ON "UserPlaylistTrack"("playlistId", "trackId");

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServicePlaylistTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServicePlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ServicePlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServicePlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ServicePlaylistTrack" ("createdAt", "id", "playlistId", "position", "trackId", "updatedAt") SELECT "createdAt", "id", "playlistId", "position", "trackId", "updatedAt" FROM "ServicePlaylistTrack";
DROP TABLE "ServicePlaylistTrack";
ALTER TABLE "new_ServicePlaylistTrack" RENAME TO "ServicePlaylistTrack";
CREATE INDEX "ServicePlaylistTrack_playlistId_idx" ON "ServicePlaylistTrack"("playlistId");
CREATE INDEX "ServicePlaylistTrack_trackId_idx" ON "ServicePlaylistTrack"("trackId");
CREATE UNIQUE INDEX "ServicePlaylistTrack_playlistId_trackId_key" ON "ServicePlaylistTrack"("playlistId", "trackId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

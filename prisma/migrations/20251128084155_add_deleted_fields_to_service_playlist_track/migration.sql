/*
  Warnings:

  - You are about to drop the `WorkerState` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "WorkerState";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServicePlaylistTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "playlistId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ServicePlaylistTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServicePlaylistTrack_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "ServicePlaylist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ServicePlaylistTrack" ("createdAt", "id", "playlistId", "position", "trackId", "updatedAt") SELECT "createdAt", "id", "playlistId", "position", "trackId", "updatedAt" FROM "ServicePlaylistTrack";
DROP TABLE "ServicePlaylistTrack";
ALTER TABLE "new_ServicePlaylistTrack" RENAME TO "ServicePlaylistTrack";
CREATE INDEX "ServicePlaylistTrack_playlistId_idx" ON "ServicePlaylistTrack"("playlistId");
CREATE INDEX "ServicePlaylistTrack_trackId_idx" ON "ServicePlaylistTrack"("trackId");
CREATE INDEX "ServicePlaylistTrack_playlistId_isDeleted_idx" ON "ServicePlaylistTrack"("playlistId", "isDeleted");
CREATE UNIQUE INDEX "ServicePlaylistTrack_playlistId_trackId_key" ON "ServicePlaylistTrack"("playlistId", "trackId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

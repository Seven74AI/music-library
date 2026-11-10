-- AlterTable
ALTER TABLE "ServicePlaylistTrack" ADD COLUMN "playlistItemId" TEXT;

-- DropIndex
DROP INDEX "ServicePlaylistTrack_playlistId_trackId_key";

-- CreateIndex
CREATE UNIQUE INDEX "ServicePlaylistTrack_playlistId_playlistItemId_key" ON "ServicePlaylistTrack"("playlistId", "playlistItemId");

-- CreateIndex
CREATE INDEX "ServicePlaylistTrack_playlistId_trackId_idx" ON "ServicePlaylistTrack"("playlistId", "trackId");

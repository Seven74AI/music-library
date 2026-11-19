-- AlterTable
ALTER TABLE "UserPlaylist" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "ProfilePrivacy" ADD COLUMN "showPlaylists" BOOLEAN NOT NULL DEFAULT true;

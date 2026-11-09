-- AlterTable
ALTER TABLE "PlayerState" ADD COLUMN "spinePosition" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PlayerState" ADD COLUMN "audibleSourceZone" TEXT;
ALTER TABLE "PlayerState" ADD COLUMN "upNextPlayNextCount" INTEGER NOT NULL DEFAULT 0;

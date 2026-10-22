-- Snapshot ordered genre ids so history restore can put Track↔Genre tags back.
ALTER TABLE "TrackEdit" ADD COLUMN "genreIds" TEXT;

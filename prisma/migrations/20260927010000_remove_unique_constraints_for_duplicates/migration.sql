-- Remove unique constraint on Artist.normalizedName to allow duplicate detection
-- Note: The constraint will be recreated as a non-unique index below
DROP INDEX "Artist_normalizedName_key";

-- Remove unique constraint on Album (artistId, name) to allow duplicate detection  
-- Note: This will be recreated as a regular index below
DROP INDEX "Album_artistId_name_key";

-- Re-create as non-unique indexes for query performance
CREATE INDEX IF NOT EXISTS "Artist_normalizedName_idx2" ON "Artist"("normalizedName");
CREATE INDEX IF NOT EXISTS "Album_artistId_name_idx2" ON "Album"("artistId", "name");

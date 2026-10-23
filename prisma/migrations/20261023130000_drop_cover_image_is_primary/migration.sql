-- CoverImage.isPrimary was a single global boolean on a contentHash-deduplicated
-- record shared across albums/tracks. Primary-ness is per-album/per-track and is
-- already expressed by the nullable `Album.coverImageId` / `Track.coverImageId`
-- foreign keys, so a shared image cannot (and does not need to) carry a global
-- primary flag. Drop the redundant column.

ALTER TABLE "CoverImage" DROP COLUMN "isPrimary";

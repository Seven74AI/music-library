-- Create Artist table
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "bio" TEXT,
    "imageUrl" TEXT,
    "website" TEXT,
    "genre" TEXT,
    "country" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- Backfill Artist rows from the legacy `artist` string column on Track and Album,
-- so the Track/Album redefinitions below can map artist -> artistId without dropping data.
-- normalizedName is a lower(trim(name)) approximation of the app's normalizeArtistName
-- (full special-character stripping is not replicated in SQL); it only needs to be unique
-- and consistent within this migration.
INSERT INTO "Artist" ("id", "name", "normalizedName", "createdAt", "updatedAt")
SELECT
    lower(hex(randomblob(16))),
    name,
    normalized_name,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT MIN(name) AS name, lower(trim(name)) AS normalized_name
    FROM (
        SELECT "artist" AS name FROM "Track"
        UNION ALL
        SELECT "artist" AS name FROM "Album"
    )
    GROUP BY lower(trim(name))
);

-- Recreate Track table with artistId instead of artist string (preserving data)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "serviceId" TEXT,
    "externalId" TEXT,
    "serviceUrl" TEXT,
    "duration" INTEGER,
    "thumbnailUrl" TEXT,
    "album" TEXT,
    "albumId" TEXT,
    "coverImageId" TEXT,
    "releaseDate" DATETIME,
    "genre" TEXT,
    "year" INTEGER,
    "trackNumber" INTEGER,
    "albumArtist" TEXT,
    "bpm" INTEGER,
    "label" TEXT,
    "isrc" TEXT,
    "originalDate" DATETIME,
    "originalYear" INTEGER,
    "totalTracks" INTEGER,
    "totalDiscs" INTEGER,
    "lyrics" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Track_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("id", "title", "artistId", "serviceId", "externalId", "serviceUrl", "duration", "thumbnailUrl", "album", "albumId", "coverImageId", "releaseDate", "genre", "year", "trackNumber", "albumArtist", "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs", "lyrics", "createdAt", "updatedAt")
SELECT
    t."id",
    t."title",
    (SELECT a."id" FROM "Artist" a WHERE a."normalizedName" = lower(trim(t."artist")) LIMIT 1),
    t."serviceId",
    t."externalId",
    t."serviceUrl",
    t."duration",
    t."thumbnailUrl",
    t."album",
    t."albumId",
    t."coverImageId",
    t."releaseDate",
    t."genre",
    t."year",
    t."trackNumber",
    t."albumArtist",
    t."bpm",
    t."label",
    t."isrc",
    t."originalDate",
    t."originalYear",
    t."totalTracks",
    t."totalDiscs",
    t."lyrics",
    t."createdAt",
    t."updatedAt"
FROM "Track" t;
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Recreate Album table with artistId instead of artist string (preserving data)
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Album" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "year" INTEGER,
    "coverImageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Album_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Album_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Album" ("id", "name", "artistId", "year", "coverImageId", "createdAt", "updatedAt")
SELECT
    alb."id",
    alb."name",
    (SELECT a."id" FROM "Artist" a WHERE a."normalizedName" = lower(trim(alb."artist")) LIMIT 1),
    alb."year",
    alb."coverImageId",
    alb."createdAt",
    alb."updatedAt"
FROM "Album" alb;
DROP TABLE "Album";
ALTER TABLE "new_Album" RENAME TO "Album";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Create indexes
CREATE UNIQUE INDEX "Artist_normalizedName_key" ON "Artist"("normalizedName");
CREATE INDEX "Artist_normalizedName_idx" ON "Artist"("normalizedName");
CREATE INDEX "Artist_name_idx" ON "Artist"("name");
CREATE UNIQUE INDEX "Album_artistId_name_key" ON "Album"("artistId", "name");
CREATE INDEX "Album_artistId_name_idx" ON "Album"("artistId", "name");
CREATE INDEX "Album_artistId_idx" ON "Album"("artistId");
CREATE INDEX "Track_artistId_idx" ON "Track"("artistId");

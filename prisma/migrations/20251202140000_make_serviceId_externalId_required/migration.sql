-- Make serviceId and externalId required (non-nullable) to fix Prisma unique constraint issue
-- Prisma requires all fields in @@unique constraints to be non-nullable
-- This fixes the "ON CONFLICT clause does not match any PRIMARY KEY or UNIQUE constraint" error

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "serviceUrl" TEXT,
    "duration" INTEGER,
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
    CONSTRAINT "Track_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Track_albumId_fkey" FOREIGN KEY ("albumId") REFERENCES "Album" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Track_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
-- Copy existing data, filtering out any rows with NULL serviceId or externalId
INSERT INTO "new_Track" ("albumArtist", "albumId", "artistId", "bpm", "coverImageId", "createdAt", "duration", "externalId", "genre", "id", "isrc", "label", "lyrics", "originalDate", "originalYear", "releaseDate", "serviceId", "serviceUrl", "title", "totalDiscs", "totalTracks", "trackNumber", "updatedAt", "year") 
SELECT "albumArtist", "albumId", "artistId", "bpm", "coverImageId", "createdAt", "duration", "externalId", "genre", "id", "isrc", "label", "lyrics", "originalDate", "originalYear", "releaseDate", "serviceId", "serviceUrl", "title", "totalDiscs", "totalTracks", "trackNumber", "updatedAt", "year" 
FROM "Track" 
WHERE "serviceId" IS NOT NULL AND "externalId" IS NOT NULL;
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Recreate the unique index on non-nullable columns (this will work properly with Prisma upsert)
CREATE UNIQUE INDEX "Track_serviceId_externalId_key" ON "Track"("serviceId", "externalId");





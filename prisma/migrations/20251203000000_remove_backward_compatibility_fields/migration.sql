-- Remove backward compatibility fields: thumbnailUrl and album
-- These fields are no longer needed as we use relational fields (coverImageId, albumId)

-- Drop thumbnailUrl column
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
INSERT INTO "new_Track" ("id", "title", "artistId", "serviceId", "externalId", "serviceUrl", "duration", "albumId", "coverImageId", "releaseDate", "genre", "year", "trackNumber", "albumArtist", "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs", "lyrics", "createdAt", "updatedAt") SELECT "id", "title", "artistId", "serviceId", "externalId", "serviceUrl", "duration", "albumId", "coverImageId", "releaseDate", "genre", "year", "trackNumber", "albumArtist", "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs", "lyrics", "createdAt", "updatedAt" FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;


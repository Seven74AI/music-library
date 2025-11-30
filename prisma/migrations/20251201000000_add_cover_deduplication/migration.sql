-- CreateTable
CREATE TABLE "CoverImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "contentHash" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "format" TEXT,
    "fileSize" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Album" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "year" INTEGER,
    "coverImageId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Album_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
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
    CONSTRAINT "Track_coverImageId_fkey" FOREIGN KEY ("coverImageId") REFERENCES "CoverImage" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("id", "title", "artist", "serviceId", "externalId", "serviceUrl", "duration", "thumbnailUrl", "album", "releaseDate", "genre", "year", "trackNumber", "albumArtist", "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs", "lyrics", "createdAt", "updatedAt") SELECT "id", "title", "artist", "serviceId", "externalId", "serviceUrl", "duration", "thumbnailUrl", "album", "releaseDate", "genre", "year", "trackNumber", "albumArtist", "bpm", "label", "isrc", "originalDate", "originalYear", "totalTracks", "totalDiscs", "lyrics", "createdAt", "updatedAt" FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "CoverImage_contentHash_key" ON "CoverImage"("contentHash");

-- CreateIndex
CREATE INDEX "CoverImage_contentHash_idx" ON "CoverImage"("contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Album_artist_name_key" ON "Album"("artist", "name");

-- CreateIndex
CREATE INDEX "Album_artist_name_idx" ON "Album"("artist", "name");

-- CreateIndex
CREATE INDEX "Track_albumId_idx" ON "Track"("albumId");

-- CreateIndex
CREATE INDEX "Track_coverImageId_idx" ON "Track"("coverImageId");


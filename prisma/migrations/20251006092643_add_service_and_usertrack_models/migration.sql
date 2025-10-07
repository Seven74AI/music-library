-- CreateTable
CREATE TABLE "Service" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "personalNote" TEXT,
    CONSTRAINT "UserTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "serviceId" TEXT,
    "serviceProviderId" TEXT,
    "serviceUrl" TEXT,
    "duration" INTEGER,
    "thumbnailUrl" TEXT,
    "album" TEXT,
    "releaseDate" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Track_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Track" ("artist", "createdAt", "id", "title", "updatedAt") SELECT "artist", "createdAt", "id", "title", "updatedAt" FROM "Track";
DROP TABLE "Track";
ALTER TABLE "new_Track" RENAME TO "Track";
CREATE INDEX "Track_serviceId_serviceProviderId_idx" ON "Track"("serviceId", "serviceProviderId");
CREATE INDEX "Track_updatedAt_idx" ON "Track"("updatedAt");
CREATE UNIQUE INDEX "Track_serviceId_serviceProviderId_key" ON "Track"("serviceId", "serviceProviderId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Service_name_key" ON "Service"("name");

-- CreateIndex
CREATE INDEX "Service_name_idx" ON "Service"("name");

-- CreateIndex
CREATE INDEX "UserTrack_userId_createdAt_idx" ON "UserTrack"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserTrack_userId_trackId_key" ON "UserTrack"("userId", "trackId");

-- Seed Services (same data as in seed.ts)
-- Using CURRENT_TIMESTAMP for consistency across environments
INSERT INTO Service (id, name, displayName, baseUrl, logoUrl, isActive, createdAt, updatedAt) 
VALUES('clnf2zvli0000pcou3zzzzome','youtube','YouTube','https://youtube.com','/logos/youtube.svg',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP);

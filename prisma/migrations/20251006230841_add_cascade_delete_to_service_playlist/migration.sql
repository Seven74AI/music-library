-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServicePlaylist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "serviceId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnailUrl" TEXT,
    "channelId" TEXT,
    "channelTitle" TEXT,
    "publishedAt" DATETIME,
    "itemCount" INTEGER NOT NULL,
    "lastSyncedAt" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "ownerId" TEXT NOT NULL,
    CONSTRAINT "ServicePlaylist_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ServicePlaylist_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ServicePlaylist" ("channelId", "channelTitle", "createdAt", "description", "externalId", "id", "isActive", "itemCount", "lastSyncedAt", "ownerId", "publishedAt", "serviceId", "thumbnailUrl", "title", "updatedAt") SELECT "channelId", "channelTitle", "createdAt", "description", "externalId", "id", "isActive", "itemCount", "lastSyncedAt", "ownerId", "publishedAt", "serviceId", "thumbnailUrl", "title", "updatedAt" FROM "ServicePlaylist";
DROP TABLE "ServicePlaylist";
ALTER TABLE "new_ServicePlaylist" RENAME TO "ServicePlaylist";
CREATE INDEX "ServicePlaylist_ownerId_idx" ON "ServicePlaylist"("ownerId");
CREATE INDEX "ServicePlaylist_ownerId_updatedAt_idx" ON "ServicePlaylist"("ownerId", "updatedAt");
CREATE INDEX "ServicePlaylist_serviceId_externalId_idx" ON "ServicePlaylist"("serviceId", "externalId");
CREATE UNIQUE INDEX "ServicePlaylist_serviceId_externalId_key" ON "ServicePlaylist"("serviceId", "externalId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

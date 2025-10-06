/*
  Warnings:

  - You are about to drop the column `personalNote` on the `UserTrack` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_UserTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    CONSTRAINT "UserTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UserTrack" ("createdAt", "id", "trackId", "updatedAt", "userId") SELECT "createdAt", "id", "trackId", "updatedAt", "userId" FROM "UserTrack";
DROP TABLE "UserTrack";
ALTER TABLE "new_UserTrack" RENAME TO "UserTrack";
CREATE INDEX "UserTrack_userId_createdAt_idx" ON "UserTrack"("userId", "createdAt");
CREATE UNIQUE INDEX "UserTrack_userId_trackId_key" ON "UserTrack"("userId", "trackId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

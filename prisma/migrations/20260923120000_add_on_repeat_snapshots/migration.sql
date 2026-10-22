-- CreateTable
CREATE TABLE "OnRepeatSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "yearMonth" TEXT NOT NULL,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnRepeatSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OnRepeatSnapshotTrack" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "snapshotId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "listenCount" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OnRepeatSnapshotTrack_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "OnRepeatSnapshot" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OnRepeatSnapshotTrack_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "OnRepeatSnapshot_userId_yearMonth_idx" ON "OnRepeatSnapshot"("userId", "yearMonth");

-- CreateIndex
CREATE UNIQUE INDEX "OnRepeatSnapshot_userId_yearMonth_key" ON "OnRepeatSnapshot"("userId", "yearMonth");

-- CreateIndex
CREATE INDEX "OnRepeatSnapshotTrack_snapshotId_position_idx" ON "OnRepeatSnapshotTrack"("snapshotId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "OnRepeatSnapshotTrack_snapshotId_trackId_key" ON "OnRepeatSnapshotTrack"("snapshotId", "trackId");

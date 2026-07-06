-- CreateTable
CREATE TABLE "ArchiveJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "errorHistory" TEXT NOT NULL DEFAULT '[]',
    "lastAttemptAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "trackId" TEXT NOT NULL,
    CONSTRAINT "ArchiveJob_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveJob_trackId_key" ON "ArchiveJob"("trackId");

-- CreateIndex
CREATE INDEX "ArchiveJob_status_idx" ON "ArchiveJob"("status");

-- CreateIndex
CREATE INDEX "ArchiveJob_priority_idx" ON "ArchiveJob"("priority");

-- CreateIndex
CREATE INDEX "ArchiveJob_createdAt_idx" ON "ArchiveJob"("createdAt");

-- CreateTable
CREATE TABLE "WorkerState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "status" TEXT NOT NULL DEFAULT 'running',
    "currentlyProcessing" TEXT,
    "lastQueueRun" DATETIME,
    "nextLongBreakAt" DATETIME,
    "lastStateChange" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "YoutubeCookie" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedBy" TEXT NOT NULL,
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

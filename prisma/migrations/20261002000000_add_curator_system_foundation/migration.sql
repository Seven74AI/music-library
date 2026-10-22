-- CreateTable: EditLock for concurrent editing protection
CREATE TABLE "EditLock" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL, -- 'track', 'artist', 'album'
    "entityId" TEXT NOT NULL,
    "lockedBy" TEXT NOT NULL,
    "acquiredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "EditLock_lockedBy_fkey" FOREIGN KEY ("lockedBy") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- CreateTable: ReviewQueueItem for curator review queue
CREATE TABLE "ReviewQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL, -- 'track', 'artist', 'album'
    "entityId" TEXT NOT NULL,
    "source" TEXT NOT NULL, -- 'user_report', 'system', 'curator'
    "issueType" TEXT NOT NULL, -- 'wrong_metadata', 'missing_info', 'low_quality', 'duplicate', 'other'
    "description" TEXT,
    "reporterId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open', -- 'open', 'claimed', 'resolved'
    "priority" INTEGER NOT NULL DEFAULT 1, -- 1 (low) to 3 (high)
    "claimedBy" TEXT,
    "claimedAt" DATETIME,
    "resolvedBy" TEXT,
    "resolvedAt" DATETIME,
    "resolution" TEXT, -- 'fixed', 'not_an_issue', 'duplicate', 'cannot_fix'
    "resolutionComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewQueueItem_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User" ("id") ON DELETE SET NULL,
    CONSTRAINT "ReviewQueueItem_claimedBy_fkey" FOREIGN KEY ("claimedBy") REFERENCES "User" ("id") ON DELETE SET NULL,
    CONSTRAINT "ReviewQueueItem_resolvedBy_fkey" FOREIGN KEY ("resolvedBy") REFERENCES "User" ("id") ON DELETE SET NULL
);

-- CreateTable: DuplicateDetection for caching duplicate detection results
CREATE TABLE "DuplicateDetection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL, -- 'artist', 'album'
    "entityId1" TEXT NOT NULL,
    "entityId2" TEXT NOT NULL,
    "matchType" TEXT NOT NULL, -- 'exact', 'fuzzy'
    "similarity" REAL NOT NULL, -- Levenshtein distance
    "normalizedName" TEXT NOT NULL,
    "detectedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'merged', 'dismissed'
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: NormalizedName for caching normalized names
CREATE TABLE "NormalizedName" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL, -- 'artist', 'album'
    "entityId" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: Genre for multi-genre tagging
CREATE TABLE "Genre" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL UNIQUE,
    "normalizedName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable: _TrackGenres join table for many-to-many Track<->Genre
CREATE TABLE "_TrackGenres" (
    "A" TEXT NOT NULL, -- genreId
    "B" TEXT NOT NULL, -- trackId
    CONSTRAINT "_TrackGenres_A_fkey" FOREIGN KEY ("A") REFERENCES "Genre" ("id") ON DELETE CASCADE,
    CONSTRAINT "_TrackGenres_B_fkey" FOREIGN KEY ("B") REFERENCES "Track" ("id") ON DELETE CASCADE
);

-- CreateTable: CuratorNote for threaded curator notes
CREATE TABLE "CuratorNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityType" TEXT NOT NULL, -- 'track', 'artist', 'album'
    "entityId" TEXT NOT NULL,
    "curatorId" TEXT NOT NULL,
    "parentId" TEXT,
    "content" TEXT NOT NULL,
    "mentions" TEXT NOT NULL DEFAULT '[]', -- JSON array of user IDs
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuratorNote_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "User" ("id") ON DELETE CASCADE,
    CONSTRAINT "CuratorNote_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CuratorNote" ("id") ON DELETE CASCADE
);

-- CreateTable: CuratorBadge for achievement system
CREATE TABLE "CuratorBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "curatorId" TEXT NOT NULL,
    "badgeType" TEXT NOT NULL, -- 'first_edit', 'getting_started', 'regular_contributor', etc.
    "earnedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CuratorBadge_curatorId_fkey" FOREIGN KEY ("curatorId") REFERENCES "User" ("id") ON DELETE CASCADE
);

-- Add isPrimary to CoverImage
ALTER TABLE "CoverImage" ADD COLUMN "isPrimary" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex: EditLock performance indexes
CREATE UNIQUE INDEX "EditLock_entityType_entityId_key" ON "EditLock"("entityType", "entityId");
CREATE INDEX "EditLock_lockedBy_idx" ON "EditLock"("lockedBy");
CREATE INDEX "EditLock_expiresAt_idx" ON "EditLock"("expiresAt");

-- CreateIndex: ReviewQueueItem performance indexes
CREATE INDEX "ReviewQueueItem_entityType_entityId_idx" ON "ReviewQueueItem"("entityType", "entityId");
CREATE INDEX "ReviewQueueItem_status_priority_idx" ON "ReviewQueueItem"("status", "priority");
CREATE INDEX "ReviewQueueItem_claimedBy_idx" ON "ReviewQueueItem"("claimedBy");
CREATE INDEX "ReviewQueueItem_reporterId_idx" ON "ReviewQueueItem"("reporterId");
CREATE INDEX "ReviewQueueItem_createdAt_idx" ON "ReviewQueueItem"("createdAt");

-- CreateIndex: DuplicateDetection performance indexes
CREATE INDEX "DuplicateDetection_entityType_entityId1_idx" ON "DuplicateDetection"("entityType", "entityId1");
CREATE INDEX "DuplicateDetection_entityType_entityId2_idx" ON "DuplicateDetection"("entityType", "entityId2");
CREATE INDEX "DuplicateDetection_normalizedName_idx" ON "DuplicateDetection"("normalizedName");
CREATE INDEX "DuplicateDetection_status_idx" ON "DuplicateDetection"("status");
CREATE INDEX "DuplicateDetection_matchType_idx" ON "DuplicateDetection"("matchType");

-- CreateIndex: NormalizedName performance indexes
CREATE UNIQUE INDEX "NormalizedName_entityType_entityId_key" ON "NormalizedName"("entityType", "entityId");
CREATE INDEX "NormalizedName_normalizedName_idx" ON "NormalizedName"("normalizedName");

-- CreateIndex: Genre performance indexes
CREATE INDEX "Genre_normalizedName_idx" ON "Genre"("normalizedName");

-- CreateIndex: _TrackGenres performance indexes
CREATE UNIQUE INDEX "_TrackGenres_AB_unique" ON "_TrackGenres"("A", "B");
CREATE INDEX "_TrackGenres_B_index" ON "_TrackGenres"("B");

-- CreateIndex: CuratorNote performance indexes
CREATE INDEX "CuratorNote_entityType_entityId_idx" ON "CuratorNote"("entityType", "entityId");
CREATE INDEX "CuratorNote_curatorId_idx" ON "CuratorNote"("curatorId");
CREATE INDEX "CuratorNote_parentId_idx" ON "CuratorNote"("parentId");
CREATE INDEX "CuratorNote_createdAt_idx" ON "CuratorNote"("createdAt");

-- CreateIndex: CuratorBadge performance indexes
CREATE UNIQUE INDEX "CuratorBadge_curatorId_badgeType_key" ON "CuratorBadge"("curatorId", "badgeType");
CREATE INDEX "CuratorBadge_curatorId_idx" ON "CuratorBadge"("curatorId");
CREATE INDEX "CuratorBadge_earnedAt_idx" ON "CuratorBadge"("earnedAt");

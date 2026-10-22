-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "defaultJoinRole" TEXT NOT NULL DEFAULT 'listener',
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "roomVersion" INTEGER NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "originalHostUserId" TEXT NOT NULL,
    "currentHostParticipantId" TEXT,
    "emptySince" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_originalHostUserId_fkey" FOREIGN KEY ("originalHostUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "userId" TEXT,
    "guestTokenHash" TEXT,
    "displayName" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RoomParticipant_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Add deferred FK from Room → current host participant (circular with RoomParticipant.roomId)
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "defaultJoinRole" TEXT NOT NULL DEFAULT 'listener',
    "currentIndex" INTEGER NOT NULL DEFAULT 0,
    "roomVersion" INTEGER NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "originalHostUserId" TEXT NOT NULL,
    "currentHostParticipantId" TEXT,
    "emptySince" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_originalHostUserId_fkey" FOREIGN KEY ("originalHostUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Room_currentHostParticipantId_fkey" FOREIGN KEY ("currentHostParticipantId") REFERENCES "RoomParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("id", "code", "status", "defaultJoinRole", "currentIndex", "roomVersion", "isPlaying", "originalHostUserId", "currentHostParticipantId", "emptySince", "endedAt", "createdAt", "updatedAt")
  SELECT "id", "code", "status", "defaultJoinRole", "currentIndex", "roomVersion", "isPlaying", "originalHostUserId", "currentHostParticipantId", "emptySince", "endedAt", "createdAt", "updatedAt" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
PRAGMA foreign_keys=ON;

-- CreateTable
CREATE TABLE "RoomQueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "addedByParticipantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomQueueItem_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomQueueItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomQueueItem_addedByParticipantId_fkey" FOREIGN KEY ("addedByParticipantId") REFERENCES "RoomParticipant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomPlayEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "addedByParticipantId" TEXT,
    "playId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomPlayEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomPlayEvent_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Room_currentHostParticipantId_key" ON "Room"("currentHostParticipantId");

-- CreateIndex
CREATE INDEX "Room_code_status_idx" ON "Room"("code", "status");

-- CreateIndex
CREATE INDEX "Room_status_idx" ON "Room"("status");

-- CreateIndex
CREATE INDEX "Room_originalHostUserId_status_idx" ON "Room"("originalHostUserId", "status");

-- CreateIndex
CREATE INDEX "RoomParticipant_roomId_leftAt_idx" ON "RoomParticipant"("roomId", "leftAt");

-- CreateIndex
CREATE INDEX "RoomParticipant_userId_leftAt_idx" ON "RoomParticipant"("userId", "leftAt");

-- CreateIndex
CREATE INDEX "RoomParticipant_guestTokenHash_idx" ON "RoomParticipant"("guestTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RoomParticipant_roomId_userId_key" ON "RoomParticipant"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomParticipant_roomId_guestTokenHash_key" ON "RoomParticipant"("roomId", "guestTokenHash");

-- CreateIndex
CREATE INDEX "RoomQueueItem_roomId_position_idx" ON "RoomQueueItem"("roomId", "position");

-- CreateIndex
CREATE INDEX "RoomQueueItem_addedByParticipantId_idx" ON "RoomQueueItem"("addedByParticipantId");

-- CreateIndex
CREATE INDEX "RoomQueueItem_trackId_idx" ON "RoomQueueItem"("trackId");

-- CreateIndex
CREATE INDEX "RoomPlayEvent_roomId_createdAt_idx" ON "RoomPlayEvent"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "RoomPlayEvent_trackId_idx" ON "RoomPlayEvent"("trackId");

-- CreateIndex
CREATE INDEX "RoomPlayEvent_type_createdAt_idx" ON "RoomPlayEvent"("type", "createdAt");

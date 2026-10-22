-- Room.reclaimParticipantId: seat allowed to reclaim the speaker.
-- Nullable so a guest seat can hold it. Backfill existing rooms to the creator's seat.
PRAGMA defer_foreign_keys=ON;
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
    "reclaimParticipantId" TEXT,
    "emptySince" DATETIME,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Room_originalHostUserId_fkey" FOREIGN KEY ("originalHostUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Room_currentHostParticipantId_fkey" FOREIGN KEY ("currentHostParticipantId") REFERENCES "RoomParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Room_reclaimParticipantId_fkey" FOREIGN KEY ("reclaimParticipantId") REFERENCES "RoomParticipant" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("id", "code", "status", "defaultJoinRole", "currentIndex", "roomVersion", "isPlaying", "originalHostUserId", "currentHostParticipantId", "emptySince", "endedAt", "createdAt", "updatedAt")
  SELECT "id", "code", "status", "defaultJoinRole", "currentIndex", "roomVersion", "isPlaying", "originalHostUserId", "currentHostParticipantId", "emptySince", "endedAt", "createdAt", "updatedAt" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE UNIQUE INDEX "Room_currentHostParticipantId_key" ON "Room"("currentHostParticipantId");
CREATE UNIQUE INDEX "Room_reclaimParticipantId_key" ON "Room"("reclaimParticipantId");
CREATE INDEX "Room_code_status_idx" ON "Room"("code", "status");
CREATE INDEX "Room_status_idx" ON "Room"("status");
CREATE INDEX "Room_originalHostUserId_status_idx" ON "Room"("originalHostUserId", "status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

UPDATE "Room"
SET "reclaimParticipantId" = (
  SELECT "id" FROM "RoomParticipant"
  WHERE "RoomParticipant"."roomId" = "Room"."id"
    AND "RoomParticipant"."userId" = "Room"."originalHostUserId"
  LIMIT 1
)
WHERE "reclaimParticipantId" IS NULL;

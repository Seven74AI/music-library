-- CreateTable
CREATE TABLE "PlayerState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "playContext" TEXT,
    "currentTrackId" TEXT,
    "upNextIds" TEXT NOT NULL DEFAULT '[]',
    "shuffleSeed" INTEGER,
    "loopMode" TEXT NOT NULL DEFAULT 'off',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerState_userId_key" ON "PlayerState"("userId");

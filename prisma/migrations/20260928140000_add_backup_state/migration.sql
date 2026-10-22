-- CreateTable
CREATE TABLE "BackupState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastStatus" TEXT,
    "lastAttemptAt" DATETIME,
    "lastSuccessAt" DATETIME,
    "lastError" TEXT,
    "lastObjectKey" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("id")
);

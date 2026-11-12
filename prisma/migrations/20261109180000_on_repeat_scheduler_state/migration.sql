-- CreateTable
CREATE TABLE "OnRepeatSnapshotSchedulerState" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "lastSuccessYearMonth" TEXT,
    "nextRetryAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

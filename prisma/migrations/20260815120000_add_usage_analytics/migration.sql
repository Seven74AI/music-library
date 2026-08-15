-- AlterTable
ALTER TABLE "User" ADD COLUMN "disabledAt" DATETIME;

-- CreateTable
CREATE TABLE "UsageEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "userId" TEXT,
    "trackId" TEXT,
    "meta" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DailyUsageStat" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "metric" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "DailyActiveUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "day" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "DailyActiveUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "UsageEvent_type_createdAt_idx" ON "UsageEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_createdAt_idx" ON "UsageEvent"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyUsageStat_day_metric_key" ON "DailyUsageStat"("day", "metric");

-- CreateIndex
CREATE INDEX "DailyUsageStat_metric_day_idx" ON "DailyUsageStat"("metric", "day");

-- CreateIndex
CREATE UNIQUE INDEX "DailyActiveUser_day_userId_key" ON "DailyActiveUser"("day", "userId");

-- CreateIndex
CREATE INDEX "DailyActiveUser_day_idx" ON "DailyActiveUser"("day");

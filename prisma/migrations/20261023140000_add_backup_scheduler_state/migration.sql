-- AlterTable
ALTER TABLE "BackupState" ADD COLUMN "schedulerLastSuccessDay" TEXT;
ALTER TABLE "BackupState" ADD COLUMN "schedulerAttemptDay" TEXT;
ALTER TABLE "BackupState" ADD COLUMN "schedulerAttemptsToday" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BackupState" ADD COLUMN "schedulerNextRetryAt" DATETIME;

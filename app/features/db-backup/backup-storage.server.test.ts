import { expect, test } from "vitest";
import { isBackupBucketConfigured } from "./backup-storage.server.ts";

test("isBackupBucketConfigured is false when unset or blank", () => {
  const original = process.env.BACKUP_BUCKET_NAME;
  delete process.env.BACKUP_BUCKET_NAME;
  expect(isBackupBucketConfigured()).toBe(false);
  process.env.BACKUP_BUCKET_NAME = "   ";
  expect(isBackupBucketConfigured()).toBe(false);
  process.env.BACKUP_BUCKET_NAME = "my-backups";
  expect(isBackupBucketConfigured()).toBe(true);
  if (original !== undefined) process.env.BACKUP_BUCKET_NAME = original;
  else delete process.env.BACKUP_BUCKET_NAME;
});

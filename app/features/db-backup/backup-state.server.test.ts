import { expect, test } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import {
  BackupStatus,
  getBackupState,
  markBackupFailure,
  markBackupRunning,
  markBackupSuccess,
} from "./backup-state.server.ts";

test("getBackupState creates the singleton when missing", async () => {
  await prisma.backupState.deleteMany({});
  const state = await getBackupState();
  expect(state.lastStatus).toBeNull();
  expect(state.lastSuccessAt).toBeNull();
  expect(state.lastObjectKey).toBeNull();
});

test("markBackupRunning then success updates timestamps and clears error", async () => {
  await prisma.backupState.deleteMany({});
  await markBackupRunning();
  let state = await getBackupState();
  expect(state.lastStatus).toBe(BackupStatus.RUNNING);
  expect(state.lastAttemptAt).toBeTruthy();

  state = await markBackupSuccess("backups/sqlite/daily/2026-09-28.db");
  expect(state.lastStatus).toBe(BackupStatus.SUCCESS);
  expect(state.lastSuccessAt).toBeTruthy();
  expect(state.lastObjectKey).toBe("backups/sqlite/daily/2026-09-28.db");
  expect(state.lastError).toBeNull();
});

test("markBackupFailure records truncated error", async () => {
  await prisma.backupState.deleteMany({});
  const state = await markBackupFailure("boom");
  expect(state.lastStatus).toBe(BackupStatus.FAILURE);
  expect(state.lastError).toBe("boom");
  expect(state.lastSuccessAt).toBeNull();
});

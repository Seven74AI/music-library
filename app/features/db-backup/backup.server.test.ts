import { writeFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { prisma } from "#app/utils/db.server.ts";
import { BackupStatus } from "./backup-state.server.ts";
import { runBackup } from "./backup.server.ts";

vi.mock("#app/utils/litefs.server.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("#app/utils/litefs.server.ts")>();
  return {
    ...actual,
    getInstanceInfo: vi.fn(async () => ({
      currentIsPrimary: true,
      primaryInstance: "test",
      currentInstance: "test",
    })),
  };
});

test("runBackup skips when BACKUP_BUCKET_NAME is unset", async () => {
  const original = process.env.BACKUP_BUCKET_NAME;
  delete process.env.BACKUP_BUCKET_NAME;
  try {
    const result = await runBackup({ skipPrimaryCheck: true });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.skipped).toBe(true);
      expect(result.error).toMatch(/BACKUP_BUCKET_NAME/);
    }
  } finally {
    if (original !== undefined) process.env.BACKUP_BUCKET_NAME = original;
  }
});

test("runBackup exports, uploads daily+weekly, prunes, and marks success", async () => {
  process.env.BACKUP_BUCKET_NAME = "test-backup-bucket";
  await prisma.backupState.deleteMany({});

  const uploaded: string[] = [];
  const deleted: string[] = [];
  const store = new Map<string, true>();

  const result = await runBackup({
    skipPrimaryCheck: true,
    now: new Date("2026-09-28T03:00:00.000Z"),
    exportDatabase: async (dest) => {
      await writeFile(dest, "fake-db");
    },
    upload: async ({ key }) => {
      uploaded.push(key);
      store.set(key, true);
      return key;
    },
    listKeys: async (prefix) => {
      // Simulate existing extras beyond retention
      const extras = prefix.includes("daily")
        ? [
            "backups/sqlite/daily/2026-09-28.db",
            "backups/sqlite/daily/2026-09-27.db",
            "backups/sqlite/daily/2026-09-26.db",
            "backups/sqlite/daily/2026-09-25.db",
            "backups/sqlite/daily/2026-09-24.db",
            "backups/sqlite/daily/2026-09-23.db",
            "backups/sqlite/daily/2026-09-22.db",
            "backups/sqlite/daily/2026-09-21.db",
            "backups/sqlite/daily/2026-09-20.db",
          ]
        : [
            "backups/sqlite/weekly/2026-W40.db",
            "backups/sqlite/weekly/2026-W39.db",
            "backups/sqlite/weekly/2026-W38.db",
            "backups/sqlite/weekly/2026-W37.db",
            "backups/sqlite/weekly/2026-W36.db",
          ];
      return extras.filter((k) => k.startsWith(prefix) || store.has(k));
    },
    deleteKey: async (key) => {
      deleted.push(key);
      store.delete(key);
    },
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.dailyKey).toBe("backups/sqlite/daily/2026-09-28.db");
    expect(result.weeklyKey).toBe("backups/sqlite/weekly/2026-W40.db");
  }
  expect(uploaded).toEqual([
    "backups/sqlite/daily/2026-09-28.db",
    "backups/sqlite/weekly/2026-W40.db",
  ]);
  expect(deleted).toContain("backups/sqlite/daily/2026-09-20.db");
  expect(deleted).toContain("backups/sqlite/weekly/2026-W36.db");

  const state = await prisma.backupState.findUniqueOrThrow({ where: { id: "singleton" } });
  expect(state.lastStatus).toBe(BackupStatus.SUCCESS);
  expect(state.lastObjectKey).toBe("backups/sqlite/daily/2026-09-28.db");
});

test("runBackup marks failure and notifies when requested", async () => {
  process.env.BACKUP_BUCKET_NAME = "test-backup-bucket";
  await prisma.backupState.deleteMany({});
  const notify = vi.fn(async () => {});

  const result = await runBackup({
    skipPrimaryCheck: true,
    exportDatabase: async () => {
      throw new Error("export exploded");
    },
    upload: async ({ key }) => key,
    notifyOnFailure: true,
    attemptCount: 2,
    notifyFailure: notify,
  });

  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toMatch(/export exploded/);
  expect(notify).toHaveBeenCalledWith("export exploded", 2);

  const state = await prisma.backupState.findUniqueOrThrow({ where: { id: "singleton" } });
  expect(state.lastStatus).toBe(BackupStatus.FAILURE);
  expect(state.lastError).toMatch(/export exploded/);
});

test("runBackup skips when not LiteFS primary", async () => {
  process.env.BACKUP_BUCKET_NAME = "test-backup-bucket";
  const { getInstanceInfo } = await import("#app/utils/litefs.server.ts");
  vi.mocked(getInstanceInfo).mockResolvedValueOnce({
    currentIsPrimary: false,
    primaryInstance: "other",
    currentInstance: "replica",
  });

  const result = await runBackup({
    exportDatabase: async () => {
      throw new Error("should not export");
    },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.skipped).toBe(true);
    expect(result.error).toMatch(/primary/i);
  }
});

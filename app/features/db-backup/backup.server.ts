/**
 * Run a consistent SQLite backup: litefs export → upload → prune → status.
 */
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { getInstanceInfo } from "#app/utils/litefs.server.ts";
import {
  DAILY_PREFIX,
  DAILY_RETENTION,
  WEEKLY_PREFIX,
  WEEKLY_RETENTION,
  dailyBackupKey,
  keysToPrune,
  sortBackupKeysNewestFirst,
  weeklyBackupKey,
} from "./backup-keys.ts";
import { markBackupFailure, markBackupRunning, markBackupSuccess } from "./backup-state.server.ts";
import {
  deleteBackupObject,
  isBackupBucketConfigured,
  listBackupObjectKeys,
  uploadBackupObject,
} from "./backup-storage.server.ts";
import { notifyBackupFailed } from "./notification.server.ts";

const execFileAsync = promisify(execFile);

export type RunBackupOptions = {
  /** Override "now" for key naming / tests */
  now?: Date;
  /** Skip LiteFS primary check (tests / local without LiteFS) */
  skipPrimaryCheck?: boolean;
  /** Inject export implementation */
  exportDatabase?: (destPath: string) => Promise<void>;
  /** Inject list/delete for prune tests */
  listKeys?: (prefix: string) => Promise<string[]>;
  deleteKey?: (key: string) => Promise<void>;
  upload?: (params: { localPath: string; key: string }) => Promise<string>;
  /** Notify on failure (default Telegram) */
  notifyFailure?: (error: string, attempts: number) => Promise<void>;
  /** How many attempts for this call (scheduler tracks across retries) */
  attemptCount?: number;
  /** When true, send Telegram after this failure */
  notifyOnFailure?: boolean;
};

export type RunBackupResult =
  | { ok: true; dailyKey: string; weeklyKey: string }
  | { ok: false; error: string; skipped?: boolean };

async function defaultExportDatabase(destPath: string): Promise<void> {
  const dbName = process.env.DATABASE_FILENAME || "sqlite.db";
  // Prefer litefs export for consistency on Fly; fall back to sqlite3 .backup locally.
  try {
    await execFileAsync("litefs", ["export", "-name", dbName, destPath], {
      timeout: 5 * 60 * 1000,
    });
    return;
  } catch (litefsError) {
    const dbPath = process.env.DATABASE_PATH;
    if (!dbPath) throw litefsError;
    // Local / test: use sqlite3 Online Backup API
    await execFileAsync("sqlite3", [dbPath, `.backup '${destPath}'`], {
      timeout: 5 * 60 * 1000,
    });
  }
}

export async function runBackup(options: RunBackupOptions = {}): Promise<RunBackupResult> {
  if (!isBackupBucketConfigured() && !options.upload) {
    return { ok: false, error: "BACKUP_BUCKET_NAME is not configured", skipped: true };
  }

  if (!options.skipPrimaryCheck) {
    const { currentIsPrimary } = await getInstanceInfo();
    if (!currentIsPrimary) {
      return { ok: false, error: "Not LiteFS primary", skipped: true };
    }
  }

  const now = options.now ?? new Date();
  const dailyKey = dailyBackupKey(now);
  const weeklyKey = weeklyBackupKey(now);
  const exportDatabase = options.exportDatabase ?? defaultExportDatabase;
  const listKeys = options.listKeys ?? listBackupObjectKeys;
  const deleteKey = options.deleteKey ?? deleteBackupObject;
  const upload = options.upload ?? uploadBackupObject;
  const notifyFailure = options.notifyFailure ?? notifyBackupFailed;
  const attemptCount = options.attemptCount ?? 1;
  const notifyOnFailure = options.notifyOnFailure ?? false;

  await markBackupRunning();

  const tmpDir = await mkdtemp(join(tmpdir(), "db-backup-"));
  const exportPath = join(tmpDir, "sqlite-export.db");

  try {
    await exportDatabase(exportPath);
    await upload({ localPath: exportPath, key: dailyKey });
    // Weekly is the same snapshot under a weekly key (extra retention tier)
    await upload({ localPath: exportPath, key: weeklyKey });

    const dailyKeys = sortBackupKeysNewestFirst(await listKeys(DAILY_PREFIX));
    const weeklyKeys = sortBackupKeysNewestFirst(await listKeys(WEEKLY_PREFIX));

    for (const key of keysToPrune(dailyKeys, DAILY_RETENTION)) {
      await deleteKey(key);
    }
    for (const key of keysToPrune(weeklyKeys, WEEKLY_RETENTION)) {
      await deleteKey(key);
    }

    await markBackupSuccess(dailyKey);
    return { ok: true, dailyKey, weeklyKey };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markBackupFailure(message);
    if (notifyOnFailure) {
      void notifyFailure(message, attemptCount);
    }
    return { ok: false, error: message };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
